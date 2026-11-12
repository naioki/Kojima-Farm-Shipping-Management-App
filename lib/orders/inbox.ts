import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPendingOrders, type PendingOrder } from '@/lib/orders/pending'
import { jstTodayStr, shiftDateStr } from '@/lib/dates'
import { INGEST_REVIEW_HOLD_KEY, hasIngestReviewHold } from '@/lib/ingestion/review-hold'

/**
 * 受注ボックス（/admin/inbox）の一括データ取得。
 * 「受信（order_receipts）→ 承認（pending_review の orders）→ 今日承認済み」を1画面に束ねる。
 *
 * 二重表示の回避（features.md §1・Issue#3）:
 *   status='pending_review' の受信は order_id が付いており、承認待ち注文カード側（getPendingOrders）
 *   に必ず現れる。よって受信リストは pending_ai / ai_failed / unmatched の3状態だけを扱い、
 *   pending_review は取り込まない。
 */

/** 受注ボックスのフィルタ（URLクエリ ?filter= で状態保持）。 */
export type InboxFilter = 'all' | 'parsing' | 'review' | 'pending' | 'approved'

export const INBOX_FILTERS: InboxFilter[] = ['all', 'parsing', 'review', 'pending', 'approved']

/** 受信リストに載せる状態（承認待ちは注文カード側に出すので除外）。 */
const RECEIPT_STATUSES = ['pending_ai', 'ai_failed', 'unmatched'] as const

export interface InboxReceiptItem {
  name: string
  spec?: string | null
  quantity: number
  unit: string
  cases?: number | null
  containerType?: string | null
  destinationName?: string | null
  deliveryDate?: string | null
  isNewAddition?: boolean
}

export interface InboxReceiptAlert {
  message: string
  type: string
}

export interface InboxReceipt {
  id: string
  channel: string
  status: string
  receivedAt: string
  senderDateKey: string | null
  isRevision: boolean
  ocrConfidence: number | null
  hasR2Key: boolean
  orderId: string | null
  customerId: string | null
  customerName: string | null
  customerColor: string | null
  errorMessage: string | null
  deliveryDate?: string | null
  destinationName?: string | null
  slipNo?: string | null
  items: InboxReceiptItem[]
  alerts: InboxReceiptAlert[]
  /**
   * 取り込みで一部の保存に失敗した等で「人の確認が要る」印が立った受信票（status は pending_review のまま。
   * lib/ingestion/review-hold.ts）。注文が承認待ちでない（承認済み・出荷済みなど）ので承認待ちの注文カードには
   * 出ない。受信リストの「要確認」に出し、人が確認して「却下」で片付ける。
   */
  reviewHold: boolean
}

export interface ApprovedOrderItem {
  id: string
  productName: string
  quantity: number
  unit: string
  spec?: string | null
}

/** 今日承認済みの注文（読み取り専用の実績表示）。 */
export interface ApprovedOrderSummary {
  id: string
  source: string
  deliveryDate: string | null
  customerName: string
  customerColor: string | null
  itemCount: number
  items: ApprovedOrderItem[]
  approvedAt: string
}

export interface InboxCounts {
  all: number
  parsing: number
  review: number
  pending: number
  approved: number
}

export interface InboxData {
  receipts: InboxReceipt[]
  pendingOrders: PendingOrder[]
  approvedOrders: ApprovedOrderSummary[]
  counts: InboxCounts
}

