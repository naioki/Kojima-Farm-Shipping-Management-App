import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * 受注一覧・受注詳細のデータ取得（admin/orders 画面用）。
 * - #37: 納品日・納入先に加え、総箱数・総パック数・現場ステータス進捗サマリーを集計。
 * - #38: 注文詳細画面でのインライン編集用に customerId, destinationId, version 等も返す。
 */

export interface OrderListRow {
  id: string
  orderDate: string | null
  deliveryDate: string | null
  status: string
  source: string
  intakeChannel: string | null
  customerName: string
  customerColor: string | null
  destinationName: string | null
  itemCount: number
  totalPacks: number
  totalBoxes: number
  fieldProgressLabel: string
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
  spec: string | null
  containerType: string | null
  version: number
}

export interface OrderDetail {
  id: string
  customerId: string
  destinationId: string | null
  orderDate: string | null
  deliveryDate: string | null
  status: string
  source: string
  intakeChannel: string | null
  note: string | null
  customerName: string
  customerColor: string | null
  destinationName: string | null
  items: OrderDetailItem[]
  total: number
}

export interface OrderFilter {
  status?: string
  customerId?: string
  start?: string
  end?: string
}

const sumLine = (items: { line_total: number | null }[] | null): number =>
  (items ?? []).reduce((acc, it) => acc + Number(it.line_total ?? 0), 0)

function resolveOrderItemPerCase(customerName: string, spec?: string | null): number {
  const combined = `${customerName} ${spec ?? ''}`.normalize('NFKC')
  const m = combined.match(/(?:入数|1箱|1ケース)\s*(\d+)|(\d+)\s*(?:入|パック|P)/i)
  if (m) {
    const n = Number(m[1] || m[2])
    if (Number.isFinite(n) && n > 0 && n <= 200) return n
  }
  if (combined.includes('小コン')) return 30
  if (combined.includes('農業総合研究所') || combined.toUpperCase().includes('NSK')) return 24
  return 20
}

export async function getOrdersList(filter: OrderFilter = {}, limit = 200): Promise<OrderListRow[]> {
  const supabase = createAdminClient()
  let query = supabase
    .from('orders')
    .select(
      'id, order_date, delivery_date, status, source, intake_channel, customers(name, display_color), delivery_destinations(code, full_name), order_items(quantity, spec, field_status, line_total)',
    )
    .order('delivery_date', { ascending: false, nullsFirst: false })
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
    intake_channel: string | null
    customers: { name: string; display_color: string | null } | null
    delivery_destinations: { code: string | null; full_name: string } | null
    order_items: {
      quantity: number | null
      spec: string | null
      field_status: string | null
      line_total: number | null
    }[] | null
  }
  return ((data ?? []) as unknown as Row[]).map((o) => {
    const cName = o.customers?.name ?? '取引先 未紐付け'
    const rawItems = (o.order_items ?? []).filter((it) => (Number(it.quantity) || 0) > 0)
    let totalPacks = 0
    let totalBoxes = 0
    let packedCount = 0
    let shippedCount = 0
    for (const it of rawItems) {
      const q = Number(it.quantity) || 0
      const ppc = resolveOrderItemPerCase(cName, it.spec)
      totalPacks += q
      totalBoxes += Math.ceil(q / ppc)
      if (it.field_status === 'shipped') shippedCount++
      else if (it.field_status === 'packed') packedCount++
    }
    let fieldProgressLabel = '未着手'
    if (rawItems.length === 0) fieldProgressLabel = '—'
    else if (shippedCount === rawItems.length) fieldProgressLabel = '🚚 積込・出荷済'
    else if (packedCount + shippedCount === rawItems.length) fieldProgressLabel = '✓ パック済'
    else if (packedCount + shippedCount > 0) fieldProgressLabel = `作業中(${packedCount + shippedCount}/${rawItems.length})`

    return {
      id: o.id,
      orderDate: o.order_date,
      deliveryDate: o.delivery_date,
      status: o.status,
      source: o.source,
      intakeChannel: o.intake_channel ?? null,
      customerName: cName,
      customerColor: o.customers?.display_color ?? null,
      destinationName: o.delivery_destinations ? o.delivery_destinations.code || o.delivery_destinations.full_name : null,
      itemCount: rawItems.length,
      totalPacks,
      totalBoxes,
      fieldProgressLabel,
      amount: sumLine(o.order_items),
    }
  })
}

export async function getOrderDetail(id: string): Promise<OrderDetail | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('orders')
    .select(
      'id, customer_id, destination_id, order_date, delivery_date, status, source, intake_channel, note, customers(name, display_color), delivery_destinations(code, full_name), order_items(id, product_name, quantity, unit, unit_price, line_total, field_status, confidence, spec, container_type, version)',
    )
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return null

  type Row = {
    id: string
    customer_id: string
    destination_id: string | null
    order_date: string | null
    delivery_date: string | null
    status: string
    source: string
    intake_channel: string | null
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
      spec: string | null
      container_type: string | null
      version?: number | null
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
    spec: it.spec,
    containerType: it.container_type,
    version: Number(it.version ?? 1),
  }))
  return {
    id: o.id,
    customerId: o.customer_id,
    destinationId: o.destination_id,
    orderDate: o.order_date,
    deliveryDate: o.delivery_date,
    status: o.status,
    source: o.source,
    intakeChannel: o.intake_channel ?? null,
    note: o.note,
    customerName: o.customers?.name ?? '取引先 未紐付け',
    customerColor: o.customers?.display_color ?? null,
    destinationName: o.delivery_destinations ? o.delivery_destinations.code || o.delivery_destinations.full_name : null,
    items,
    total: items.reduce((a, it) => a + it.lineTotal, 0),
  }
}
