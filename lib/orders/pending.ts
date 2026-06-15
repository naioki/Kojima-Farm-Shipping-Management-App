import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { getSetting } from '@/lib/settings'
import { parseThreshold } from '@/lib/ingestion/auto-approve'

/**
 * 承認待ち（pending_review）注文の取得（管理者/スタッフ承認画面で共有）。
 * 各注文に「スタッフが承認できるか（高確信・取引先一致・納品日確定）」を付与する。
 */
export interface PendingOrderItem {
  id: string
  productName: string
  quantity: number
  unit: string
  confidence: number | null
}

export interface PendingOrder {
  id: string
  source: string
  deliveryDate: string | null
  customerId: string | null
  customerName: string
  customerColor: string | null
  items: PendingOrderItem[]
  /** 最低確信度（null は確信度なし＝要注意） */
  minConfidence: number | null
  /** 納品日が未確定（承認時に入力が必要） */
  needsDeliveryDate: boolean
  /** スタッフでも承認できるか（高確信・取引先一致・納品日確定） */
  staffApprovable: boolean
}

export async function getPendingOrders(): Promise<PendingOrder[]> {
  const supabase = createClient()
  const threshold = parseThreshold(await getSetting('AUTO_APPROVE_THRESHOLD'))

  const { data: orders } = await supabase
    .from('orders')
    .select('id, source, delivery_date, customer_id')
    .eq('status', 'pending_review')
    .order('created_at', { ascending: true })

  if (!orders || orders.length === 0) return []

  const orderIds = orders.map((o) => o.id)
  const customerIds = [...new Set(orders.map((o) => o.customer_id).filter(Boolean))] as string[]

  const [{ data: items }, { data: custs }] = await Promise.all([
    supabase
      .from('order_items')
      .select('id, order_id, product_name, quantity, unit, confidence')
      .in('order_id', orderIds),
    customerIds.length
      ? supabase.from('customers').select('id, name, display_color').in('id', customerIds)
      : Promise.resolve({ data: [] as { id: string; name: string; display_color: string | null }[] }),
  ])

  const custName = new Map((custs ?? []).map((c) => [c.id, c.name]))
  const custColor = new Map((custs ?? []).map((c) => [c.id, c.display_color]))
  const itemsByOrder = new Map<string, PendingOrderItem[]>()
  for (const it of items ?? []) {
    const arr = itemsByOrder.get(it.order_id) ?? []
    arr.push({
      id: it.id,
      productName: it.product_name,
      quantity: Number(it.quantity),
      unit: it.unit,
      confidence: it.confidence != null ? Number(it.confidence) : null,
    })
    itemsByOrder.set(it.order_id, arr)
  }

  return orders.map((o) => {
    const orderItems = itemsByOrder.get(o.id) ?? []
    const confidences = orderItems.map((i) => i.confidence)
    const minConfidence = confidences.length
      ? confidences.reduce<number | null>((min, c) => {
          if (c == null) return null
          if (min == null) return min // 一度 null を見たら null（未採点あり）
          return Math.min(min, c)
        }, 1)
      : null
    const needsDeliveryDate = !o.delivery_date
    const allConfident = orderItems.length > 0 && minConfidence != null && minConfidence >= threshold
    const staffApprovable = Boolean(o.customer_id) && !needsDeliveryDate && allConfident

    return {
      id: o.id,
      source: o.source,
      deliveryDate: o.delivery_date,
      customerId: o.customer_id,
      customerName: o.customer_id ? (custName.get(o.customer_id) ?? '（不明な取引先）') : '取引先 未紐付け',
      customerColor: o.customer_id ? (custColor.get(o.customer_id) ?? null) : null,
      items: orderItems,
      minConfidence,
      needsDeliveryDate,
      staffApprovable,
    }
  })
}
