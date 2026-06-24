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
import { parseQuantity } from '@/lib/calculations/parse-quantity'

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

  const { data: receipt } = await admin
    .from('order_receipts')
    .select('id, channel, r2_key, raw_payload, sender_date_key, customer_id, is_revision, status')
    .eq('id', receiptId)
    .maybeSingle()

  if (!receipt || receipt.status !== 'pending_ai') {
    return { receiptId, status: 'skipped_no_content', orderCount: 0 }
  }

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

  // FAX番号から取引先を特定
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
      base64 = imageBuffer.toString('base64')
      mimeType = 'image/jpeg'
    }
  }

  // Gemini 解析（1回目）
  let result = await tryAnalyze({ base64, mimeType, text: textContent }, receipt.channel, hintText)
  if (!result) {
    return await failReceipt(receiptId, 'Gemini 解析失敗')
  }

  // 上下逆さまリトライ（is_order:false かつ画像あり）
  if (!result.is_order && imageBuffer) {
    try {
      const rotated = await preprocessFaxImageRotated180(imageBuffer)
      const retried = await tryAnalyze(
        { base64: rotated.base64, mimeType: rotated.mimeType, text: null },
        receipt.channel,
        hintText,
      )
      if (retried?.is_order) result = retried
    } catch {
      // リトライ失敗は無視（1回目の結果を使う）
    }
  }

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

  const [autoApproveEnabled, thresholdRaw] = await Promise.all([
    getSetting('AUTO_APPROVE_ENABLED'),
    getSetting('AUTO_APPROVE_THRESHOLD'),
  ])
  const { isAutoApproveOn, parseThreshold } = await import('@/lib/ingestion/auto-approve')
  const threshold = parseThreshold(thresholdRaw)
  const enabled = isAutoApproveOn(autoApproveEnabled)

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

  await admin
    .from('order_receipts')
    .update({ status: finalStatus, customer_id: customerId ?? undefined })
    .eq('id', receiptId)

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

async function tryAnalyze(
  input: { base64: string | null; mimeType: string; text: string | null },
  channel: string,
  hintText: string,
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

/** receipt を ai_failed に更新。retry_count をインクリメントし next_retry_at を設定（G10）。 */
async function failReceipt(receiptId: string, error: string): Promise<ProcessReceiptResult> {
  const admin = createAdminClient()

  // 現在の retry_count を読んでバックオフを計算（5分→30分→3時間）
  const { data: current } = await admin
    .from('order_receipts')
    .select('retry_count')
    .eq('id', receiptId)
    .maybeSingle()

  const retryCount = (current?.retry_count as number | null) ?? 0
  const backoffMinutes = retryCount === 0 ? 5 : retryCount === 1 ? 30 : 180
  const nextRetryAt = new Date(Date.now() + backoffMinutes * 60 * 1000).toISOString()

  await admin
    .from('order_receipts')
    .update({
      status: 'ai_failed',
      error_message: error,
      retry_count: retryCount + 1,
      next_retry_at: retryCount < 3 ? nextRetryAt : null, // 3回失敗で打ち止め
    })
    .eq('id', receiptId)

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

  // G8: 再送（revision）は二重計上リスクがあるため必ず人間確認
  if (isRevision) return { saved: false, needsReview: true }

  // 名寄せ
  const resolvedItems = order.items.map((item) => {
    const match = matchProductName(item.raw_name, candidates)
    return {
      raw_name: item.raw_name,
      product_id: match.productId,
      product_name: match.productId
        ? (candidates.find((c) => c.id === match.productId)?.name ?? item.product_name)
        : item.product_name,
      quantity_raw: item.quantity, // 生OCRテキスト（migration 0012 で追加した列）
      unit: item.unit,
      confidence: item.confidence,
      name_match_score: match.score,
      is_flagged: match.needsConfirmation || item.confidence < 0.7,
    }
  })

  // G7: マッチした商品の packs_per_case をバッチ取得
  const matchedProductIds = resolvedItems.filter((it) => it.product_id).map((it) => it.product_id!)
  const { data: rules } =
    customerId && matchedProductIds.length > 0
      ? await admin
          .from('customer_product_rules')
          .select('product_id, packs_per_case')
          .eq('customer_id', customerId)
          .in('product_id', matchedProductIds)
      : { data: [] }

  const packsPerCaseMap = new Map<string, number | null>(
    (rules ?? []).map((r) => [r.product_id as string, r.packs_per_case as number | null]),
  )

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
    return { saved: false, needsReview: true }
  }

  if (!customerId || !order.delivery_date) return { saved: false, needsReview: true }

  // G7: parseQuantity で総数を確定。解釈不能は pending_review へ
  const itemsToInsert: Array<{
    order_id: string
    product_id: string
    product_name: string
    quantity: number
    quantity_raw: string | null
    unit: string
    unit_price: number
    tax_rate: number
    confidence: number
    is_flagged: boolean
  }> = []

  for (const it of resolvedItems) {
    if (!it.product_id) continue

    const qtyResult = parseQuantity(it.quantity_raw ?? '', {
      packsPerCase: packsPerCaseMap.get(it.product_id) ?? null,
    })

    if (qtyResult.type === 'error') {
      // c記法だが P/C 未設定、または解釈不能 → 人間確認
      return { saved: false, needsReview: true }
    }

    const quantity = qtyResult.type === 'delete' ? 0 : qtyResult.total.toNumber()

    itemsToInsert.push({
      order_id: '', // INSERT後に埋める
      product_id: it.product_id,
      product_name: it.product_name ?? '',
      quantity,
      quantity_raw: it.quantity_raw ?? null,
      unit: it.unit ?? '個',
      unit_price: 0,
      tax_rate: 8,
      confidence: it.confidence,
      is_flagged: it.is_flagged || (qtyResult.type === 'ok' && qtyResult.needsConfirmation),
    })
  }

  // G6: orders INSERT（receipt_id / is_revision は orders テーブルに存在しない）
  const { data: newOrder, error: orderErr } = await admin
    .from('orders')
    .insert({
      customer_id: customerId,
      delivery_date: order.delivery_date,
      status: 'approved',
      source: 'fax',
    })
    .select('id')
    .maybeSingle()

  if (orderErr || !newOrder) return { saved: false, needsReview: true }

  if (itemsToInsert.length > 0) {
    await admin.from('order_items').insert(
      itemsToInsert.map((it) => ({ ...it, order_id: newOrder.id })),
    )
  }

  // receipt に order_id を紐付け（G6: receipt_id/is_revision の代替連携）
  await admin.from('order_receipts').update({ order_id: newOrder.id }).eq('id', receiptId)

  return { saved: true, needsReview: false }
}
