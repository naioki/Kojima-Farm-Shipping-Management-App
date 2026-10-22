import 'server-only'
import { GoogleGenerativeAI, type GenerateContentResult, type Part } from '@google/generative-ai'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSetting } from '@/lib/settings'
import { jstTodayStr, shiftDateStr } from '@/lib/dates'
import type { AiRule } from '@/types/database'
import {
  calculateContainerBoxes,
  determineContainerType,
  determineUnitCount,
  formatQuantityCaseText,
  generateOrderKey,
  normalizeItemName,
  normalizeSpecDisplay,
} from '@/lib/pipeline/schemas'
import {
  DEFAULT_GEMINI_PROMPT_NORMAL,
  DEFAULT_GEMINI_PROMPT_DIFF,
  DEFAULT_GEMINI_PROMPT_ORDERS,
  DEFAULT_GEMINI_PROMPT_REVISION,
  FALLBACK_CLIENT_RULES_SUMMARY,
} from './prompts'
import { highModelTryOrder, modelTryOrder } from './models'

/**
 * `ai_rules` のインメモリキャッシュ（60秒TTL）。
 * 連続FAX受信時のSupabaseクエリ負荷を削減しつつ、ルール追加・編集時は `invalidateAiRulesCache()` で即時破棄する。
 */
const AI_RULES_CACHE_TTL_MS = 60_000
let aiRulesCache: { rules: AiRule[]; expiresAt: number } | null = null

export function invalidateAiRulesCache(): void {
  aiRulesCache = null
}

/** APIキーは設定（DB→env）。設定画面 or Secret Manager で投入する。 */
async function client(): Promise<GoogleGenerativeAI> {
  const key = await getSetting('GEMINI_API_KEY')
  if (!key) throw new Error('GEMINI_API_KEY が未設定です（設定画面 または Secret Manager で投入）')
  return new GoogleGenerativeAI(key)
}

/**
 * 503/429/404 のときだけ次のモデルへフォールバックしながら generateContent を試みる。
 * - temperature: 0.0 による完全決定論的出力を強制
 * - responseMimeType: 'application/json' でマークダウンフェンス等の余分な出力トークンを抑制
 * - systemInstruction はモデル設定側のみに渡し、parts 側との二重送信（トークン2倍消費）を防止
 */
async function generateWithFallback(
  parts: Part[],
  systemInstruction?: string,
  modelOverride?: string,
  tier: 'main' | 'high' = 'main',
): Promise<{ result: GenerateContentResult; usedModel: string }> {
  let order: string[]
  if (modelOverride && modelOverride.trim() !== '') {
    order = modelTryOrder(modelOverride.trim())
  } else if (tier === 'high') {
    const preferredHigh = await getSetting('GEMINI_MODEL_HIGH')
    order = highModelTryOrder(preferredHigh)
  } else {
    const preferredMain = await getSetting('GEMINI_MODEL')
    order = modelTryOrder(preferredMain)
  }
  const api = await client()

  let lastError: unknown
  for (const modelName of order) {
    const model = api.getGenerativeModel({
      model: modelName,
      ...(systemInstruction ? { systemInstruction } : {}),
      generationConfig: {
        temperature: 0.0,
        responseMimeType: 'application/json',
      },
    })

    // 同一モデルで最大2回試行（初回失敗が過負荷/レート制限の場合は800msバックオフ待機して再試行）
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const result = await model.generateContent(parts)
        return { result, usedModel: modelName }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        const isTransient =
          msg.includes('503') ||
          msg.includes('429') ||
          msg.includes('404') ||
          msg.toLowerCase().includes('unavailable') ||
          msg.toLowerCase().includes('not found') ||
          msg.toLowerCase().includes('high demand') ||
          msg.toLowerCase().includes('quota') ||
          msg.toLowerCase().includes('resource_exhausted')
        if (!isTransient) throw e
        lastError = e
        if (attempt === 0) {
          await new Promise((r) => setTimeout(r, 800))
        }
      }
    }
  }
  throw lastError
}

