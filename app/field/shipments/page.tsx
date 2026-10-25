import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getAuthedUser } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getRouteOverrides } from '@/lib/field/destination-routes-store'
import { ErrorState } from '@/components/ui/States'
import { formatQty } from '@/lib/calculations/format-qty'
import { jstTodayStr, shiftDateStr } from '@/lib/dates'
import { DateNav } from '@/components/field/DateNav'
import { FieldViewSwitch } from '@/components/field/FieldViewSwitch'
import { GuideTourLauncher } from '@/components/guide/GuideTourLauncher'
import { SHIPMENTS_TOUR } from '@/lib/guide/tours'
import { getStaffFeatures, canStaffUse } from '@/lib/field/features'
import { ProductSelectorTabs, type ProductTabItem } from '@/components/field/ProductSelectorTabs'
import { type ContainerBreakdownItem, type SpecBreakdownItem } from '@/components/field/HarvestPulseSummary'
import { calculateChainInventory } from '@/lib/inventory/chain'
import { PackingAndShippingViews, type ShipmentItemData } from '@/components/field/PackingAndShippingViews'
import { resolveDefaultRouteInfo } from '@/lib/field/shipment-sort'
import { ShipmentAddForm } from '@/components/field/ShipmentAddForm'
import type { SpecWarning, FieldStatus } from '@/types/database'
import type { PackInstructionValues } from '@/components/admin/PackInstructions'
import type { ReceiptOriginalInfo } from '@/lib/orders/pending'

type PackInstructionRow = {
  id: string
  base_per_selling: number
  selling_unit_label: string
  needs_manual_confirm: boolean
} & PackInstructionValues

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const fetchCache = 'force-no-store'

const PATH = '/field/shipments'

function resolveItemPerCase(
  packBase: number | null | undefined,
  rulePacksPerCase: number | null | undefined,
  customerName: string,
  spec: string | null | undefined,
  defaultCap: number | null | undefined,
): number {
  const combinedSpec = `${customerName} ${spec || ''}`.normalize('NFKC')
  const specMatch = combinedSpec.match(/(?:入数|1箱|1ケース)\s*(\d+)|(\d+)\s*(?:入|パック|P)/i)
  if (specMatch) {
    const parsedNum = Number(specMatch[1] || specMatch[2])
    if (Number.isFinite(parsedNum) && parsedNum > 0 && parsedNum <= 200) {
      return parsedNum
    }
  }
  if (packBase && packBase > 0) return packBase
  if (rulePacksPerCase && rulePacksPerCase > 0) return rulePacksPerCase
  if (combinedSpec.includes('農業総合研究所') || combinedSpec.includes('NSK')) return 24
  if (defaultCap && defaultCap > 0) return defaultCap
  return 20
}

