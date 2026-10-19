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
  const supabase = createClient()
  // JST の当日0時（timestamptz 比較用）。updated_at が承認で更新される想定。
  const jstMidnight = `${jstTodayStr()}T00:00:00+09:00`

  const [receiptsRes, pendingOrders, approvedRes] = await Promise.all([
    supabase
      .from('order_receipts')
      .select(
        'id, channel, status, received_at, sender_date_key, is_revision, ocr_confidence, r2_key, raw_payload, order_id, customer_id, error_message',
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