export const parsedItemSchema = z.object({
  raw_name: z.string(),
  product_name: z.string().nullable(),
  quantity: z.string(), // 総パック数または生表記
  unit: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  /** 指示書 v2.3 & ARCHITECTURE.md Ver 4.1 拡張フィールド（後方互換のため nullish） */
  spec: z.string().nullish(),
  packs_per_case: z.number().int().positive().nullish(),
  cases: z.number().int().nonnegative().nullish(),
  remainder_packs: z.number().nonnegative().nullish(),
  box_count: z.number().int().nonnegative().nullish(),
  container_type: z.string().nullish(),
  quantity_case_text: z.string().nullish(),
  order_key: z.string().nullish(),
  is_case_input: z.boolean().nullish(),
  is_approximate: z.boolean().nullish(),
  is_handwritten_modified: z.boolean().nullish(),
  has_reply_required: z.boolean().nullish(),
  explicit_cancel_in_slip: z.boolean().nullish(),
  is_new_addition: z.boolean().nullish(),
  bag_type: z.string().nullish(),
  has_seal: z.boolean().nullish(),
  seal_text: z.string().nullish(),
  has_card: z.boolean().nullish(),
  note: z.string().nullish(),
  needs_review_reason: z.string().nullish(),
})
export type ParsedItem = z.infer<typeof parsedItemSchema>

const normalResultSchema = z.object({ items: z.array(parsedItemSchema) })

export const parsedOrderSchema = z.object({
  customer_name: z.string().nullable(),
  /** 納入先（届け先）。マトリクスFAXの得意先/納入先列。請求先(customer_name)とは別。無ければ null。 */
  destination_name: z.string().nullable().optional(),
  delivery_date: z.string().nullable(),
  slip_no: z.string().nullish(),
  note: z.string().nullish(),
  items: z.array(parsedItemSchema),
})
export type ParsedOrder = z.infer<typeof parsedOrderSchema>

export const ordersResultSchema = z.object({
  is_order: z.boolean(),
  skip_reason: z.string().nullish(),
  slip_no: z.string().nullish(),
  is_full_resending_matrix: z.boolean().nullish(),
  orders: z.array(parsedOrderSchema),
  /** 実際に応答したGeminiモデルID（設定画面・ドライラン確認用） */
  used_model: z.string().optional(),
  /** 動的注入された有効 ai_rules 件数（Kojima-FAX 連携 loaded_dynamic_rules_count 互換） */
  applied_rules_count: z.number().optional(),
})
export type OrdersResult = z.infer<typeof ordersResultSchema>

export const diffResultSchema = z.object({
  added: z.array(parsedItemSchema),
  modified: z.array(parsedItemSchema),
  removed: z.array(parsedItemSchema),
})
export type DiffResult = z.infer<typeof diffResultSchema>

export const revisionResultSchema = z.object({
  orders: z.array(parsedOrderSchema),
  ai_learned_rule_candidate: z.string().nullish(),
  revision_summary: z.string().nullish(),
})
export type RevisionResult = z.infer<typeof revisionResultSchema>

/** 法人格・空白・括弧を除いた正規化キー（取引先ルール絞り込み用） */
function normalizeClientKey(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/農事組合法人|株式会社|有限会社|合同会社|\(株\)|\(有\)/g, '')
    .replace(/[\s　（）()]/g, '')
    .toLowerCase()
}

/**
 * Supabase の `ai_rules` テーブルから現在有効（is_active = true）なルールを取得する（60秒キャッシュ付き）。
 * 発信元FAX番号や宛先帳名から `clientName` が特定できている場合は、「共通」＋該当取引先のルールのみに絞り込み、
 * 不要な他社ルールのトークン消費を削減しつつAIの注意力を該当取引先に集中させる。
 */
export async function fetchActiveAiRules(clientName?: string | null): Promise<AiRule[]> {
  let allRules: AiRule[] = []
  const now = Date.now()

  if (aiRulesCache && aiRulesCache.expiresAt > now) {
    allRules = aiRulesCache.rules
  } else {
    try {
      const admin = createAdminClient()
      const { data, error } = await admin
        .from('ai_rules')
        .select('id, client_name, rule_text, is_active, priority, category, source, created_at, updated_at')
        .eq('is_active', true)
        .order('priority', { ascending: true })
        .order('created_at', { ascending: true })

      if (error) {
        console.error('[lib/gemini/analyze] ai_rules の取得に失敗:', error.message)
        return []
      }
      allRules = (data ?? []) as AiRule[]
      aiRulesCache = { rules: allRules, expiresAt: now + AI_RULES_CACHE_TTL_MS }
    } catch (e) {
      console.error('[lib/gemini/analyze] ai_rules 取得中に例外:', e)
      return []
    }
  }

  if (!clientName || !clientName.trim()) return allRules
  const targetKey = normalizeClientKey(clientName)
  if (!targetKey) return allRules

  const filtered = allRules.filter((r) => {
    if (r.client_name === '共通') return true
    const ruleKey = normalizeClientKey(r.client_name)
    return ruleKey.length > 0 && (ruleKey.includes(targetKey) || targetKey.includes(ruleKey))
  })
  // 万一該当取引先のルールが1件もヒットしなかった場合は安全側で全ルールを返す
  const hasSpecific = filtered.some((r) => r.client_name !== '共通')
  return hasSpecific ? filtered : allRules
}

