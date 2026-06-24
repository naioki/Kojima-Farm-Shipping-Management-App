import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { analyzeOrders, type ParsedOrder } from '@/lib/gemini/analyze'
import { preprocessFaxImage, preprocessFaxImageRotated180 } from '@/lib/ocr/preprocess'
import { getReceiptOriginal } from '@/lib/r2'
import { matchProductName, type ProductCandidate } from '@/lib/matching/name-match'
import { buildCustomerHintText, type ParseHint } from '@/lib/ingestion/learning'
import { decideReceiptApproval } from '@/lib/ingestion/auto-approve'
import { getSetting } from '@/lib/settings'
import { notify } from '@/lib/notify'

/**
 * pending_ai の order_receipt 1件を処理するパイプライン（G1 / design.md §2）。
 * 前処理 → Gemini解析 → 名寄せ → 自動承認判定 → DB保存
 *
 * 戻り値: 処理ステータス（呼び出し元のログ用）
 */
export type ProcessReceiptStatus =
  | 'approved'
  | 'pending_review'
  | 'not_order'
  | 'ai_failed'
  | 'skipped_no_content'

export interface ProcessReceiptResult {
  receiptId: string
  status: ProcessReceiptStatus
  orderCount: number
  error?: string
}

export async function processReceipt(receiptId: string): Promise<ProcessReceiptResult> {
  const admin = createAdminClient()

  // レシートのメタデータを取得
  const { data: receipt } = await admin
    .from('order_receipts')
    .select('id, channel, r2_key, raw_payload, sender_date_key, customer_id, is_revision, status')
    .eq('id', receiptId)
    .maybeSingle()

  if (!receipt || receipt.status !== 'pending_ai') {
    return { receiptId, status: 'skipped_no_content', orderCount: 0 }
  }

  // 画像（R2）またはテキスト（raw_payload）を取得
  let imageBuffer: Buffer | null = null
  let textContent: string | null = null

  if (receipt.r2_key) {
    try {
      imageBuffer = await getReceiptOriginal(receipt.r2_key)
    } catch (e) {
      return await failReceipt(receiptId, `R2取得失敗: ${String(e)}`)
    }
  } else if (receipt.raw_payload) {
    const p = receipt.raw_payload as Record<string, unknown>
    textContent = typeof p['text'] === 'string' ? p['text'] : null
  }

  if (!imageBuffer && !textContent) {
    return await failReceipt(receiptId, 'コンテンツが空（画像なし・テキストなし）')
  }

  // FAX番号から取引先を特定（channel_identifiers.fax）
  let customerId = receipt.customer_id as string | null
  if (!customerId && receipt.sender_date_key && receipt.channel === 'fax') {
    const faxNum = receipt.sender_date_key.split('_')[0] ?? ''
    if (faxNum) {
      const { data: matched } = await admin
        .from('customers')
        .select('id')
        .contains('channel_identifiers', { fax: [faxNum] })
        .maybeSingle()
      customerId = matched?.id ?? null
    }
  }

  // 取引先別の学習ヒントを取得
  let hintText = ''
  if (customerId) {
    const { data: hints } = await admin
      .from('customer_parse_hints')
      .select('raw_name, corrected_name, hit_count')
      .eq('customer_id', customerId)
      .order('hit_count', { ascending: false })
      .limit(30)
    if (hints && hints.length > 0) {
      const parsed: ParseHint[] = hints.map((h) => ({
        rawName: h.raw_name as string,
        correctedName: h.corrected_name as string | null,
        hitCount: h.hit_count as number | undefined,
      }))
      hintText = buildCustomerHintText(parsed)
    }
  }

  // 画像前処理
  let base64: string | null = null
  let mimeType = 'image/jpeg'
  if (imageBuffer) {
    try {
      const preprocessed = await preprocessFaxImage(imageBuffer)
      base64 = preprocessed.base64
      mimeType = preprocessed.mimeType
    } catch {
      // 前処理失敗は生バイトで続行（Gemini が直接解釈）
      base64 = imageBuffer.toString('base64')
      mimeType = 'image/jpeg'
    }
  }

  // Gemini 解析（1回目）
  let result = await tryAnalyze({ base64, mimeType, text: textContent }, receipt.channel, hintText, receiptId)
  if (!result) {
    return await failReceipt(receiptId, 'Gemini 解析失敗')
  }

  // 上下逆さまリトライ（is_order:false かつ画像あり）
  if (!result.is_order && imageBuffer) {
    try {
      const rotated = await preprocessFaxImageRotated180(imageBuffer)
      const retried = await tryAnalyze({ base64: rotated.base64, mimeType: rotated.mimeType, text: null }, receipt.channel, hintText, receiptId)
      if (retried?.is_order) result = retried
    } catch {
      // リトライ失敗は無視（1回目の結果を使う）
    }
  }

  // 受注書でない場合
  if (!result.is_order || result.orders.length === 0) {
    await admin
      .from('order_receipts')
      .update({ status: 'unmatched', customer_id: customerId ?? undefined })
      .eq('id', receiptId)
    return { receiptId, status: 'not_order', orderCount: 0 }
  }

  // 商品マスタ取得（名寄せ用）
  const { data: products } = await admin
    .from('products')
    .select('id, name, aliases')
    .eq('is_active', true)
  const candidates: ProductCandidate[] = (products ?? []).map((p) => ({
    id: p.id as string,
    name: p.name as string,
    aliases: (p.aliases as string[] | null) ?? [],
  }))

  // 自動承認設定
  const [autoApproveEnabled, thresholdRaw] = await Promise.all([
    getSetting('AUTO_APPROVE_ENABLED'),
    getSetting('AUTO_APPROVE_THRESHOLD'),
  ])
  const { isAutoApproveOn, parseThreshold } = await import('@/lib/ingestion/auto-approve')
  const threshold = parseThreshold(thresholdRaw)
  const enabled = isAutoApproveOn(autoApproveEnabled)

  // 注文ごとに処理
  let anyPendingReview = false
  let savedCount = 0

  for (const order of result.orders) {
    const { saved, needsReview } = await saveOrder({
      order,
      receiptId,
      customerId,
      candidates,
      enabled,
      threshold,
      isRevision: Boolean(receipt.is_revision),
    })
    if (saved) savedCount++
    if (needsReview) anyPendingReview = true
  }

  const finalStatus = anyPendingReview ? 'pending_review' : 'approved'

  // receipt ステータス更新
  await admin
    .from('order_receipts')
    .update({ status: finalStatus, customer_id: customerId ?? undefined })
    .eq('id', receiptId)

  // pending_review の場合は通知
  if (finalStatus === 'pending_review') {
    await notify({
      event: 'pending_review',
      level: 'warning',
      title: '受注確認が必要です',
      body: `${result.orders.length}件の注文を読み取りました。確信度が低い項目があります。`,
      url: '/admin/inbox',
    }).catch(() => {})
  }

  return { receiptId, status: finalStatus, orderCount: savedCount }
}

