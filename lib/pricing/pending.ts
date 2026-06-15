import 'server-only'
import { createClient } from '@/lib/supabase/server'

/**
 * 価格確定が必要な明細の取得（請求準備画面・管理者）。
 * 出荷が済む（approved/shipped）が price_status が confirmed でない明細を、取引先ごとにまとめる。
 * billable_qty 既定は実出荷数（shipped_qty）→ 無ければ受注数（quantity）。
 */
export interface PendingPriceItem {
  id: string
  productId: string
  productName: string
  orderedQty: number
  shippedQty: number | null
  /** 既定の請求数量（実出荷→受注の順） */
  billableQty: number
  priceStatus: 'unpriced' | 'provisional' | 'confirmed'
  unitPrice: number
  taxRate: number
}

export interface PendingPriceGroup {
  customerId: string | null
  customerName: string
  customerColor: string | null
  channel: string
  deliveryDate: string | null
  orderId: string
  items: PendingPriceItem[]
}

export async function getItemsNeedingPricing(): Promise<PendingPriceGroup[]> {
  const supabase = createClient()

  const { data: orders } = await supabase
    .from('orders')
    .select('id, customer_id, source, delivery_date')
    .in('status', ['approved', 'shipped'])
    .order('delivery_date', { ascending: true })
  if (!orders || orders.length === 0) return []

  const orderIds = orders.map((o) => o.id)
  const { data: items } = await supabase
    .from('order_items')
    .select('id, order_id, product_id, product_name, quantity, shipped_qty, billable_qty, price_status, unit_price, tax_rate')
    .in('order_id', orderIds)
    .neq('price_status', 'confirmed')
  if (!items || items.length === 0) return []

  const customerIds = [...new Set(orders.map((o) => o.customer_id).filter(Boolean))] as string[]
  const { data: custs } = customerIds.length
    ? await supabase.from('customers').select('id, name, display_color').in('id', customerIds)
    : { data: [] as { id: string; name: string; display_color: string | null }[] }
  const custName = new Map((custs ?? []).map((c) => [c.id, c.name]))
  const custColor = new Map((custs ?? []).map((c) => [c.id, c.display_color]))

  const itemsByOrder = new Map<string, PendingPriceItem[]>()
  for (const it of items) {
    const ordered = Number(it.quantity)
    const shipped = it.shipped_qty != null ? Number(it.shipped_qty) : null
    const billable = it.billable_qty != null ? Number(it.billable_qty) : (shipped ?? ordered)
    const arr = itemsByOrder.get(it.order_id) ?? []
    arr.push({
      id: it.id,
      productId: it.product_id,
      productName: it.product_name,
      orderedQty: ordered,
      shippedQty: shipped,
      billableQty: billable,
      priceStatus: it.price_status,
      unitPrice: Number(it.unit_price),
      taxRate: Number(it.tax_rate),
    })
    itemsByOrder.set(it.order_id, arr)
  }

  return orders
    .filter((o) => itemsByOrder.has(o.id))
    .map((o) => ({
      customerId: o.customer_id,
      customerName: o.customer_id ? (custName.get(o.customer_id) ?? '（不明な取引先）') : '取引先 未紐付け',
      customerColor: o.customer_id ? (custColor.get(o.customer_id) ?? null) : null,
      channel: o.source,
      deliveryDate: o.delivery_date,
      orderId: o.id,
      items: itemsByOrder.get(o.id) ?? [],
    }))
}