/**
 * 取得した `ai_rules` をシステム指示注入用のコンパクトなテキストブロックに整形する。
 */
export function buildAiRulesSection(rules: AiRule[]): string {
  if (rules.length === 0) return FALLBACK_CLIENT_RULES_SUMMARY
  const grouped = new Map<string, string[]>()
  for (const r of rules) {
    const list = grouped.get(r.client_name) ?? []
    list.push(`- ${r.rule_text}`)
    grouped.set(r.client_name, list)
  }
  const sections: string[] = ['# 【動的適用ルール(ai_rules)】']
  for (const [clientName, lines] of grouped.entries()) {
    sections.push(`## ${clientName}\n${lines.join('\n')}`)
  }
  return sections.join('\n')
}

/**
 * 相対日付（「明日」「明後日」など）を正確に解決するためのJST基準日コンテキスト。
 */
function buildDateContext(): string {
  const today = jstTodayStr()
  const tomorrow = shiftDateStr(today, 1)
  const dayAfterTomorrow = shiftDateStr(today, 2)
  return `# 基準日(JST): 今日=${today} / 明日=${tomorrow} / 明後日=${dayAfterTomorrow}`
}

/**
 * 入力データ（画像/PDF・テキスト・学習ヒント）のみを user contents (`parts`) に構築する。
 * `systemInstruction` を `parts` に重複投入しないことで入力トークンを約50%削減する。
 */
function buildInputParts(
  input: { imageBase64?: string; mimeType?: string; text?: string },
  hintText?: string,
): Part[] {
  const parts: Part[] = []
  if (hintText && hintText.trim() !== '') {
    parts.push({ text: hintText.trim() })
  }
  if (input.imageBase64) {
    parts.push({
      inlineData: { data: input.imageBase64, mimeType: input.mimeType || 'image/png' },
    })
  }
  if (input.text && input.text.trim() !== '') {
    parts.push({ text: `注文テキスト:\n${input.text.trim()}` })
  }
  if (parts.length === 0) {
    parts.push({ text: '注文データを解析しJSONを出力してください。' })
  }
  return parts
}

/**
 * 取引先名・納入先名・規格の標準表記補正（ARCHITECTURE.md 第4章 / schemas.py `_apply_normalization` 継承）。
 */