export default async function ShipmentsPage({
  searchParams,
}: {
  searchParams: { date?: string; product?: string }
}) {
  const user = await getAuthedUser()
  if (!user) redirect('/login')

  // パック・収穫は全品目「出荷日の前日に収穫・パック」の原則に従うため、
  // デフォルトは翌日（明日出荷分 ＝ 本日パック作業対象）
  const defaultDate = shiftDateStr(jstTodayStr(), 1)
  const date = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.date ?? '') ? searchParams.date! : defaultDate
  const admin = createAdminClient()

  const { data: profile, error: profileErr } = await admin
    .from('users')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()
  if (profileErr) console.error('[field/shipments] ロールの取得に失敗:', profileErr.message)
  const role = (profile?.role as 'admin' | 'staff') ?? 'staff'
  const isAdmin = role === 'admin'
  const staffFeatures = await getStaffFeatures()
  const canReportSpec = canStaffUse('reportSpec', role, staffFeatures)

  // ① 全商品一覧 ＆ ② 当日の承認済み注文（未承認pending_reviewは別カウント）を並列取得
  const [prodListRes, ordersRes, pendingRes] = await Promise.all([
    admin
      .from('products')
      .select('id, name, unit, category')
      .eq('is_active', true)
      .order('category', { nullsFirst: false })
      .order('name'),
    admin
      .from('orders')
      .select('id, customer_id, destination_id, status')
      .eq('delivery_date', date)
      .in('status', ['approved', 'shipped', 'invoiced']),
    admin
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('delivery_date', date)
      .eq('status', 'pending_review'),
  ])

  if (prodListRes.error) return <ErrorState message={`商品の読み込みに失敗しました: ${prodListRes.error.message}`} />
  if (ordersRes.error) return <ErrorState message={ordersRes.error.message} />

  const allProducts = prodListRes.data ?? []
  const orders = ordersRes.data ?? []
  const pendingReviewCount = pendingRes.count ?? 0

  const orderIds = orders.map((o) => o.id)
  const orderToCustomer = new Map(orders.map((o) => [o.id, o.customer_id]))
  const orderToDestination = new Map(orders.map((o) => [o.id, o.destination_id]))

  // ③ 当日の明細取得（0026未適用DB環境にも安全にフォールバック）
  type RawOrderItemRow = {
    id: string
    order_id: string
    product_id: string
    product_name: string
    quantity: number
    unit: string
    field_status: FieldStatus
    version: number
    spec: string | null
    container_type: string | null
    has_card: boolean | null
    line_note: string | null
    shipped_qty: number | null
    field_note: string | null
    spec_warnings: SpecWarning[] | null
    pack_config_id: string | null
    rule_id: string | null
    is_flagged?: boolean | null
    bag_type?: string | null
    seal_text?: string | null
    has_seal?: boolean | null
    daily_pack_sort_order?: number | null
    snap_total_packs?: number | null
    is_manual_modified?: boolean | null
    is_new_addition?: boolean | null
  }
  let allItems: RawOrderItemRow[] = []
  if (orderIds.length) {
    const v5ItemsRes = await admin
      .from('order_items')
      .select(`
        id, order_id, product_id, product_name, quantity, unit, field_status, version,
        spec, container_type, has_card, line_note, shipped_qty, field_note, spec_warnings,
        pack_config_id, rule_id, is_flagged, bag_type, seal_text, has_seal, daily_pack_sort_order,
        snap_total_packs, is_manual_modified, is_new_addition
      `)
      .in('order_id', orderIds)
      .order('product_name')
    if (v5ItemsRes.error) {
      const fallbackRes = await admin
        .from('order_items')
        .select(`
          id, order_id, product_id, product_name, quantity, unit, field_status, version,
          spec, container_type, has_card, line_note, shipped_qty, field_note, spec_warnings,
          pack_config_id, rule_id, is_flagged
        `)
        .in('order_id', orderIds)
        .order('product_name')
      if (fallbackRes.error) {
        return <ErrorState message="出荷明細を読み込めませんでした。" detail={fallbackRes.error.message} />
      }
      allItems = (fallbackRes.data ?? []) as RawOrderItemRow[]
    } else {
      allItems = (v5ItemsRes.data ?? []) as RawOrderItemRow[]
    }
  }

  // ④ 品目ごとの件数・未完了件数集計＆タブ一覧生成（数量0の品目は除外、product_id欠落行も品目名から自動救済）
  const nonMaterialProducts = allProducts.filter((p) => p.category !== '資材')
  const defaultProductId = nonMaterialProducts[0]?.id ?? allProducts[0]?.id ?? ''

  function resolveEffectiveProductId(item: { product_id: string | null; product_name: string }): string {
    if (item.product_id && allProducts.some((p) => p.id === item.product_id)) {
      return item.product_id
    }
    const normName = (item.product_name || '').normalize('NFKC').trim()
    const matched = nonMaterialProducts.find(
      (p) =>
        p.name.normalize('NFKC') === normName ||
        (normName.includes('チンゲン') && p.name.includes('青梗菜')) ||
        (normName.includes('青梗菜') && p.name.includes('チンゲン')) ||
        p.name.includes(normName) ||
        normName.includes(p.name),
    )
    return matched?.id ?? defaultProductId
  }

  const countByProduct = new Map<string, number>()
  const incompleteByProduct = new Map<string, number>()
  for (const it of allItems) {
    if ((Number(it.quantity) || 0) > 0) {
      const effPid = resolveEffectiveProductId(it)
      it.product_id = effPid
      countByProduct.set(effPid, (countByProduct.get(effPid) ?? 0) + 1)
      if (it.field_status !== 'packed' && it.field_status !== 'shipped') {
        incompleteByProduct.set(effPid, (incompleteByProduct.get(effPid) ?? 0) + 1)
      }
    }
  }

  // ゼロ件の品目タブは非表示（全品目0件の場合は先頭品目1件のみ表示して空案内を表示）
  const rawTabs: ProductTabItem[] = nonMaterialProducts
    .map((p) => ({
      id: p.id,
      name: p.name,
      count: countByProduct.get(p.id) ?? 0,
      incompleteCount: incompleteByProduct.get(p.id) ?? 0,
    }))
    .sort((a, b) => b.count - a.count)

  const activeTabs = rawTabs.filter((p) => p.count > 0)
  const productTabs: ProductTabItem[] = activeTabs.length > 0 ? activeTabs : rawTabs.slice(0, 1)

  // 選択された品目（クエリ指定がなければ注文数が最大の品目、それもなければ先頭品目）
  const selectedProductId = searchParams.product && allProducts.some((p) => p.id === searchParams.product)
    ? searchParams.product
    : productTabs[0]?.id || ''
  const selectedProduct = allProducts.find((p) => p.id === selectedProductId)

  // ⑤ 選択された1品目の明細行に絞り込み（単一品目フォーカス・数量0は非表示）
  const items = allItems.filter((i) => i.product_id === selectedProductId && (Number(i.quantity) || 0) > 0)

  // ⑥ 納入先（出発便・時間・デフォルト作業順・コンテナ）取得（0026フォールバック付き）
  const customerIds = [...new Set(orders.map((o) => o.customer_id))]
  const productIds = [...new Set(items.map((i) => i.product_id))]

  type DestRow = {
    id: string
    customer_id?: string
    code: string | null
    full_name: string
    sort_order?: number
    pack_sort_order?: number | null
    shipping_route_name?: string | null
    departure_time?: string | null
    default_container_type?: string | null
  }

  // マスタ取得（RLS遮断防止のためすべて admin クライアントで取得）
  const [custRes, prodCapRes, destRows, rulesRes, routeOverrides, packSortMap] = await Promise.all([
    admin.from('customers').select('id, name, display_color').eq('is_active', true).order('name'),
    productIds.length
      ? admin.from('products').select('id, container_capacity').in('id', productIds)
      : Promise.resolve({ data: [] as { id: string; container_capacity: number | null }[], error: null }),
    (async (): Promise<DestRow[]> => {
      const r1 = await admin
        .from('delivery_destinations')
        .select('id, customer_id, code, full_name, sort_order, pack_sort_order, shipping_route_name, departure_time, default_container_type')
        .eq('is_active', true)
        .order('sort_order')
      if (!r1.error) return (r1.data ?? []) as DestRow[]
      const r2 = await admin
        .from('delivery_destinations')
        .select('id, customer_id, code, full_name, sort_order')
        .eq('is_active', true)
        .order('sort_order')
      return (r2.data ?? []) as DestRow[]
    })(),
    admin.from('customer_product_rules').select('*'),
    getRouteOverrides(admin).catch(() => ({} as Record<string, import('@/lib/field/destination-routes-store').RouteOverride>)),
    (async (): Promise<Record<string, number>> => {
      try {
        const r = await admin
          .from('app_settings')
          .select('value')
          .eq('key', 'v5_pack_sort_order')
          .maybeSingle()
        if (r.data?.value) return JSON.parse(r.data.value) as Record<string, number>
      } catch {}
      return {}
    })(),
  ])

  const ruleRows = rulesRes.data

  const allCustomers = custRes.data ?? []
  const allDestinations = destRows
  const customerName = new Map(allCustomers.map((c) => [c.id, c.name]))
  const customerColor = new Map(allCustomers.map((c) => [c.id, c.display_color]))
  const capacityById = new Map((prodCapRes.data ?? []).map((p) => [p.id, p.container_capacity]))
  const destinationMap = new Map(allDestinations.map((d) => [d.id, d]))

  const ruleById = new Map((ruleRows ?? []).map((r) => [r.id as string, r as Record<string, unknown>]))
  const ruleByPair = new Map((ruleRows ?? []).map((r) => [`${r.customer_id}:${r.product_id}`, r as Record<string, unknown>]))
  const packsByPair: Record<string, number | null> = {}
  type RuleWithPacks = { customer_id: string; product_id: string; packs_per_case?: number | null }
  for (const r of (ruleRows ?? []) as RuleWithPacks[]) {
    packsByPair[`${r.customer_id}:${r.product_id}`] = r.packs_per_case ?? null
  }

  // 荷姿マスタ取得
  const packIds = [...new Set(items.map((i) => i.pack_config_id).filter(Boolean))] as string[]
  const { data: packRows, error: packErr } = packIds.length
    ? await admin
        .from('pack_configs')
        .select(`
          id, base_per_selling, selling_unit_label, needs_manual_confirm, spec_note, has_card,
          has_seal, tape_color, label_spec, price_tag_required, returnable_container, quality_note,
          standing_notes, field_memo
        `)
        .in('id', packIds)
    : { data: [] as PackInstructionRow[], error: null }
  if (packErr) console.error('[field/shipments] pack_configs 取得失敗:', packErr.message)

  const packById = new Map((packRows ?? []).map((p) => [p.id, { base: Number(p.base_per_selling), unit: p.selling_unit_label }]))
  const needsConfirmByPack = new Map((packRows ?? []).map((p) => [p.id, p.needs_manual_confirm]))
  const packInstructionsById = new Map((packRows ?? []).map((p) => [p.id, p as PackInstructionValues]))

  // 受注原本取得
  function checkReceiptHasFile(receiptRow: { r2_key?: string | null; raw_payload?: unknown }): boolean {
    const p = (receiptRow.raw_payload ?? {}) as Record<string, unknown>
    const slip = (p['slip_data'] ?? {}) as Record<string, unknown>
    const rawUrl =
      (typeof p['source_file_url'] === 'string' && p['source_file_url'].trim()) ||
      (typeof p['drive_url'] === 'string' && p['drive_url'].trim()) ||
      (typeof p['drive_backup_url'] === 'string' && p['drive_backup_url'].trim()) ||
      (typeof p['file_url'] === 'string' && p['file_url'].trim()) ||
      (typeof p['url'] === 'string' && p['url'].trim()) ||
      (typeof slip['source_file_url'] === 'string' && slip['source_file_url'].trim()) ||
      (typeof receiptRow.r2_key === 'string' && receiptRow.r2_key.trim()) ||
      null
    return Boolean(rawUrl || (typeof p['file_base64'] === 'string' && p['file_base64'].trim()))
  }

  const receiptByOrder = new Map<string, ReceiptOriginalInfo>()
  if (orderIds.length > 0) {
    const { data: directReceipts } = await admin
      .from('order_receipts')
      .select('id, order_id, channel, r2_key, raw_payload, is_revision, delivery_date, customer_id')
      .in('order_id', orderIds)

    for (const rr of directReceipts ?? []) {
      if (rr.order_id) {
        const hasFile = checkReceiptHasFile(rr)
        receiptByOrder.set(rr.order_id, {
          id: rr.id,
          channel: rr.channel,
          hasOriginal: hasFile,
          originalUrl: hasFile ? `/field/viewer/${rr.id}?date=${date}` : null,
          emailText: null,
          isRevision: Boolean(rr.is_revision),
          parent: null,
        })
      }
    }

    const missingOrderIds = orderIds.filter((oid) => !receiptByOrder.has(oid))
    if (missingOrderIds.length > 0 && customerIds.length > 0) {
      const { data: candidateReceipts } = await admin
        .from('order_receipts')
        .select('id, order_id, channel, r2_key, raw_payload, is_revision, delivery_date, customer_id')
        .in('customer_id', customerIds)
        .order('created_at', { ascending: false })
        .limit(40)

      for (const cr of candidateReceipts ?? []) {
        const p = (cr.raw_payload ?? {}) as Record<string, unknown>
        const cOrderIds = Array.isArray(p['created_order_ids'])
          ? (p['created_order_ids'] as string[])
          : []

        const hasFile = checkReceiptHasFile(cr)

        for (const mId of missingOrderIds) {
          if (cOrderIds.includes(mId) && !receiptByOrder.has(mId)) {
            receiptByOrder.set(mId, {
              id: cr.id,
              channel: cr.channel,
              hasOriginal: hasFile,
              originalUrl: hasFile ? `/field/viewer/${cr.id}?date=${date}` : null,
              emailText: null,
              isRevision: Boolean(cr.is_revision),
              parent: null,
            })
          }
        }
      }

      for (const mId of missingOrderIds) {
        if (receiptByOrder.has(mId)) continue
        const custId = orderToCustomer.get(mId)
        if (!custId) continue
        const fallbackReceipt = (candidateReceipts ?? []).find(
          (cr) => cr.customer_id === custId && checkReceiptHasFile(cr)
        )
        if (fallbackReceipt) {
          receiptByOrder.set(mId, {
            id: fallbackReceipt.id,
            channel: fallbackReceipt.channel,
            hasOriginal: true,
            originalUrl: `/field/viewer/${fallbackReceipt.id}?date=${date}`,
            emailText: null,
            isRevision: Boolean(fallbackReceipt.is_revision),
            parent: null,
          })
        }
      }
    }
  }

  // ⑦ 在庫（コンテナ）の連鎖キャリーオーバー取得
  const chainInventory = selectedProductId
    ? await calculateChainInventory(admin, selectedProductId, date, 14)
    : { effectiveStock: 0, inheritedCarryover: 0, hasManualStock: false, manualStock: null, todayCarryover: 0 }

  // ⑧ 選択中品目の集計（コンテナ内訳・規格内訳）
  const containerCounts = new Map<string, number>()
  const specCounts = new Map<string, { packs: number; boxes: number }>()

  const shipmentItems: ShipmentItemData[] = items.map((it) => {
    const custId = orderToCustomer.get(it.order_id)
    const destId = orderToDestination.get(it.order_id)
    const dest = destId ? destinationMap.get(destId) : null
    const cName = custId ? customerName.get(custId) ?? '—' : '—'
    const dName = dest?.code?.trim() || dest?.full_name || cName
    const color = custId ? customerColor.get(custId) ?? null : null

    const pack = it.pack_config_id ? packById.get(it.pack_config_id) : null
    const rule = (it.rule_id ? ruleById.get(it.rule_id) : null) ?? (custId ? ruleByPair.get(`${custId}:${it.product_id}`) : null)
    const rulePacksPerCase = typeof rule?.packs_per_case === 'number' ? rule.packs_per_case : null
    const ruleLabelSpec = typeof rule?.label_spec === 'string' ? rule.label_spec : null
    const ruleTapeColor = typeof rule?.tape_color === 'string' ? rule.tape_color : null
    const rulePackingNotes = typeof rule?.packing_notes === 'string' ? rule.packing_notes : null
    const ruleBagType = typeof rule?.bag_type === 'string' ? rule.bag_type : null
    const ruleSealText = typeof rule?.seal_text === 'string' ? rule.seal_text : null
    const ruleHasSeal = typeof rule?.has_seal === 'boolean' ? rule.has_seal : null

    const perCase = resolveItemPerCase(
      pack?.base,
      rulePacksPerCase,
      cName,
      it.spec || ruleLabelSpec,
      capacityById.get(it.product_id),
    )

    const qty = it.quantity

    // 箱数計算: ケース数 + (端数 > 0 ? 1 : 0)
    const cases = Math.floor(qty / perCase)
    const rem = qty % perCase
    const boxCount = cases + (rem > 0 ? 1 : 0)

    // コンテナ集計
    const contType = it.container_type || dest?.default_container_type || (dName.includes('岩槻') ? '青コン' : dName.includes('戸田') ? '茶コン' : '通常コンテナ')
    containerCounts.set(contType, (containerCounts.get(contType) ?? 0) + boxCount)

    // 規格集計
    const specLabel = it.spec || ruleLabelSpec || '2〜3株 (標準)'
    const curSpec = specCounts.get(specLabel) ?? { packs: 0, boxes: 0 }
    curSpec.packs += qty
    curSpec.boxes += boxCount
    specCounts.set(specLabel, curSpec)

    const override =
      (destId ? routeOverrides[`date:${date}:dest:${destId}`] : null) ||
      (dName && custId ? routeOverrides[`date:${date}:cust:${custId}:${dName}`] : null) ||
      (custId ? routeOverrides[`date:${date}:cust:${custId}:default`] : null) ||
      (destId ? routeOverrides['dest:' + destId] : null) ||
      (dName ? routeOverrides['cust:' + custId + ':' + dName] : null) ||
      (custId ? routeOverrides['cust:' + custId + ':default'] : null) ||
      null

    const routeInfo = resolveDefaultRouteInfo({
      destName: dName,
      customerName: cName,
      dest,
      override,
    })

    const resolvedShippingRoute = routeInfo.shippingRouteName
    const resolvedDepartureTime = routeInfo.departureTime

    const resolvedDailyPackSortOrder = it.daily_pack_sort_order ?? (it.id ? packSortMap[it.id] : null) ?? null

    return {
      itemId: it.id,
      customerName: cName,
      customerColor: color,
      destinationId: destId ?? null,
      destinationName: dName,
      quantityText: formatQty(qty, perCase, pack),
      orderedQty: qty,
      initialStatus: it.field_status,
      initialVersion: it.version,
      initialSpec: it.spec,
      initialContainer: contType,
      initialHasCard: it.has_card,
      initialLineNote: it.line_note,
      initialShippedQty: it.shipped_qty,
      initialFieldNote: it.field_note,
      specWarnings: it.spec_warnings,
      masterLabelSpec: ruleLabelSpec,
      masterTapeColor: ruleTapeColor,
      masterPackingNotes: rulePackingNotes,
      masterPacksPerCase: perCase,
      needsManualConfirm: Boolean(it.is_flagged) || (it.pack_config_id ? Boolean(needsConfirmByPack.get(it.pack_config_id)) : false),
      packInstructions: it.pack_config_id ? packInstructionsById.get(it.pack_config_id) : null,
      customerId: custId,
      productId: it.product_id,
      canEditRulesDirectly: isAdmin,
      canReportSpec,
      bagType: it.bag_type ?? ruleBagType,
      sealText: it.seal_text ?? ruleSealText,
      hasSeal: it.has_seal ?? ruleHasSeal,
      dailyPackSortOrder: resolvedDailyPackSortOrder,
      defaultPackSortOrder: dest?.pack_sort_order ?? 100,
      shippingRouteName: resolvedShippingRoute,
      departureTime: resolvedDepartureTime,
      deliveryDate: date,
      showShippingButton: false,
      receipt: receiptByOrder.get(it.order_id) ?? null,
    }
  })

  const containerBreakdown: ContainerBreakdownItem[] = Array.from(containerCounts.entries()).map(([type, boxes]) => ({
    type,
    boxes,
  }))

  const specBreakdown: SpecBreakdownItem[] = Array.from(specCounts.entries()).map(([spec, data]) => ({
    spec,
    packs: data.packs,
    boxes: data.boxes,
  }))

  // 翌日の承認済み注文明細（翌日先行枠・閲覧用）
  const nextDateStr = shiftDateStr(date, 1)
  const nextShipmentItems: ShipmentItemData[] = []

  if (selectedProductId) {
    const { data: nextOrders } = await admin
      .from('orders')
      .select('id, customer_id, destination_id')
      .eq('delivery_date', nextDateStr)
      .in('status', ['approved', 'shipped', 'invoiced'])

    const nextOrderIds = (nextOrders ?? []).map((o) => o.id)
    const nextOrderCustMap = new Map((nextOrders ?? []).map((o) => [o.id, o.customer_id]))
    const nextOrderDestMap = new Map((nextOrders ?? []).map((o) => [o.id, o.destination_id]))

    if (nextOrderIds.length > 0) {
      const { data: nextItems } = await admin
        .from('order_items')
        .select(`
          id, order_id, product_id, product_name, quantity, unit, field_status, version,
          spec, container_type, has_card, line_note, shipped_qty, field_note, spec_warnings,
          pack_config_id, rule_id, is_flagged, bag_type, seal_text, has_seal, daily_pack_sort_order,
          snap_total_packs, is_manual_modified, is_new_addition
        `)
        .eq('product_id', selectedProductId)
        .in('order_id', nextOrderIds)

      const defCapacity = capacityById.get(selectedProductId) ?? 20
      for (const ni of nextItems ?? []) {
        const custId = nextOrderCustMap.get(ni.order_id)
        const destId = nextOrderDestMap.get(ni.order_id)
        const dest = destId ? destinationMap.get(destId) : null
        const cName = custId ? customerName.get(custId) ?? '—' : '—'
        const dName = dest?.code?.trim() || dest?.full_name || cName
        const color = custId ? customerColor.get(custId) ?? null : null

        const pack = ni.pack_config_id ? packById.get(ni.pack_config_id) : null
        const rule = (ni.rule_id ? ruleById.get(ni.rule_id) : null) ?? (custId ? ruleByPair.get(`${custId}:${ni.product_id}`) : null)
        const rulePacksPerCase = typeof rule?.packs_per_case === 'number' ? rule.packs_per_case : null
        const ruleLabelSpec = typeof rule?.label_spec === 'string' ? rule.label_spec : null
        const ruleTapeColor = typeof rule?.tape_color === 'string' ? rule.tape_color : null
        const rulePackingNotes = typeof rule?.packing_notes === 'string' ? rule.packing_notes : null
        const ruleBagType = typeof rule?.bag_type === 'string' ? rule.bag_type : null
        const ruleSealText = typeof rule?.seal_text === 'string' ? rule.seal_text : null
        const ruleHasSeal = typeof rule?.has_seal === 'boolean' ? rule.has_seal : null

        const perCase = resolveItemPerCase(
          pack?.base,
          rulePacksPerCase,
          cName,
          ni.spec || ruleLabelSpec,
          defCapacity,
        )

        const qty = Number(ni.quantity) || 0
        if (qty <= 0) continue

        const contType = ni.container_type || dest?.default_container_type || (dName.includes('岩槻') ? '青コン' : dName.includes('戸田') ? '茶コン' : '通常コンテナ')

        const override =
          (destId ? routeOverrides[`date:${nextDateStr}:dest:${destId}`] : null) ||
          (dName && custId ? routeOverrides[`date:${nextDateStr}:cust:${custId}:${dName}`] : null) ||
          (custId ? routeOverrides[`date:${nextDateStr}:cust:${custId}:default`] : null) ||
          (destId ? routeOverrides['dest:' + destId] : null) ||
          (dName ? routeOverrides['cust:' + custId + ':' + dName] : null) ||
          (custId ? routeOverrides['cust:' + custId + ':default'] : null) ||
          null

        const routeInfo = resolveDefaultRouteInfo({
          destName: dName,
          customerName: cName,
          dest,
          override,
        })

        const resolvedShippingRoute = routeInfo.shippingRouteName
        const resolvedDepartureTime = routeInfo.departureTime

        nextShipmentItems.push({
          itemId: ni.id,
          customerName: cName,
          customerColor: color,
          destinationId: destId ?? null,
          destinationName: dName,
          quantityText: formatQty(qty, perCase, pack),
          orderedQty: qty,
          initialStatus: ni.field_status,
          initialVersion: ni.version,
          initialSpec: ni.spec,
          initialContainer: contType,
          initialHasCard: ni.has_card,
          initialLineNote: ni.line_note,
          initialShippedQty: ni.shipped_qty,
          initialFieldNote: ni.field_note,
          specWarnings: ni.spec_warnings,
          masterLabelSpec: ruleLabelSpec,
          masterTapeColor: ruleTapeColor,
          masterPackingNotes: rulePackingNotes,
          masterPacksPerCase: perCase,
          needsManualConfirm: Boolean(ni.is_flagged) || (ni.pack_config_id ? Boolean(needsConfirmByPack.get(ni.pack_config_id)) : false),
          packInstructions: ni.pack_config_id ? packInstructionsById.get(ni.pack_config_id) : null,
          customerId: custId,
          productId: ni.product_id,
          canEditRulesDirectly: isAdmin,
          canReportSpec,
          bagType: ni.bag_type ?? ruleBagType,
          sealText: ni.seal_text ?? ruleSealText,
          hasSeal: ni.has_seal ?? ruleHasSeal,
          dailyPackSortOrder: ni.daily_pack_sort_order ?? (ni.id ? packSortMap[ni.id] : null) ?? null,
          defaultPackSortOrder: dest?.pack_sort_order ?? 100,
          shippingRouteName: resolvedShippingRoute,
          departureTime: resolvedDepartureTime,
          deliveryDate: nextDateStr,
          showShippingButton: false,
          isNextDay: true,
          receipt: receiptByOrder.get(ni.order_id) ?? null,
        })
      }
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-3.5 pb-10">
      {/* ナビゲーションバー */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h1 className="font-display text-xl font-black text-ink">収穫・パックボード</h1>
          <FieldViewSwitch active="day" date={date} />
          <GuideTourLauncher tour={SHIPMENTS_TOUR} />
        </div>
        <div className="flex items-center gap-2">
          <DateNav date={date} basePath={PATH} defaultDate={defaultDate} defaultLabel="明日出荷（本日パック）" />
        </div>
      </div>

      {/* 現場業務ナビゲーション（🥬 収穫・袋詰めボード［本日パック＝明日出荷］ ⇋ 🚚 便別積込・配送リスト［本日積込・出荷］） */}
      <div className="grid grid-cols-2 rounded-xl bg-bg-soft p-1 border border-line text-xs sm:text-sm font-bold shadow-xs">
        <span className="flex items-center justify-center gap-1.5 rounded-lg bg-forest-700 py-2 text-white shadow-xs">
          🥬 収穫・袋詰めボード
        </span>
        <Link
          href={`/field/deliveries?date=${date === defaultDate ? jstTodayStr() : date}`}
          className="flex items-center justify-center gap-1.5 rounded-lg py-2 text-ink-soft hover:text-ink hover:bg-white/60 transition"
        >
          🚚 便別積込・配送リスト
        </Link>
      </div>

      {/* 未承認データがある場合の控えめな通知バー */}
      {pendingReviewCount > 0 && (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-amber-300 bg-amber-50/90 px-3.5 py-2 text-xs font-bold text-amber-950">
          <span>⚠️ 未承認（要確認）の注文が {pendingReviewCount} 件あります（承認後に作業リストへ反映されます）</span>
          <Link
            href="/admin/inbox"
            className="shrink-0 rounded-lg bg-amber-600 px-2.5 py-1 text-white hover:bg-amber-700 transition"
          >
            確認する →
          </Link>
        </div>
      )}

      {/* ① 最上部：品目セレクタ（タブ） */}
      <ProductSelectorTabs
        products={productTabs}
        selectedProductId={selectedProductId}
        date={date}
      />

      {/* ② パック画面（リアルタイム進捗メーター ＋ 荷姿一覧 ＋ 翌日先行枠） */}
      {(shipmentItems.length > 0 || nextShipmentItems.length > 0) && selectedProduct ? (
        <PackingAndShippingViews
          key={`views-${date}-${selectedProductId}`}
          items={shipmentItems}
          nextDayItems={nextShipmentItems}
          date={date}
          isAdmin={isAdmin}
          productName={selectedProduct.name}
          productId={selectedProductId}
          containerBreakdown={containerBreakdown}
          specBreakdown={specBreakdown}
          initialCarryover={chainInventory.todayCarryover ?? 0}
          isTodayTarget={date === defaultDate || date === jstTodayStr()}
        />
      ) : (
        <div className="rounded-2xl border border-dashed border-line bg-white p-8 text-center text-ink-muted space-y-3">
          <p className="font-bold text-sm text-ink">この日の【{selectedProduct?.name || '選択品目'}】の出荷データはありません。</p>
          <p className="text-xs text-ink-faint">他の品目タブを選ぶか、翌日の出荷予定を確認できます。</p>
          <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
            <a
              href={`/field/shipments?date=${shiftDateStr(date, 1)}&product=${selectedProductId}`}
              className="inline-flex items-center gap-1 rounded-xl bg-forest-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-forest-700 shadow-xs"
            >
              翌日の予定を見る →
            </a>
            {isAdmin && (
              <a
                href="/admin/inbox"
                className="inline-flex items-center gap-1 rounded-xl border border-line bg-bg-soft px-3.5 py-2 text-xs font-bold text-ink hover:bg-slate-200"
              >
                受注ボックスを確認
              </a>
            )}
          </div>
        </div>
      )}

      {/* ④ スマート追加フォーム */}
      <ShipmentAddForm
        deliveryDate={date}
        customers={allCustomers.map((c) => ({ id: c.id, name: c.name }))}
        products={allProducts.map((p) => ({ id: p.id, name: p.name, unit: p.unit, category: p.category }))}
        destinations={allDestinations.map((d) => ({
          id: d.id,
          customerId: d.customer_id ?? '',
          label: d.code?.trim() || d.full_name,
        }))}
        packsByPair={packsByPair}
      />
    </div>
  )
}
