import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { getPendingOrders, type PendingOrder } from '@/lib/orders/pending'
import { jstTodayStr } from '@/lib/dates'

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
}

/** 今日承認済みの注文（読み取り専用の実績表示）。 */
export interface ApprovedOrderSummary {
  id: string
  source: string
  deliveryDate: string | null
  customerName: string
  customerColor: string | null
  itemCount: number
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
  const supabase = createClient()
  // JST の当日0時（timestamptz 比較用）。updated_at が承認で更新される想定。
  const jstMidnight = `${jstTodayStr()}T00:00:00+09:00`

  const [receiptsRes, pendingOrders, approvedRes] = await Promise.all([
    supabase
      .from('order_receipts')
      .select(
        'id, channel, status, received_at, sender_date_key, is_revision, ocr_confidence, r2_key, order_id, customer_id, error_message',
      )
      .in('status', RECEIPT_STATUSES as unknown as string[])
      .order('received_at', { ascending: false }),
    getPendingOrders(),
    supabase
      .from('orders')
      .select('id, source, delivery_date, customer_id, updated_at')
      .eq('status', 'approved')
      .gte('updated_at', jstMidnight)
      .order('updated_at', { ascending: false }),
  ])

  if (receiptsRes.error) throw new Error(receiptsRes.error.message)
  if (approvedRes.error) throw new Error(approvedRes.error.message)

  const receiptRows = receiptsRes.data ?? []
  const approvedRows = approvedRes.data ?? []

  // 取引先名・カラーをまとめて解決（受信＋今日承認済みの両方）。
  const customerIds = [
    ...new Set(
      [...receiptRows.map((r) => r.customer_id), ...approvedRows.map((o) => o.customer_id)].filter(
        Boolean,
      ) as string[],
    ),
  ]
  const { data: custs } = customerIds.length
    ? await supabase.from('customers').select('id, name, display_color').in('id', customerIds)
    : { data: [] as { id: string; name: string; display_color: string | null }[] }
  const custName = new Map((custs ?? []).map((c) => [c.id, c.name]))
  const custColor = new Map((custs ?? []).map((c) => [c.id, c.display_color]))

  // 今日承認済みの明細件数
  const approvedIds = approvedRows.map((o) => o.id)
  const itemCountByOrder = new Map<string, number>()
  if (approvedIds.length) {
    const { data: itemRows } = await supabase
      .from('order_items')
      .select('order_id')
      .in('order_id', approvedIds)
    for (const it of itemRows ?? []) {
      itemCountByOrder.set(it.order_id, (itemCountByOrder.get(it.order_id) ?? 0) + 1)
    }
  }

  const receipts: InboxReceipt[] = receiptRows.map((r) => ({
    id: r.id,
    channel: r.channel,
    status: r.status,
    receivedAt: r.received_at,
    senderDateKey: r.sender_date_key,
    isRevision: Boolean(r.is_revision),
    ocrConfidence: r.ocr_confidence != null ? Number(r.ocr_confidence) : null,
    hasR2Key: Boolean(r.r2_key),
    orderId: r.order_id,
    customerId: r.customer_id,
    customerName: r.customer_id ? (custName.get(r.customer_id) ?? null) : null,
    customerColor: r.customer_id ? (custColor.get(r.customer_id) ?? null) : null,
    errorMessage: r.error_message,
  }))

  const approvedOrders: ApprovedOrderSummary[] = approvedRows.map((o) => ({
    id: o.id,
    source: o.source,
    deliveryDate: o.delivery_date,
    customerName: o.customer_id ? (custName.get(o.customer_id) ?? '（不明な取引先）') : '取引先 未紐付け',
    customerColor: o.customer_id ? (custColor.get(o.customer_id) ?? null) : null,
    itemCount: itemCountByOrder.get(o.id) ?? 0,
    approvedAt: o.updated_at,
  }))

  const parsing = receipts.filter((r) => r.status === 'pending_ai').length
  const review = receipts.filter((r) => r.status === 'ai_failed' || r.status === 'unmatched').length
  const pending = pendingOrders.length
  const approved = approvedOrders.length

  return {
    receipts,
    pendingOrders,
    approvedOrders,
    counts: { all: parsing + review + pending, parsing, review, pending, approved },
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