export function normalizeCustomerAndDestination(params: {
  customerName?: string | null
  destinationName?: string | null
  spec?: string | null
  isSample?: boolean
}): {
  customerName: string | null
  destinationName: string | null
  spec: string | null
} {
  let customerName = params.customerName?.trim() || null
  let destinationName = params.destinationName?.trim() || null
  let spec = params.spec ? normalizeSpecDisplay(params.spec) : null

  const normClient = (customerName ?? '').normalize('NFKC')
  const normDest = (destinationName ?? '').normalize('NFKC')
  const isSample = Boolean(
    params.isSample ||
    normDest.includes('サンプル') ||
    (params.spec ?? '').includes('サンプル')
  )

  if (normClient.includes('勘兵衛')) {
    customerName = '株式会社勘兵衛'
    if (!destinationName) destinationName = 'イオンタウン向け'
    if (!spec) spec = '200gFG×20入'
  } else if (normClient.includes('農業総合研究所') || normClient.toUpperCase().includes('NSK')) {
    customerName = '株式会社農業総合研究所（NSK）'
    if (!spec) spec = '200gUP (入数24)'
  } else if (normClient.includes('房総食料')) {
    customerName = '農事組合法人 房総食料センター'
    if (normDest.includes('ちばセット') || normDest.includes('千葉セット')) {
      destinationName = 'ちばセット用'
      if (!spec || spec.includes('250g') || spec.includes('200g')) spec = '200g (入数30)'
    } else if (normDest.includes('box') || normDest.includes('ボックス')) {
      destinationName = 'BOX用'
      if (!spec || spec.includes('250g') || spec.includes('200g')) spec = '200g (入数20)'
    } else if (!destinationName) {
      destinationName = 'BOX用'
      if (!spec || spec.includes('250g')) spec = '200g (入数20)'
    }
  } else if (normClient.includes('和郷園')) {
    customerName = '農事組合法人 和郷園'
    // 4.1 OCR文字潰れ補正
    if (normDest.includes('岩槻') || (normDest.includes('パルシステム') && !normDest.includes('相模'))) {
      if (isSample) {
        destinationName = 'パルシステム 岩槻 (サンプル)'
      } else {
        destinationName = 'パルシステム 岩槻'
      }
      if (!spec) spec = '2〜3株 (入数20)'
    } else if (
      ['口一天', '列述', 'グリーンボックス(戸田)', 'グリーンボックス（戸田）'].some((k) =>
        normDest.includes(k),
      )
    ) {
      if (isSample) {
        destinationName = 'ちばコープ グリンBOXサンプル戸田'
      } else {
        destinationName = 'ちばコープ グリーンボックス(戸田)'
      }
      if (!spec) spec = '2〜3株 (入数20)'
    } else if (isSample || normDest.includes('グリンBOX')) {
      if (normDest.includes('パルシステム') || normDest.includes('パル') || normDest.includes('岩槻')) {
        destinationName = 'パルシステム 岩槻 (サンプル)'
      } else {
        destinationName = 'ちばコープ グリンBOXサンプル戸田'
      }
      if (!spec) spec = '2〜3株 (入数20)'
    }
  }

  return { customerName, destinationName, spec }
}

/**
 * 入数（20 / 24）換算・箱数自動検算・固定書式・注文キー生成（指示書 v2.3 & ARCHITECTURE.md Ver 4.1 準拠）。
 */