/** Gemini 解析を try-catch でラップ。失敗は null を返す（retry/fail は呼び出し元が判断）。 */
async function tryAnalyze(
  input: { base64: string | null; mimeType: string; text: string | null },
  channel: string,
  hintText: string,
  receiptId: string,
) {
  try {
    return await analyzeOrders(
      {
        imageBase64: input.base64 ?? undefined,
        mimeType: input.mimeType,
        text: input.text ?? undefined,
      },
      channel,
      hintText,
    )
  } catch {
    return null
  }
}

/** receipt を ai_failed に更新して ProcessReceiptResult を返す。 */
async function failReceipt(receiptId: string, error: string): Promise<ProcessReceiptResult> {
  const admin = createAdminClient()
  await admin
    .from('order_receipts')
    .update({
      status: 'ai_failed',
      error_message: error,
    })
    .eq('id', receiptId)
  // retry_count の increment はシンプルに RPC なしで実装
  // retry_count を安全にインクリメント（RPC が未定義でも無視）
  try {
    await admin.rpc('increment_receipt_retry', { receipt_id: receiptId })
  } catch {
    // RPC 未定義の場合はスキップ（retry_count は目安値）
  }
  return { receiptId, status: 'ai_failed', orderCount: 0, error }
}

interface SaveOrderArgs {
  order: ParsedOrder
  receiptId: string
  customerId: string | null
  candidates: ProductCandidate[]
  enabled: boolean
  threshold: number
  isRevision: boolean
}

/**
 * 1注文を解析→名寄せ→自動承認判定→DB保存。
 * 自動承認できれば orders INSERT(approved)、できなければ pending_review のまま。
 */
async function saveOrder({
  order,
  receiptId,
  customerId,
  candidates,
  enabled,
  threshold,
  isRevision,
}: SaveOrderArgs): Promise<{ saved: boolean; needsReview: boolean }> {
  const admin = createAdminClient()

  // 名寄せ
  const resolvedItems = order.items.map((item) => {
    const match = matchProductName(item.raw_name, candidates)
    return {
      raw_name: item.raw_name,
      product_id: match.productId,
      product_name: match.productId
        ? (candidates.find((c) => c.id === match.productId)?.name ?? item.product_name)
        : item.product_name,
      quantity_raw: item.quantity,
      unit: item.unit,
      confidence: item.confidence,
      name_match_score: match.score,
      is_flagged: match.needsConfirmation || item.confidence < 0.7,
    }
  })

  const customerMatched = Boolean(customerId)
  const deliveryDateKnown = Boolean(order.delivery_date)

  const decision = decideReceiptApproval({
    enabled,
    threshold,
    customerMatched,
    deliveryDateKnown,
    items: resolvedItems.map((it) => ({
      confidence: it.confidence,
      productMatched: Boolean(it.product_id),
    })),
  })

  if (decision.action === 'manual_review') {
    // pending_review: orders には保存せず、receipt を pending_review のまま人間に委ねる
    return { saved: false, needsReview: true }
  }

  // 自動承認: orders INSERT
  if (!customerId || !order.delivery_date) return { saved: false, needsReview: true }

  const { data: newOrder, error: orderErr } = await admin
    .from('orders')
    .insert({
      customer_id: customerId,
      delivery_date: order.delivery_date,
      status: 'approved',
      source: 'fax',
      receipt_id: receiptId,
      is_revision: isRevision,
    })
    .select('id')
    .maybeSingle()

  if (orderErr || !newOrder) return { saved: false, needsReview: true }

  // order_items INSERT
  const itemsToInsert = resolvedItems
    .filter((it) => it.product_id)
    .map((it) => ({
      order_id: newOrder.id,
      product_id: it.product_id!,
      product_name: it.product_name ?? '',
      quantity: 0, // スマートパースは UI 側または後続処理で解決。ここは raw で積む。
      quantity_raw: it.quantity_raw,
      unit: it.unit ?? '個',
      unit_price: 0,
      tax_rate: 8,
      confidence: it.confidence,
      is_flagged: it.is_flagged,
    }))

  if (itemsToInsert.length > 0) {
    await admin.from('order_items').insert(itemsToInsert)
  }

  // receipt に order_id を紐付け
  await admin.from('order_receipts').update({ order_id: newOrder.id }).eq('id', receiptId)

  return { saved: true, needsReview: false }
}
