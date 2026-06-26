import 'server-only'
import { GoogleGenerativeAI, type GenerateContentResult, type Part } from '@google/generative-ai'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSetting } from '@/lib/settings'
import { DEFAULT_GEMINI_PROMPT_NORMAL, DEFAULT_GEMINI_PROMPT_DIFF, DEFAULT_GEMINI_PROMPT_ORDERS } from './prompts'
import { modelTryOrder } from './models'

/** APIキーは設定（DB→env）。設定画面 or Secret Manager で投入する。 */
async function client(): Promise<GoogleGenerativeAI> {
  const key = await getSetting('GEMINI_API_KEY')
  if (!key) throw new Error('GEMINI_API_KEY が未設定です（設定画面 または Secret Manager で投入）')
  return new GoogleGenerativeAI(key)
}

/**
 * 503/429/404 のときだけ次のモデルへフォールバックしながら generateContent を試みる。
 * 設定 GEMINI_MODEL が空（自動）なら GEMINI_FALLBACK_ORDER 順に試す。
 */
async function generateWithFallback(parts: Part[]): Promise<GenerateContentResult> {
  const preferred = await getSetting('GEMINI_MODEL')
  const order = modelTryOrder(preferred)
  const api = await client()

  let lastError: unknown
  for (const modelName of order) {
    try {
      const model = api.getGenerativeModel({ model: modelName })
      return await model.generateContent(parts)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const isTransient =
        msg.includes('503') ||
        msg.includes('429') ||
        msg.includes('404') ||
        msg.toLowerCase().includes('unavailable') ||
        msg.toLowerCase().includes('not found') ||
        msg.toLowerCase().includes('high demand')
      if (!isTransient) throw e
      lastError = e
    }
  }
  throw lastError
}

export const parsedItemSchema = z.object({
  raw_name: z.string(),
  product_name: z.string().nullable(),
  quantity: z.string(), // 生表記（"15c2" 等）。換算は lib/calculations/parse-quantity に委譲
  unit: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  /** ★等で「新規追加/変更」と明示された明細（顧客が変更箇所をマークしている）。 */
  is_new: z.boolean().optional(),
})
export type ParsedItem = z.infer<typeof parsedItemSchema>

const normalResultSchema = z.object({ items: z.array(parsedItemSchema) })

export const parsedOrderSchema = z.object({
  customer_name: z.string().nullable(),
  /** 納入先（届け先）。マトリクスFAXの得意先/納入先列。請求先(customer_name)とは別。無ければ null。 */
  destination_name: z.string().nullable().optional(),
  delivery_date: z.string().nullable(),
  items: z.array(parsedItemSchema),
})
export type ParsedOrder = z.infer<typeof parsedOrderSchema>

export const ordersResultSchema = z.object({
  is_order: z.boolean(),
  orders: z.array(parsedOrderSchema),
})
export type OrdersResult = z.infer<typeof ordersResultSchema>

export const diffResultSchema = z.object({
  added: z.array(parsedItemSchema),
  modified: z.array(parsedItemSchema),
  removed: z.array(parsedItemSchema),
})
export type DiffResult = z.infer<typeof diffResultSchema>

/** 通常モードの基本指示。設定 GEMINI_PROMPT_NORMAL があればそちらを優先する。 */
async function getBaseInstruction(): Promise<string> {
  return (await getSetting('GEMINI_PROMPT_NORMAL')) || DEFAULT_GEMINI_PROMPT_NORMAL
}

/** 差分モードの追加指示。設定 GEMINI_PROMPT_DIFF があればそちらを優先する。 */
async function getDiffInstruction(): Promise<string> {
  return (await getSetting('GEMINI_PROMPT_DIFF')) || DEFAULT_GEMINI_PROMPT_DIFF
}

async function logUsage(mode: string, channel: string, success: boolean, tokens?: number) {
  try {
    await createAdminClient()
      .from('gemini_usage_log')
      .insert({ mode, channel, success, tokens_used: tokens ?? null })
  } catch {
    // 記録失敗で本処理は止めない（無料枠管理は best-effort）
  }
}