export function verifyAndNormalizeItem(
  item: ParsedItem,
  customerName?: string | null,
  context?: { destinationName?: string | null; deliveryDate?: string | null },
): ParsedItem {
  const std = normalizeCustomerAndDestination({
    customerName,
    destinationName: context?.destinationName,
    spec: item.spec,
  })
  const cust = (std.customerName ?? customerName ?? '').toLowerCase()
  const isKanbei = cust.includes('勘兵衛')

  const packsPerCase = determineUnitCount(
    std.customerName ?? customerName,
    std.spec ?? item.raw_name,
    item.packs_per_case,
    item.product_name ?? item.raw_name,
  )

  let quantityStr = item.quantity.trim()
  let confidence = item.confidence
  let needsReviewReason = item.needs_review_reason ?? null
  let note = item.note ?? null

  // ★印の特記事項からの分離（ARCHITECTURE.md §4.1: ★は新規追加枠のみに入れ特記事項には入れない）
  let isNewAddition = Boolean(item.is_new_addition)
  if (note && note.includes('★')) {
    isNewAddition = true
    note = note.replace(/★/g, '').trim() || null
  }

  // 「約80」などの暫定表記チェック（セル単位限定。伝票全体のnoteに引きずられない）
  const hasApprox =
    Boolean(item.is_approximate) ||
    quantityStr.includes('約') ||
    item.raw_name.includes('約') ||
    (item.note ?? '').includes('約')

  if (hasApprox && !item.is_handwritten_modified) {
    confidence = Math.min(confidence, 0.55)
    needsReviewReason = needsReviewReason ?? '約表記（暫定値・要確認）'
    quantityStr = quantityStr.replace(/約\s*/g, '')
  } else if (item.is_handwritten_modified) {
    const handNote = `手書き修正（${quantityStr.replace(/約\s*/g, '')}点）`
    if (!(note ?? '').includes('手書き修正')) {
      note = note ? `${handNote} / ${note}` : handNote
    }
  }

  // 和郷園スタイル "300+0 (15-0)" がそのまま quantity に入った場合は先頭数値を採用
  const wagoenMatch = quantityStr.match(/^(\d+)\s*\+\s*(\d+)/)
  if (wagoenMatch) {
    const basePacks = Number(wagoenMatch[1])
    const extraPacks = Number(wagoenMatch[2])
    quantityStr = String(basePacks + extraPacks)
  }

  // "5ケース" / "2 C/S" / "2cs" 表記の総パック数換算
  const caseUnitMatch = quantityStr.match(/^(\d+(?:\.\d+)?)\s*(?:ケース|c\/s|cs|箱)$/i)
  if (caseUnitMatch) {
    const c = Number(caseUnitMatch[1])
    quantityStr = String(Math.round(c * packsPerCase))
  } else if (
    (isKanbei || item.is_case_input) &&
    ((item.unit ?? '').toLowerCase().includes('c') || item.is_case_input) &&
    /^\d+$/.test(quantityStr)
  ) {
    // 勘兵衛で単位が C/S のままケース数が入っている場合
    const c = Number(quantityStr)
    if (item.cases == null || item.cases === c) {
      quantityStr = String(c * packsPerCase)
    }
  }

  const numericTotal = Number(quantityStr)
  let cases = item.cases ?? null
  let remainder = item.remainder_packs ?? null
  let boxCount = item.box_count ?? null
  let quantityCaseText = item.quantity_case_text ?? null

  if (Number.isFinite(numericTotal) && numericTotal >= 0) {
    const computedCases = Math.floor(numericTotal / packsPerCase)
    const computedRemainder = numericTotal % packsPerCase

    // AIが cases / remainder_packs を返している場合、検算して不一致なら要確認にする
    if (cases != null && remainder != null && numericTotal > 0) {
      const expectedTotal = cases * packsPerCase + remainder
      if (expectedTotal !== numericTotal && !(isKanbei && cases === numericTotal)) {
        confidence = Math.min(confidence, 0.5)
        needsReviewReason =
          needsReviewReason ??
          `入数検算不一致（総数${numericTotal}P ≠ ${cases}ケース×${packsPerCase}入＋端数${remainder}P）`
      }
    } else {
      cases = computedCases
      remainder = computedRemainder
    }

    const finalCases = cases ?? computedCases
    const finalRemainder = remainder ?? computedRemainder
    boxCount = item.explicit_cancel_in_slip ? 0 : calculateContainerBoxes(finalCases, finalRemainder)
    quantityCaseText = formatQuantityCaseText(numericTotal, finalCases, finalRemainder)
  }

  const normalizedProductName = normalizeItemName(item.product_name || 'チンゲン菜')
  const resolvedSpec = std.spec ?? (item.spec ? normalizeSpecDisplay(item.spec) : null)
  const resolvedContainer =
    (item.container_type as string | null) ||
    determineContainerType(std.customerName ?? customerName, std.destinationName ?? context?.destinationName)

  const orderKey =
    item.order_key ||
    generateOrderKey({
      clientName: std.customerName ?? customerName ?? '',
      deliveryDate: context?.deliveryDate ?? '',
      destination: std.destinationName ?? context?.destinationName ?? '',
      itemName: normalizedProductName,
      spec: resolvedSpec ?? '',
    })

  // パッキング資材（袋種別・シール・生産者カード）の決定論的抽出（FAX記載＋取引先固有ルール）
  const combinedText = [resolvedSpec, item.raw_name, note, item.bag_type, item.seal_text]
    .filter(Boolean)
    .join(' ')
    .normalize('NFKC')

  let bagType: string | null = item.bag_type?.trim() || null
  if (!bagType) {
    if (/FG|印字/i.test(combinedText) || isKanbei) {
      bagType = /FG/i.test(combinedText) || isKanbei ? '印字袋(FG)' : '印字袋'
    } else if (/無地/.test(combinedText)) {
      bagType = '無地袋'
    } else if (/スタンド/.test(combinedText)) {
      bagType = 'スタンドパック'
    } else if (/ボードン/.test(combinedText)) {
      bagType = 'ボードン袋'
    }
  }

  let hasSeal: boolean | null = item.has_seal ?? null
  let sealText: string | null = item.seal_text?.trim() || null
  if (/シール\s*(?:あり|有|付)|バーコード|JANシール|値札/.test(combinedText)) {
    hasSeal = true
    if (!sealText) {
      const nskSealMatch = combinedText.match(/シールあり[（(][^）)]+[）)]/)
      sealText = nskSealMatch ? nskSealMatch[0] : 'シールあり'
    }
  } else if (/シール\s*(?:なし|無|不要)/.test(combinedText)) {
    hasSeal = false
    sealText = 'シールなし'
  }

  let hasCard: boolean | null = item.has_card ?? null
  if (/生産者カード|カード\s*(?:入れる|あり|有|入|同梱)/.test(combinedText)) {
    hasCard = true
  } else if (/カード\s*(?:なし|無|不要)/.test(combinedText)) {
    hasCard = false
  }

  return {
    ...item,
    product_name: normalizedProductName,
    quantity: quantityStr,
    unit: item.unit || 'P',
    confidence,
    spec: resolvedSpec,
    packs_per_case: packsPerCase,
    cases,
    remainder_packs: remainder,
    box_count: boxCount,
    container_type: resolvedContainer,
    quantity_case_text: quantityCaseText,
    order_key: orderKey,
    is_new_addition: isNewAddition,
    bag_type: bagType,
    has_seal: hasSeal,
    seal_text: sealText,
    has_card: hasCard,
    note,
    needs_review_reason: needsReviewReason,
  }
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
 */
