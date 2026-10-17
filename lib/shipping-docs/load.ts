import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { formatSupplyDestination } from '@/lib/format/destination'
import {
  aggregateEntries,
  decomposeQty,
  type ShippingDocEntry,
} from '@/lib/calculations/shipping-docs'

/**
 * 出荷帳票（出荷表カード・出荷ラベル）の共通データローダー。
 *
 * 特定の取引先・品目に依存しない汎用設計:
 *   - 対象 = 指定日の全注文（出荷一覧 /field/shipments と同じ条件。画面と紙を一致させる）
 *   - 供給先 = 取引先＞納入先 を formatSupplyDestination で解決
 *   - 入数 = order_items の pack_config（荷姿）→ products.container_capacity の順でフォールバック
 *   - 絞り込みは customerId / productId のオプション引数（マスタIDのみ。名前文字列で判定しない）
 */

export interface ShippingDocsQuery {
  date: string
  customerId?: string | null
  /** 複数取引先での絞り込み（印刷画面のチェックボックス）。指定時は customerId より優先。 */
  customerIds?: string[] | null
  productId?: string | null
}

export interface ShippingDocsResult {
  entries: ShippingDocEntry[]
  /** 例: 7月5日 */
  dateDisplay: string
  /** 例: 7 月　5 日（出荷表カードの出荷日欄） */
  dateDisplayWide: string
  error?: string
}

export async function loadShippingDocEntries(q: ShippingDocsQuery): Promise<ShippingDocsResult> {
  const [, m, d] = q.date.split('-').map(Number)
  const dateDisplay = `${m}月${d}日`
  const dateDisplayWide = `${m} 月　${d} 日`
  const empty = (error?: string): ShippingDocsResult => ({ entries: [], dateDisplay, dateDisplayWide, error })

  const supabase = createClient()

  let ordersQuery = supabase
    .from('orders')
    .select('id, customer_id, destination_id')
    .eq('delivery_date', q.date)
  if (q.customerIds && q.customerIds.length) ordersQuery = ordersQuery.in('customer_id', q.customerIds)
  else if (q.customerId) ordersQuery = ordersQuery.eq('customer_id', q.customerId)
  const { data: orders, error: ordersErr } = await ordersQuery
  if (ordersErr) return empty(ordersErr.message)
  if (!orders?.length) return empty()

  const orderIds = orders.map((o) => o.id)
  let itemsQuery = supabase
    .from('order_items')
    .select('order_id, product_id, product_name, quantity, unit, spec, container_type, pack_config_id')
    .in('order_id', orderIds)
  if (q.productId) itemsQuery = itemsQuery.eq('product_id', q.productId)
  const { data: items, error: itemsErr } = await itemsQuery
  if (itemsErr) return empty(itemsErr.message)
  if (!items?.length) return empty()

  const customerIds = [...new Set(orders.map((o) => o.customer_id))]
  const destinationIds = [...new Set(orders.map((o) => o.destination_id).filter(Boolean))] as string[]
  const productIds = [...new Set(items.map((i) => i.product_id))]
  const packIds = [...new Set(items.map((i) => i.pack_config_id).filter(Boolean))] as string[]

  const [{ data: custRows }, { data: destRows }, { data: prodRows }, { data: packRows }] = await Promise.all([
    supabase.from('customers').select('id, name').in('id', customerIds),
    destinationIds.length
      ? supabase.from('delivery_destinations').select('id, code, full_name, sort_order').in('id', destinationIds)
      : Promise.resolve({ data: [] as { id: string; code: string | null; full_name: string; sort_order: number }[] }),
    supabase.from('products').select('id, container_capacity').in('id', productIds),
    packIds.length
      ? supabase.from('pack_configs').select('id, base_per_selling, selling_unit_label, standing_notes').in('id', packIds)
      : Promise.resolve({ data: [] as { id: string; base_per_selling: number; selling_unit_label: string; standing_notes: string | null }[] }),
  ])

  const customerName = new Map((custRows ?? []).map((c) => [c.id, c.name]))
  const destById = new Map((destRows ?? []).map((dr) => [dr.id, dr]))
  const capacityById = new Map((prodRows ?? []).map((p) => [p.id, p.container_capacity]))
  const packById = new Map((packRows ?? []).map((p) => [p.id, p]))
  const orderById = new Map(orders.map((o) => [o.id, o]))

  // 供給先表示名 → 並び順（取引先名 → 納入先sort_order）。帳票は配送・仕分け順に出す。
  const sortKey = new Map<string, string>()

  const raw: ShippingDocEntry[] = []
  for (const it of items) {
    const order = orderById.get(it.order_id)
    if (!order) continue
    const cust = customerName.get(order.customer_id) ?? ''
    const dest = order.destination_id ? destById.get(order.destination_id) : null
    const storeName = dest ? dest.code || dest.full_name : null
    const destination = formatSupplyDestination(cust, storeName)
    if (!sortKey.has(destination)) {
      const destSort = String(dest?.sort_order ?? 999).padStart(4, '0')
      sortKey.set(destination, `${cust}:${destSort}`)
    }

    const pack = it.pack_config_id ? packById.get(it.pack_config_id) : null
    const unitsPerBox = Math.trunc(Number(pack?.base_per_selling ?? capacityById.get(it.product_id) ?? 0))
    const { boxes, remainder } = decomposeQty(it.quantity, unitsPerBox)
    raw.push({
      destination,
      customerName: cust,
      storeName,
      item: it.product_name,
      // 規格に加え、荷姿の固定追記（standing_notes）も帳票に載せる（毎回出す作業指示）。
      spec: [it.spec ?? '', pack?.standing_notes ?? ''].filter(Boolean).join(' / '),
      unitsPerBox,
      unitLabel: it.unit || '個',
      boxLabel: it.container_type || pack?.selling_unit_label || 'ケース',
      boxes,
      remainder,
      totalQty: it.quantity,
    })
  }

  const entries = aggregateEntries(raw).sort((a, b) => {
    const ka = sortKey.get(a.destination) ?? ''
    const kb = sortKey.get(b.destination) ?? ''
    if (ka !== kb) return ka.localeCompare(kb, 'ja')
    return a.item.localeCompare(b.item, 'ja')
  })

  return { entries, dateDisplay, dateDisplayWide }
}