/**
 * 通常モード：画像（base64）またはテキストから items を抽出。
 * hintText（取引先ごとの学習・lib/ingestion/learning.buildCustomerHintText）があれば
 * few-shot としてプロンプトに注入し、その取引先の表記の癖に合わせる。
 */
export async function analyzeNormal(
  input: { imageBase64?: string; mimeType?: string; text?: string },
  channel: string,
  hintText?: string,
  /** この解析だけに使う一回限りのプロンプト上書き（手動OCR画面用）。設定は変更しない。 */
  promptOverride?: string,
): Promise<ParsedItem[]> {
  const baseInstruction =
    promptOverride && promptOverride.trim() !== '' ? promptOverride : await getBaseInstruction()
  const parts: Part[] = [{ text: baseInstruction }]
  if (hintText && hintText.trim() !== '') parts.push({ text: hintText })
  if (input.imageBase64) {
    parts.push({ inlineData: { data: input.imageBase64, mimeType: input.mimeType || 'image/png' } })
  }
  if (input.text) parts.push({ text: `注文テキスト:\n${input.text}` })

  try {
    const res = await generateWithFallback(parts)
    const json = extractJson(res.response.text())
    const parsed = normalResultSchema.parse(json)
    await logUsage('normal', channel, true, res.response.usageMetadata?.totalTokenCount)
    return parsed.items
  } catch (e) {
    await logUsage('normal', channel, false)
    throw e
  }
}

/** 差分モード：前回確定 items を注入し、追加/変更/削除を返す（丸ごと再送対応）。 */
export async function analyzeDiff(
  input: { imageBase64?: string; mimeType?: string; text?: string },
  previousItems: ParsedItem[],
  channel: string,
  hintText?: string,
): Promise<DiffResult> {
  const diffExtra = await getDiffInstruction()
  const instruction = `${await getBaseInstruction()}
${hintText && hintText.trim() !== '' ? hintText + '\n' : ''}${diffExtra}
前回確定明細: ${JSON.stringify(previousItems)}`
  const parts: Part[] = [{ text: instruction }]
  if (input.imageBase64) {
    parts.push({ inlineData: { data: input.imageBase64, mimeType: input.mimeType || 'image/png' } })
  }
  if (input.text) parts.push({ text: `注文テキスト:\n${input.text}` })

  try {
    const res = await generateWithFallback(parts)
    const json = extractJson(res.response.text())
    const parsed = diffResultSchema.parse(json)
    await logUsage('diff', channel, true, res.response.usageMetadata?.totalTokenCount)
    return parsed
  } catch (e) {
    await logUsage('diff', channel, false)
    throw e
  }
}

/**
 * 手動OCR専用：FAX 1枚から orders[] 形式で複数注文を抽出。
 * is_order=false の場合は受注書ではない（仕向け別出荷数量表等）。
 * プロンプトは設定DB非対応（DEFAULT_GEMINI_PROMPT_ORDERS 固定）。
 */
export async function analyzeOrders(
  input: { imageBase64?: string; mimeType?: string; text?: string },
  channel: string,
  /** 取引先ごとの表記学習ヒント（lib/ingestion/learning.buildCustomerHintText の出力）。 */
  hintText?: string,
): Promise<OrdersResult> {
  const parts: Part[] = [{ text: DEFAULT_GEMINI_PROMPT_ORDERS }]
  if (hintText && hintText.trim() !== '') parts.push({ text: hintText })
  if (input.imageBase64) {
    parts.push({ inlineData: { data: input.imageBase64, mimeType: input.mimeType || 'image/png' } })
  }
  if (input.text) parts.push({ text: `注文テキスト:\n${input.text}` })

  try {
    const res = await generateWithFallback(parts)
    const json = extractJson(res.response.text())
    const parsed = ordersResultSchema.parse(json)
    await logUsage('orders', channel, true, res.response.usageMetadata?.totalTokenCount)
    return parsed
  } catch (e) {
    await logUsage('orders', channel, false)
    throw e
  }
}

/** ```json フェンスや前後ノイズを取り除いて JSON を取り出す。 */
function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const raw = fenced ? fenced[1]! : text
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end === -1) throw new Error('Gemini 応答に JSON が見つかりません')
  return JSON.parse(raw.slice(start, end + 1))
}
