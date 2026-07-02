import 'server-only'
import { createClient } from '@/lib/supabase/server'

/**
 * 受注一覧・受注詳細のデータ取得（admin/orders 画面用）。
 * 承認待ちに限らず「すべての受注」を新しい順で見せる（approvals は pending_review のみ）。
 */

export interface OrderListRow {
  id: string
  orderDate: string | null
  deliveryDate: string | null
  status: string
  source: string
  customerName: string
  customerColor: string | null
  /** 納入先（取引先の配下の届け先）。無ければ null（表示は常に「取引先＞納入先」）。 */
  destinationName: string | null
  itemCount: number
  amount: number
}

export interface OrderDetailItem {
  id: string
  productName: string
  quantity: number
  unit: string
  unitPrice: number | null
  lineTotal: number
  fieldStatus: string | null
  confidence: number | null
}

export interface OrderDetail {
  id: string
  orderDate: string | null
  deliveryDate: string | null
  status: string
  source: string
  note: string | null
  customerName: string
  customerColor: string | null
  /** 納入先（取引先の配下の届け先）。無ければ null。 */
  destinationName: string | null
  items: OrderDetailItem[]
  total: number
}

/** 受注一覧の絞り込み条件（未指定＝全件）。期間は受注日（order_date）で判定。 */
export interface OrderFilter {
  status?: string
  customerId?: string
  start?: string
  end?: string
}

const sumLine = (items: { line_total: number | null }[] | null): number =>
  (items ?? []).reduce((acc, it) => acc + Number(it.line_total ?? 0), 0)

/** すべての受注を新しい順で取得（絞り込み対応・既定 200 件）。 */
export async function getOrdersList(filter: OrderFilter = {}, limit = 200): Promise<OrderListRow[]> {
  const supabase = createClient()
  let query = supabase
    .from('orders')
    .select(
      'id, order_date, delivery_date, status, source, customers(name, display_color), delivery_destinations(code, full_name), order_items(line_total)',
    )
    .order('created_at', { ascending: false })
    .limit(limit)

  if (filter.status) query = query.eq('status', filter.status)
  if (filter.customerId) query = query.eq('customer_id', filter.customerId)
  if (filter.start) query = query.gte('order_date', filter.start)
  if (filter.end) query = query.lte('order_date', filter.end)

  const { data, error } = await query
  if (error) throw new Error(error.message)

  type Row = {
    id: string
    order_date: string | null
    delivery_date: string | null
    status: string
    source: string
    customers: { name: string; display_color: string | null } | null
    delivery_destinations: { code: string | null; full_name: string } | null
    order_items: { line_total: number | null }[] | null
  }
  return ((data ?? []) as unknown as Row[]).map((o) => ({
    id: o.id,
    orderDate: o.order_date,
    deliveryDate: o.delivery_date,
    status: o.status,
    source: o.source,
    customerName: o.customers?.name ?? '取引先 未紐付け',
    customerColor: o.customers?.display_color ?? null,
    destinationName: o.delivery_destinations ? o.delivery_destinations.code || o.delivery_destinations.full_name : null,
    itemCount: o.order_items?.length ?? 0,
    amount: sumLine(o.order_items),
  }))
}

/** 受注1件の詳細（明細付き）。存在しなければ null。 */
export async function getOrderDetail(id: string): Promise<OrderDetail | null> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('orders')
    .select(
      'id, order_date, delivery_date, status, source, note, customers(name, display_color), delivery_destinations(code, full_name), order_items(id, product_name, quantity, unit, unit_price, line_total, field_status, confidence)',
    )
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return null

  type Row = {
    id: string
    order_date: string | null
    delivery_date: string | null
    status: string
    source: string
    note: string | null
    customers: { name: string; display_color: string | null } | null
    delivery_destinations: { code: string | null; full_name: string } | null
    order_items: {
      id: string
      product_name: string
      quantity: number | null
      unit: string
      unit_price: number | null
      line_total: number | null
      field_status: string | null
      confidence: number | null
    }[] | null
  }
  const o = data as unknown as Row
  const items: OrderDetailItem[] = (o.order_items ?? []).map((it) => ({
    id: it.id,
    productName: it.product_name,
    quantity: Number(it.quantity ?? 0),
    unit: it.unit,
    unitPrice: it.unit_price != null ? Number(it.unit_price) : null,
    lineTotal: Number(it.line_total ?? 0),
    fieldStatus: it.field_status,
    confidence: it.confidence != null ? Number(it.confidence) : null,
  }))
  return {
    id: o.id,
    orderDate: o.order_date,
    deliveryDate: o.delivery_date,
    status: o.status,
    source: o.source,
    note: o.note,
    customerName: o.customers?.name ?? '取引先 未紐付け',
    customerColor: o.customers?.display_color ?? null,
    destinationName: o.delivery_destinations ? o.delivery_destinations.code || o.delivery_destinations.full_name : null,
    items,
    total: items.reduce((a, it) => a + it.lineTotal, 0),
  }
}