export async function getInboxData(): Promise<InboxData> {
  const supabase = createAdminClient()
  // JST の当日0時（timestamptz 比較用）。updated_at が承認で更新される想定。
  const jstMidnight = `${jstTodayStr()}T00:00:00+09:00`

  // 承認済み・キャンセル済み注文に紐づく受信ステータスの自動同期（未確定バナーの残骸解消）
  try {
    const admin = createAdminClient()
    const { data: nonPendingOrders } = await admin
      .from('orders')
      .select('id, status')
      .neq('status', 'pending_review')
    if (nonPendingOrders?.length) {
      const approvedIds = nonPendingOrders.filter((o) => o.status !== 'cancelled').map((o) => o.id)
      const cancelledIds = nonPendingOrders.filter((o) => o.status === 'cancelled').map((o) => o.id)
      // 受信箱の表示を片付ける自動同期。失敗しても表示が古いだけなので一覧は出し、ログに残す（次回の表示で再試行）
      if (approvedIds.length) {
        // 取り込みが「人の確認が要る」と印を立てた受信票（一部の保存に失敗した等。lib/ingestion/review-hold.ts）は
        // 注文が承認済みでも片付けない。人が受信箱の「却下」で片付ける。
        const { data: syncCandidates, error: syncReadErr } = await admin
          .from('order_receipts')
          .select(`id, raw_payload->${INGEST_REVIEW_HOLD_KEY}`)
          .in('order_id', approvedIds)
          .eq('status', 'pending_review')
        if (syncReadErr) {
          console.error('[inbox] 承認済み注文の受信票の読み込みに失敗（同期しません）:', syncReadErr.message)
        } else {
          const syncIds = ((syncCandidates ?? []) as unknown as Record<string, unknown>[])
            .filter((r) => r[INGEST_REVIEW_HOLD_KEY] !== true)
            .map((r) => r.id as string)
          if (syncIds.length) {
            const { error: syncApprovedErr } = await admin
              .from('order_receipts')
              .update({ status: 'approved' })
              .in('id', syncIds)
              .eq('status', 'pending_review')
            if (syncApprovedErr) console.error('[inbox] 承認済み注文の受信票を approved に同期できませんでした:', syncApprovedErr.message)
          }
        }
      }
      if (cancelledIds.length) {
        const { error: syncCancelledErr } = await admin
          .from('order_receipts')
          .update({ status: 'dismissed' })
          .in('order_id', cancelledIds)
          .eq('status', 'pending_review')
        if (syncCancelledErr) console.error('[inbox] 却下済み注文の受信票を dismissed に同期できませんでした:', syncCancelledErr.message)
      }
    }

    // 過去の開発テスト時等に残存した古い未照合・AI失敗受信（3日以上前）を一括アーカイブ
    const oldReceiptThreshold = `${shiftDateStr(jstTodayStr(), -3)}T00:00:00+09:00`
    const { error: archiveErr } = await admin
      .from('order_receipts')
      .update({ status: 'dismissed' })
      .in('status', ['unmatched', 'ai_failed'])
      .lt('received_at', oldReceiptThreshold)
    if (archiveErr) console.error('[inbox] 古い未照合・AI失敗の受信票の片付けに失敗:', archiveErr.message)
  } catch (e) {
    console.error('[inbox] auto sync receipts failed', e)
  }

  const RECEIPT_COLUMNS =
    'id, channel, status, received_at, sender_date_key, is_revision, ocr_confidence, r2_key, raw_payload, order_id, customer_id, error_message'
  const [receiptsRes, pendingOrders, approvedRes, heldRes] = await Promise.all([
    supabase
      .from('order_receipts')
      .select(RECEIPT_COLUMNS)
      .in('status', RECEIPT_STATUSES as unknown as string[])
      .order('received_at', { ascending: false }),
    getPendingOrders(),
    supabase
      .from('orders')
      .select('id, source, delivery_date, customer_id, updated_at')
      .eq('status', 'approved')
      .gte('updated_at', jstMidnight)
      .order('updated_at', { ascending: false }),
    // 取り込みが要確認の印を立てた受信票（承認待ちでも、注文側が承認済みなら注文カードに出ないため受信リストに出す）
    supabase
      .from('order_receipts')
      .select(RECEIPT_COLUMNS)
      .eq('status', 'pending_review')
      .eq(`raw_payload->>${INGEST_REVIEW_HOLD_KEY}`, 'true')
      .order('received_at', { ascending: false }),
  ])

  if (receiptsRes.error) throw new Error(receiptsRes.error.message)
  if (approvedRes.error) throw new Error(approvedRes.error.message)
  if (heldRes.error) throw new Error(heldRes.error.message)

  // 注文が承認待ちのもの（承認待ちの注文カードに出る）は二重に出さない
  const pendingOrderIds = new Set(pendingOrders.map((o) => o.id))
  const heldRows = (heldRes.data ?? []).filter(
    (r) => hasIngestReviewHold(r.raw_payload) && !(r.order_id && pendingOrderIds.has(r.order_id)),
  )
  const receiptRows = [...(receiptsRes.data ?? []), ...heldRows].sort((a, b) =>
    String(b.received_at).localeCompare(String(a.received_at)),
  )
  const approvedRows = approvedRes.data ?? []

  // 取引先名・カラーをまとめて解決（受信＋今日承認済みの両方）。
  const customerIds = [
    ...new Set(
      [...receiptRows.map((r) => r.customer_id), ...approvedRows.map((o) => o.customer_id)].filter(
        Boolean,
      ) as string[],
    ),
  ]
  const { data: custs, error: custErr } = customerIds.length
    ? await supabase.from('customers').select('id, name, display_color').in('id', customerIds)
    : { data: [] as { id: string; name: string; display_color: string | null }[], error: null }
  if (custErr) console.error('[inbox] 取引先名の解決に失敗:', custErr.message)
  const custName = new Map((custs ?? []).map((c) => [c.id, c.name]))
  const custColor = new Map((custs ?? []).map((c) => [c.id, c.display_color]))

  // 今日承認済みの明細
  const approvedIds = approvedRows.map((o) => o.id)
  const itemsByOrder = new Map<string, ApprovedOrderItem[]>()
  if (approvedIds.length) {
    const { data: itemRows, error: itemErr } = await supabase
      .from('order_items')
      .select('id, order_id, product_name, quantity, unit, spec')
      .in('order_id', approvedIds)
    if (itemErr) console.error('[inbox] 承認済み注文の明細取得に失敗:', itemErr.message)
    for (const it of itemRows ?? []) {
      const list = itemsByOrder.get(it.order_id) ?? []
      list.push({
        id: it.id,
        productName: it.product_name,
        quantity: Number(it.quantity),
        unit: it.unit,
        spec: it.spec,
      })
      itemsByOrder.set(it.order_id, list)
    }
  }

  const receipts: InboxReceipt[] = receiptRows.map((r) => {
    const payload = (r.raw_payload && typeof r.raw_payload === 'object' ? r.raw_payload : {}) as Record<
      string,
      unknown
    >
    const slipData = payload['slip_data'] as Record<string, unknown> | undefined
    const slipItems = (Array.isArray(slipData?.items) ? slipData.items : []) as Record<string, unknown>[]
    const ordersList = (Array.isArray(payload['orders']) ? payload['orders'] : []) as Record<string, unknown>[]
    const alertsList = (Array.isArray(slipData?.alerts) ? slipData.alerts : []) as Record<string, unknown>[]

    const items: InboxReceiptItem[] = slipItems.map((it) => ({
      name: String(it['item_name'] || it['product_name'] || '青梗菜'),
      spec: typeof it['spec'] === 'string' ? it['spec'] : null,
      quantity: Number(it['total_packs'] ?? it['quantity'] ?? 0),
      unit: String(it['unit'] || 'P'),
      cases: typeof it['cases'] === 'number' ? it['cases'] : null,
      containerType: typeof it['container_type'] === 'string' ? it['container_type'] : null,
      destinationName: typeof it['destination'] === 'string' ? it['destination'] : null,
      deliveryDate: typeof it['delivery_date'] === 'string' ? it['delivery_date'] : null,
      isNewAddition: Boolean(it['new_addition_mark'] || it['is_new_addition']),
    }))

    const alerts: InboxReceiptAlert[] = alertsList.map((a) => ({
      message: String(a['message'] || ''),
      type: String(a['alert_type'] || '要確認'),
    }))

    const deliveryDate =
      (typeof slipItems[0]?.['delivery_date'] === 'string' ? slipItems[0]['delivery_date'] : null) ??
      (typeof ordersList[0]?.['delivery_date'] === 'string' ? (ordersList[0]['delivery_date'] as string) : null)
    const destinationName =
      (typeof slipItems[0]?.['destination'] === 'string' ? slipItems[0]['destination'] : null) ??
      (typeof ordersList[0]?.['destination_name'] === 'string' ? (ordersList[0]['destination_name'] as string) : null)
    const slipNo =
      (typeof slipData?.['slip_no'] === 'string' ? slipData['slip_no'] : null) ??
      (typeof ordersList[0]?.['slip_no'] === 'string' ? (ordersList[0]['slip_no'] as string) : null)

    const hasOriginalSource = Boolean(
      r.r2_key ||
        (typeof payload['source_file_url'] === 'string' && payload['source_file_url']) ||
        (typeof payload['file_base64'] === 'string' && payload['file_base64']),
    )
    return {
      id: r.id,
      channel: r.channel,
      status: r.status,
      receivedAt: r.received_at,
      senderDateKey: r.sender_date_key,
      isRevision: Boolean(r.is_revision),
      ocrConfidence: r.ocr_confidence != null ? Number(r.ocr_confidence) : null,
      hasR2Key: hasOriginalSource,
      orderId: r.order_id,
      customerId: r.customer_id,
      customerName: r.customer_id ? (custName.get(r.customer_id) ?? null) : null,
      customerColor: r.customer_id ? (custColor.get(r.customer_id) ?? null) : null,
      errorMessage: r.error_message,
      deliveryDate,
      destinationName,
      slipNo,
      items,
      alerts,
      reviewHold: r.status === 'pending_review' && hasIngestReviewHold(payload),
    }
  })

  const approvedOrders: ApprovedOrderSummary[] = approvedRows.map((o) => {
    const orderItems = itemsByOrder.get(o.id) ?? []
    return {
      id: o.id,
      source: o.source,
      deliveryDate: o.delivery_date,
      customerName: o.customer_id ? (custName.get(o.customer_id) ?? '（不明な取引先）') : '取引先 未紐付け',
      customerColor: o.customer_id ? (custColor.get(o.customer_id) ?? null) : null,
      itemCount: orderItems.length,
      items: orderItems,
      approvedAt: o.updated_at,
    }
  })

  const parsing = receipts.filter((r) => r.status === 'pending_ai').length
  const review = receipts.filter((r) => r.status === 'ai_failed' || r.status === 'unmatched' || r.reviewHold).length
  const pending = pendingOrders.length
  const approved = approvedOrders.length

  return {
    receipts,
    pendingOrders,
    approvedOrders,
    // 受信ボックスは受信の処理専用（承認は /admin/approvals に一本化）。「すべて」に承認待ちは含めない
    counts: { all: parsing + review, parsing, review, pending, approved },
  }
}

/** URLクエリの値を安全に InboxFilter に正規化（後方互換: ?status=ai_failed,unmatched → review）。 */
export function normalizeFilter(filter?: string, legacyStatus?: string): InboxFilter {
  if (filter && (INBOX_FILTERS as string[]).includes(filter)) return filter as InboxFilter
  if (legacyStatus) {
    const parts = legacyStatus.split(',')
    if (parts.some((s) => s === 'ai_failed' || s === 'unmatched')) return 'review'
    if (parts.includes('pending_ai')) return 'parsing'
  }
  return 'all'
}
