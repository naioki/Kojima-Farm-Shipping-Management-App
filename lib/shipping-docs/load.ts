import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { formatSupplyDestination } from '@/lib/format/destination'
import { resolveContainerType } from '@/lib/pipeline/schemas'
import {
  aggregateEntries,
  decomposeQty,
  type ShippingDocEntry,
} from '@/lib/calculations/shipping-docs'
import { resolvePacksPerCase, splitPacksForCustomer } from '@/lib/masters/packs-per-case'

/**
 * 出荷帳票（出荷表カード・出荷ラベル）の共通データローダー。
 * - #30: status IN ('approved', 'shipped', 'invoiced') かつ quantity > 0 の確定明細のみを抽出し、キャンセル済や未承認注文の誤印字を完全防止。
 * - #31: 1箱の入数は lib/masters/packs-per-case.ts（取引先別の設定 → 荷姿（明細 → 取引先専用 → 取引先共通）→
 *   品目の標準 → 既定20）で決める。現場の出荷一覧・積込リストと同じ値になる（規格文字列からは推測しない）。
 */

export interface ShippingDocsQuery {
  date: string
  customerId?: string | null
  customerIds?: string[] | null
  productId?: string | null
}

export interface ShippingDocsResult {
  entries: ShippingDocEntry[]
  dateDisplay: string
  dateDisplayWide: string
  error?: string
}

export async function loadShippingDocEntries(q: ShippingDocsQuery): Promise<ShippingDocsResult> {
  const [, m, d] = q.date.split('-').map(Number)
  const dateDisplay = `${m}月${d}日`
  const dateDisplayWide = `${m} 月　${d} 日`
  const empty = (error?: string): ShippingDocsResult => ({ entries: [], dateDisplay, dateDisplayWide, error })

  const supabase = createAdminClient()

  // #30 有効な確定注文のみ抽出
  let ordersQuery = supabase
    .from('orders')
    .select('id, customer_id, destination_id')
    .eq('delivery_date', q.date)
    .in('status', ['approved', 'shipped', 'invoiced'])
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
    .gt('quantity', 0)
  if (q.productId) itemsQuery = itemsQuery.eq('product_id', q.productId)
  const { data: items, error: itemsErr } = await itemsQuery
  if (itemsErr) return empty(itemsErr.message)
  if (!items?.length) return empty()

  const customerIds = [...new Set(orders.map((o) => o.customer_id))]
  const destinationIds = [...new Set(orders.map((o) => o.destination_id).filter(Boolean))] as string[]
  const productIds = [...new Set(items.map((i) => i.product_id))]
  const packIds = [...new Set(items.map((i) => i.pack_config_id).filter(Boolean))] as string[]

  const [{ data: custRows }, { data: destRows }, { data: prodRows }, { data: packRows }, { data: ruleRows }, productPacksRes] =
    await Promise.all([
      supabase.from('customers').select('id, name').in('id', customerIds),
      destinationIds.length
        ? supabase.from('delivery_destinations').select('*').in('id', destinationIds)
        : Promise.resolve({ data: [] as { id: string; code: string | null; full_name: string; sort_order: number }[] }),
      supabase.from('products').select('id, container_capacity').in('id', productIds),
      packIds.length
        ? supabase.from('pack_configs').select('id, base_per_selling, selling_unit_label, standing_notes').in('id', packIds)
        : Promise.resolve({
            data: [] as { id: string; base_per_selling: number; selling_unit_label: string; standing_notes: string | null }[],
          }),
      customerIds.length
        ? supabase
            .from('customer_product_rules')
            .select('*')
            .in('customer_id', customerIds)
        : Promise.resolve({
            data: [] as { customer_id: string; product_id: string; packs_per_case: number | null; label_spec?: string | null }[],
          }),
      // 入数の解決用: 明細に荷姿が無いときの「取引先専用 → 取引先共通」の荷姿
      supabase
        .from('pack_configs')
        .select('id, product_id, customer_id, base_per_selling, is_active')
        .in('product_id', productIds),
    ])
  // 入数を決める荷姿が読めないと箱数が変わるので、黙って続けずに帳票をエラーにする
  if (productPacksRes.error) return empty(productPacksRes.error.message)
  const productPacks = productPacksRes.data ?? []

  const customerName = new Map((custRows ?? []).map((c) => [c.id, c.name]))
  const destById = new Map((destRows ?? []).map((dr) => [dr.id, dr]))
  const capacityById = new Map((prodRows ?? []).map((p) => [p.id, p.container_capacity]))
  const packById = new Map((packRows ?? []).map((p) => [p.id, p]))
  const ruleByPair = new Map((ruleRows ?? []).map((r) => [`${r.customer_id}:${r.product_id}`, r]))
  const orderById = new Map(orders.map((o) => [o.id, o]))

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
    const rule = ruleByPair.get(`${order.customer_id}:${it.product_id}`)
    // #31 取引先別の設定 → 荷姿 → 品目の標準 → 既定20
    const { customerPacks, sharedPacks } = splitPacksForCustomer(productPacks, order.customer_id, it.product_id)
    const unitsPerBox = Math.trunc(
      resolvePacksPerCase({
        rule: rule ?? null,
        packConfig: pack ?? null,
        customerPacks,
        sharedPacks,
        product: { container_capacity: capacityById.get(it.product_id) },
      }).value,
    ) || 20
    const { boxes, remainder } = decomposeQty(it.quantity, unitsPerBox)
    raw.push({
      destination,
      customerName: cust,
      storeName,
      item: it.product_name,
      spec: [it.spec ?? rule?.label_spec ?? '', pack?.standing_notes ?? ''].filter(Boolean).join(' / '),
      unitsPerBox,
      unitLabel: it.unit || 'P',
      boxLabel: resolveContainerType({
        explicitContainer: it.container_type,
        ruleContainer: (rule as { container_type?: string | null } | undefined)?.container_type ?? null,
        destDefaultContainer: (dest as { default_container_type?: string | null } | null)?.default_container_type ?? null,
        clientName: cust,
        destination: storeName,
        rawText: it.spec,
      }),
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