export async function analyzeNormal(
  input: { imageBase64?: string; mimeType?: string; text?: string },
  channel: string,
  hintText?: string,
  /** この解析だけに使う一回限りのプロンプト上書き（手動OCR画面用）。設定は変更しない。 */
  promptOverride?: string,
): Promise<ParsedItem[]> {
  const [baseInstruction, activeRules] = await Promise.all([
    promptOverride && promptOverride.trim() !== '' ? Promise.resolve(promptOverride) : getBaseInstruction(),
    fetchActiveAiRules(),
  ])
  const rulesSection = buildAiRulesSection(activeRules)
  const systemInstruction = [baseInstruction, rulesSection, buildDateContext()].filter(Boolean).join('\n\n')
  const parts = buildInputParts(input, hintText)

  try {
    const { result: res } = await generateWithFallback(parts, systemInstruction)
    const json = extractJson(res.response.text())
    const parsed = normalResultSchema.parse(json)
    await logUsage('normal', channel, true, res.response.usageMetadata?.totalTokenCount)
    return parsed.items.map((it) => verifyAndNormalizeItem(it))
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
  const [baseInstruction, diffExtra, activeRules] = await Promise.all([
    getBaseInstruction(),
    getDiffInstruction(),
    fetchActiveAiRules(),
  ])
  const rulesSection = buildAiRulesSection(activeRules)
  const systemInstruction = [
    baseInstruction,
    rulesSection,
    buildDateContext(),
    diffExtra,
    `前回確定明細:${JSON.stringify(previousItems)}`,
  ]
    .filter(Boolean)
    .join('\n\n')
  const parts = buildInputParts(input, hintText)

  try {
    const { result: res } = await generateWithFallback(parts, systemInstruction, undefined, 'high')
    const json = extractJson(res.response.text())
    const parsed = diffResultSchema.parse(json)
    await logUsage('diff', channel, true, res.response.usageMetadata?.totalTokenCount)
    return {
      added: parsed.added.map((it) => verifyAndNormalizeItem(it)),
      modified: parsed.modified.map((it) => verifyAndNormalizeItem(it)),
      removed: parsed.removed.map((it) => verifyAndNormalizeItem(it)),
    }
  } catch (e) {
    await logUsage('diff', channel, false)
    throw e
  }
}

/**
 * FAX・PDF・テキスト注文の標準解析エンジン（orders[] 形式）。
 * - 省トークン化されたコアプロンプト + Supabase `ai_rules`（取引先特定時は該当取引先＋共通のみ）を `systemInstruction` に1回だけ注入。
 * - temperature: 0.0 + responseMimeType: 'application/json' で高速・決定論的に抽出し、TypeScript側で22列検算・正規化を行う。
 */
export async function analyzeOrders(
  input: { imageBase64?: string; mimeType?: string; text?: string },
  channel: string,
  /** 取引先ごとの表記学習ヒント（lib/ingestion/learning.buildCustomerHintText の出力）。 */
  hintText?: string,
  /** 取引先名が事前に特定できている場合のフィルタヒント（任意） */
  clientNameHint?: string | null,
  /** テスト実行時の一時モデル指定（省略時は設定 GEMINI_MODEL） */
  modelOverride?: string,
): Promise<OrdersResult> {
  const activeRules = await fetchActiveAiRules(clientNameHint)
  const rulesSection = buildAiRulesSection(activeRules)
  const systemInstruction = [DEFAULT_GEMINI_PROMPT_ORDERS, rulesSection, buildDateContext()]
    .filter(Boolean)
    .join('\n\n')
  const parts = buildInputParts(input, hintText)

  try {
    const { result: res, usedModel } = await generateWithFallback(parts, systemInstruction, modelOverride)
    const json = extractJson(res.response.text())
    const parsed = ordersResultSchema.parse(json)
    await logUsage('orders', channel, true, res.response.usageMetadata?.totalTokenCount)

    if (!parsed.is_order || parsed.orders.length === 0) {
      return {
        is_order: false,
        skip_reason: parsed.skip_reason ?? 'チンゲン菜の注文を含まないFAXのためスキップ',
        slip_no: parsed.slip_no ?? null,
        is_full_resending_matrix: false,
        orders: [],
        used_model: usedModel,
        applied_rules_count: activeRules.length,
      }
    }

    // 同一伝票内の重複注文キーに #2, #3 を付与するためのカウンタ（ARCHITECTURE.md §3.2）
    const orderKeyCounts = new Map<string, number>()

    const normalizedOrders: ParsedOrder[] = parsed.orders
      .map((order) => {
        const isSampleOrd = Boolean(
          (order.note ?? '').includes('サンプル') ||
          (order.destination_name ?? '').includes('サンプル') ||
          (order.items ?? []).some((i) => (i.note ?? '').includes('サンプル'))
        )
        const std = normalizeCustomerAndDestination({
          customerName: order.customer_name,
          destinationName: order.destination_name,
          isSample: isSampleOrd,
        })
        const resolvedCustomer = std.customerName ?? order.customer_name
        const resolvedDest = std.destinationName ?? order.destination_name ?? null

        const items = order.items
          // 小島農園の非対象品目（きゅうり・ししとう等）のみ除外。チンゲン菜、トマト、長ネギ、ミニ白菜等は通過させる
          .filter((it) => {
            const name = `${it.product_name ?? ''} ${it.raw_name}`.toLowerCase()
            const isExcludedCrop =
              (name.includes('きゅうり') || name.includes('胡瓜') || name.includes('ししとう')) &&
              !name.includes('チンゲン') &&
              !name.includes('ちんげん') &&
              !name.includes('青梗菜') &&
              !name.includes('トマト') &&
              !name.includes('ネギ') &&
              !name.includes('ねぎ') &&
              !name.includes('白菜')
            return !isExcludedCrop
          })
          .map((it) => {
            const normalized = verifyAndNormalizeItem(it, resolvedCustomer, {
              destinationName: resolvedDest,
              deliveryDate: order.delivery_date,
            })
            const baseKey = generateOrderKey({
              clientName: resolvedCustomer ?? '',
              deliveryDate: order.delivery_date ?? '',
              destination: resolvedDest ?? '',
              itemName: normalized.product_name ?? 'チンゲン菜',
              spec: normalized.spec ?? '',
              duplicateIndex: 1,
            })
            const nextIdx = (orderKeyCounts.get(baseKey) ?? 0) + 1
            orderKeyCounts.set(baseKey, nextIdx)
            const finalKey = generateOrderKey({
              clientName: resolvedCustomer ?? '',
              deliveryDate: order.delivery_date ?? '',
              destination: resolvedDest ?? '',
              itemName: normalized.product_name ?? 'チンゲン菜',
              spec: normalized.spec ?? '',
              duplicateIndex: nextIdx,
            })
            return {
              ...normalized,
              order_key: finalKey,
            }
          })

        return {
          ...order,
          customer_name: resolvedCustomer,
          destination_name: resolvedDest,
          slip_no: order.slip_no ?? parsed.slip_no ?? null,
          items,
        }
      })
      .filter((o) => o.items.length > 0)

    // ── 重要箇所（低確信・手書き修正・入数検算不一致・日付/取引先不明）のみ高精度モデル(GEMINI_MODEL_HIGH: gemini-3.8-flash等)で自動再検証 ──
    const needsEscalation =
      !modelOverride &&
      normalizedOrders.some(
        (o) =>
          !o.customer_name ||
          !o.delivery_date ||
          o.items.some(
            (it) =>
              it.confidence < 0.75 ||
              Boolean(it.is_handwritten_modified) ||
              Boolean(it.has_reply_required) ||
              Boolean(it.needs_review_reason && !it.needs_review_reason.includes('約表記')),
          ),
      )

    let finalUsedModel = usedModel
    if (needsEscalation) {
      try {
        const { result: highRes, usedModel: highModel } = await generateWithFallback(
          parts,
          systemInstruction,
          undefined,
          'high',
        )
        if (highModel !== usedModel) {
          const highJson = extractJson(highRes.response.text())
          const highParsed = ordersResultSchema.parse(highJson)
          await logUsage('orders_high', channel, true, highRes.response.usageMetadata?.totalTokenCount)
          if (highParsed.is_order && highParsed.orders.length > 0) {
            finalUsedModel = `${usedModel} → ${highModel}`
          }
        }
      } catch {
        // 高精度モデルの再検証が一時エラーの場合はメインモデルの結果を維持
      }
    }

    if (normalizedOrders.length === 0) {
      return {
        is_order: false,
        skip_reason: '出荷対象品目（チンゲン菜・トマト・長ネギ・ミニ白菜等）の有効な明細行が0件のためスキップ',
        slip_no: parsed.slip_no ?? null,
        is_full_resending_matrix: false,
        orders: [],
        used_model: usedModel,
        applied_rules_count: activeRules.length,
      }
    }

    const isWagoenMatrix =
      Boolean(parsed.is_full_resending_matrix) ||
      (normalizedOrders.some((o) => (o.customer_name ?? '').includes('和郷園')) &&
        normalizedOrders.length >= 2)

    return {
      is_order: true,
      skip_reason: null,
      slip_no: parsed.slip_no ?? normalizedOrders[0]?.slip_no ?? null,
      is_full_resending_matrix: isWagoenMatrix,
      orders: normalizedOrders,
      used_model: finalUsedModel,
      applied_rules_count: activeRules.length,
    }
  } catch (e) {
    await logUsage('orders', channel, false)
    throw e
  }
}

/**
 * 自然言語による注文データの対話再修正 ＆ 恒久ルールの自動抽出（ARCHITECTURE.md §1.3 & §5.3 継承）。
 */
export async function reviseOrdersWithInstruction(params: {
  currentOrders: ParsedOrder[]
  userInstruction: string
  clientNameHint?: string | null
}): Promise<{
  orders: ParsedOrder[]
  aiLearnedRuleCandidate: string | null
  revisionSummary: string
  usedModel: string
}> {
  const activeRules = await fetchActiveAiRules(params.clientNameHint)
  const rulesSection = buildAiRulesSection(activeRules)
  const systemInstruction = [DEFAULT_GEMINI_PROMPT_REVISION, rulesSection, buildDateContext()]
    .filter(Boolean)
    .join('\n\n')

  const prompt = [
    `現在の注文JSON:\n${JSON.stringify(params.currentOrders)}`,
    `修正指示:\n${params.userInstruction.trim()}`,
  ].join('\n\n')

  const { result: res, usedModel } = await generateWithFallback([{ text: prompt }], systemInstruction, undefined, 'high')
  const json = extractJson(res.response.text())
  const parsed = revisionResultSchema.parse(json)
  await logUsage('revision', 'web', true, res.response.usageMetadata?.totalTokenCount)

  const normalizedOrders: ParsedOrder[] = parsed.orders.map((order) => {
    const isSampleOrd = Boolean(
      (order.note ?? '').includes('サンプル') ||
      (order.destination_name ?? '').includes('サンプル') ||
      (order.items ?? []).some((i) => (i.note ?? '').includes('サンプル'))
    )
    const std = normalizeCustomerAndDestination({
      customerName: order.customer_name,
      destinationName: order.destination_name,
      isSample: isSampleOrd,
    })
    const resolvedCustomer = std.customerName ?? order.customer_name
    const resolvedDest = std.destinationName ?? order.destination_name ?? null
    return {
      ...order,
      customer_name: resolvedCustomer,
      destination_name: resolvedDest,
      items: order.items.map((it) =>
        verifyAndNormalizeItem(it, resolvedCustomer, {
          destinationName: resolvedDest,
          deliveryDate: order.delivery_date,
        }),
      ),
    }
  })

  return {
    orders: normalizedOrders,
    aiLearnedRuleCandidate: parsed.ai_learned_rule_candidate?.trim() || null,
    revisionSummary: parsed.revision_summary?.trim() || 'AIで修正指示を反映しました。',
    usedModel,
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
