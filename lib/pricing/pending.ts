import 'server-only'
import { createClient } from '@/lib/supabase/server'

/**
 * 価格確定が必要な明細の「フラット一覧」（フィルター＋一括値付け画面用）。
 * 品目・取引先・日付・荷姿で横断的に絞り込み、選択して一括確定するための素材。
 */
export interface PricingFlatItem {
  id: string
  productId: string
  productName: string
  customerId: string | null
  customerName: string
  customerColor: string | null
  channel: string
  deliveryDate: string | null
  packConfigId: string | null
  /** 荷姿の販売単位名（無ければ「総数」） */
  packLabel: string
  orderedQty: number
  shippedQty: number | null
  billableQty: number
  priceStatus: 'unpriced' | 'provisional' | 'confirmed'
  unitPrice: number
  taxRate: number
}

export async function getPricingItemsFlat(): Promise<PricingFlatItem[]> {
  const supabase = createClient()

  // DBエラーを「確定待ちゼロ（＝全部済み）」に化けさせない。呼び出し元（価格確定ページ）で
  // error.tsx に拾わせるため、握りつぶさず throw する（CLAUDE.md: NEVER swallow errors）。
  const { data: orders, error: ordersErr } = await supabase
    .from('orders')
    .select('id, customer_id, source, delivery_date')
    .in('status', ['approved', 'shipped'])
  if (ordersErr) throw new Error(`価格確定対象の注文取得に失敗しました: ${ordersErr.message}`)
  if (!orders || orders.length === 0) return []

  const orderById = new Map(orders.map((o) => [o.id, o]))
  const orderIds = orders.map((o) => o.id)

  const { data: items, error: itemsErr } = await supabase
    .from('order_items')
    .select('id, order_id, product_id, product_name, quantity, shipped_qty, billable_qty, price_status, unit_price, tax_rate, pack_config_id')
    .in('order_id', orderIds)
    .neq('price_status', 'confirmed')
  if (itemsErr) throw new Error(`価格確定対象の明細取得に失敗しました: ${itemsErr.message}`)
  if (!items || items.length === 0) return []

  const customerIds = [...new Set(orders.map((o) => o.customer_id).filter(Boolean))] as string[]
  const packIds = [...new Set(items.map((i) => i.pack_config_id).filter(Boolean))] as string[]
  const [{ data: custs, error: custsErr }, { data: packs, error: packsErr }] = await Promise.all([
    customerIds.length
      ? supabase.from('customers').select('id, name, display_color').in('id', customerIds)
      : Promise.resolve({ data: [] as { id: string; name: string; display_color: string | null }[], error: null }),
    packIds.length
      ? supabase.from('pack_configs').select('id, selling_unit_label').in('id', packIds)
      : Promise.resolve({ data: [] as { id: string; selling_unit_label: string }[], error: null }),
  ])
  // 取引先名・荷姿名は補助表示。失敗しても本体は返し、名前は「（不明）」等にフォールバック。
  if (custsErr) console.error('[pricing/pending] 取引先名の取得に失敗:', custsErr.message)
  if (packsErr) console.error('[pricing/pending] 荷姿名の取得に失敗:', packsErr.message)
  const custName = new Map((custs ?? []).map((c) => [c.id, c.name]))
  const custColor = new Map((custs ?? []).map((c) => [c.id, c.display_color]))
  const packLabelById = new Map((packs ?? []).map((p) => [p.id, p.selling_unit_label]))

  return items.map((it) => {
    const o = orderById.get(it.order_id)!
    const ordered = Number(it.quantity)
    const shipped = it.shipped_qty != null ? Number(it.shipped_qty) : null
    return {
      id: it.id,
      productId: it.product_id,
      productName: it.product_name,
      customerId: o.customer_id,
      customerName: o.customer_id ? (custName.get(o.customer_id) ?? '（不明）') : '未紐付け',
      customerColor: o.customer_id ? (custColor.get(o.customer_id) ?? null) : null,
      channel: o.source,
      deliveryDate: o.delivery_date,
      packConfigId: it.pack_config_id,
      packLabel: it.pack_config_id ? (packLabelById.get(it.pack_config_id) ?? '荷姿') : '総数',
      orderedQty: ordered,
      shippedQty: shipped,
      billableQty: it.billable_qty != null ? Number(it.billable_qty) : (shipped ?? ordered),
      priceStatus: it.price_status,
      unitPrice: Number(it.unit_price),
      taxRate: Number(it.tax_rate),
    }
  })
}
