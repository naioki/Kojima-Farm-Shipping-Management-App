import 'server-only'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSetting } from '@/lib/settings'
import { DEFAULT_GEMINI_PROMPT_NORMAL, DEFAULT_GEMINI_PROMPT_DIFF, DEFAULT_GEMINI_PROMPT_ORDERS } from './prompts'

/**
 * Gemini 解析（features.md §4）。通常モード（画像/テキスト → items[]）と
 * 差分モード（前回確定 items を注入 → added/modified/removed）を提供する。
 * 全項目に self-confidence(0..1) を採点させ、呼び出しごとに gemini_usage_log を記録する。
 *
 * モデル: gemini-2.0-flash（無料枠 ~1500req/日）。APIキーは Secret Manager 由来の環境変数。
 */

/** モデル名は設定（DB→env）→ 既定 gemini-2.5-flash（無料枠）。 */
async function getModel(): Promise<string> {
  return (await getSetting('GEMINI_MODEL')) || 'gemini-2.5-flash'
}

export const parsedItemSchema = z.object({
  raw_name: z.string(),
  product_name: z.string().nullable(),
  quantity: z.string(), // 生表記（"15c2" 等）。換算は lib/calculations/parse-quantity に委譲
  unit: z.string().nullable(),
  confidence: z.number().min(0).max(1),
})
export type ParsedItem = z.infer<typeof parsedItemSchema>

const normalResultSchema = z.object({ items: z.array(parsedItemSchema) })

export const parsedOrderSchema = z.object({
  customer_name: z.string().nullable(),
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

/** APIキーは設定（DB→env）。設定画面 or Secret Manager で投入する。 */
async function client(): Promise<GoogleGenerativeAI> {
  const key = await getSetting('GEMINI_API_KEY')
  if (!key) throw new Error('GEMINI_API_KEY が未設定です（設定画面 または Secret Manager で投入）')
  return new GoogleGenerativeAI(key)
}

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
  const model = (await client()).getGenerativeModel({ model: await getModel() })
  const baseInstruction =
    promptOverride && promptOverride.trim() !== '' ? promptOverride : await getBaseInstruction()
  const parts: Array<{ text: string } | { inlineData: { data: string; mimeType: string } }> = [
    { text: baseInstruction },
  ]
  if (hintText && hintText.trim() !== '') parts.push({ text: hintText })
  if (input.imageBase64) {
    parts.push({
      inlineData: { data: input.imageBase64, mimeType: input.mimeType || 'image/png' },
    })
  }
  if (input.text) parts.push({ text: `注文テキスト:\n${input.text}` })

  try {
    const res = await model.generateContent(parts)
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
  const model = (await client()).getGenerativeModel({ model: await getModel() })
  const diffExtra = await getDiffInstruction()
  const instruction = `${await getBaseInstruction()}
${hintText && hintText.trim() !== '' ? hintText + '\n' : ''}${diffExtra}
前回確定明細: ${JSON.stringify(previousItems)}`
  const parts: Array<{ text: string } | { inlineData: { data: string; mimeType: string } }> = [
    { text: instruction },
  ]
  if (input.imageBase64) {
    parts.push({
      inlineData: { data: input.imageBase64, mimeType: input.mimeType || 'image/png' },
    })
  }
  if (input.text) parts.push({ text: `注文テキスト:\n${input.text}` })

  try {
    const res = await model.generateContent(parts)
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
  const model = (await client()).getGenerativeModel({ model: await getModel() })
  const parts: Array<{ text: string } | { inlineData: { data: string; mimeType: string } }> = [
    { text: DEFAULT_GEMINI_PROMPT_ORDERS },
  ]
  if (hintText && hintText.trim() !== '') parts.push({ text: hintText })
  if (input.imageBase64) {
    parts.push({ inlineData: { data: input.imageBase64, mimeType: input.mimeType || 'image/png' } })
  }
  if (input.text) parts.push({ text: `注文テキスト:\n${input.text}` })

  try {
    const res = await model.generateContent(parts)
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
