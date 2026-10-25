import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getAuthedUser } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getRouteOverrides } from '@/lib/field/destination-routes-store'
import { extractActionableNote } from '@/lib/field/clean-note'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { DateNav } from '@/components/field/DateNav'
import { FieldViewSwitch } from '@/components/field/FieldViewSwitch'
import {
  type CustomerDeliveryCardProps,
  type DestinationDetail,
} from '@/components/field/CustomerDeliveryCard'
import { DeliveriesBoardView } from '@/components/field/DeliveriesBoardView'
import { formatQty } from '@/lib/calculations/format-qty'
import { jstTodayStr } from '@/lib/dates'
import type { DeliveryStatus } from '@/types/database'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const fetchCache = 'force-no-store'

const PATH = '/field/deliveries'

/**
 * 配送リスト（手書き伝票思想の「取引先ワンボックス集約」画面）。
 * - 最上位グルーピングを「取引先」に統一し、同一取引先が便ごとに分裂する問題を完全解消。
 * - 規格・注文明細ごとにケース数＋端数箱を独立計算して合算（異規格の端数が1箱に混ざるバグを防止）。
 * - AI生成メタ文字列を除外し、本当の伝達事項（空コンテナ持参・入数変更など）のみを注意枠に表示。
 * - 収穫・パックボードと完全に統一されたヘッダー順序＆スクロール追従進捗バー。
 */
export default async function DeliveriesPage({
  searchParams,
}: {
  searchParams: { date?: string }
}) {
  const user = await getAuthedUser()
  if (!user) redirect('/login')

  const date = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.date ?? '') ? searchParams.date! : jstTodayStr()
  const admin = createAdminClient()

  // その日の出荷対象注文（承認済み・出荷済み・請求済みのみ表示、未承認pending_reviewは別カウント）
  const [ordersRes, pendingRes] = await Promise.all([
    admin
      .from('orders')
      .select('id, customer_id, destination_id, status, note, shipping_time')
      .eq('delivery_date', date)
      .in('status', ['approved', 'shipped', 'invoiced']),
    admin
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('delivery_date', date)
      .eq('status', 'pending_review'),
  ])

  if (ordersRes.error) return <ErrorState message={ordersRes.error.message} />
  const orders = ordersRes.data ?? []
  const pendingReviewCount = pendingRes.count ?? 0

  const orderIds = orders.map((o) => o.id)
  const itemsRes = orderIds.length
    ? await admin
        .from('order_items')
        .select('id, order_id, product_id, product_name, quantity, unit, spec, container_type, has_card, line_note, pack_config_id, field_status')
        .in('order_id', orderIds)
        .order('product_name')
    : null
  if (itemsRes?.error)
    return <ErrorState message="配送明細を読み込めませんでした。時間をおいて再度お試しください。" detail={itemsRes.error.message} />
  // 数量が0の品目は非表示
  const items = (itemsRes?.data ?? []).filter((i) => (Number(i.quantity) || 0) > 0)

  // 表示用マスタ＋その日の配送チェック状態（RLS遮断を防ぐためすべて admin クライアントで一括取得）
  const customerIds = [...new Set(orders.map((o) => o.customer_id))]
  const destinationIds = [...new Set(orders.map((o) => o.destination_id).filter(Boolean))] as string[]
  const productIds = [...new Set(items.map((i) => i.product_id))]
  const packIds = [...new Set(items.map((i) => i.pack_config_id).filter(Boolean))] as string[]

  type DestRow = {
    id: string
    code: string | null
    full_name: string
    shipping_route_name?: string | null
    departure_time?: string | null
    pack_sort_order?: number | null
    default_container_type?: string | null
  }

  type RuleRow = {
    customer_id: string
    product_id: string
    packs_per_case?: number | null
    default_container_type?: string | null
  }

  const [custRes, destRes, prodRes, packRes, deliveryRes, rulesRes, routeOverrides] = await Promise.all([
    customerIds.length
      ? admin.from('customers').select('id, name, display_color').in('id', customerIds)
      : Promise.resolve({ data: [] as { id: string; name: string; display_color?: string | null }[], error: null }),
    (async (): Promise<{ data: DestRow[] | null; error: { message: string } | null }> => {
      if (!destinationIds.length) return { data: [], error: null }
      const r1 = await admin
        .from('delivery_destinations')
        .select('id, code, full_name, shipping_route_name, departure_time, pack_sort_order, default_container_type')
        .in('id', destinationIds)
      if (!r1.error) return { data: (r1.data ?? []) as DestRow[], error: null }
      const r2 = await admin
        .from('delivery_destinations')
        .select('id, code, full_name')
        .in('id', destinationIds)
      if (r2.error) return { data: null, error: r2.error }
      return { data: (r2.data ?? []) as DestRow[], error: null }
    })(),
    productIds.length
      ? admin.from('products').select('id, container_capacity').in('id', productIds)
      : Promise.resolve({ data: [] as { id: string; container_capacity: number | null }[], error: null }),
    packIds.length
      ? admin.from('pack_configs').select('id, base_per_selling, selling_unit_label').in('id', packIds)
      : Promise.resolve({ data: [] as { id: string; base_per_selling: number; selling_unit_label: string }[], error: null }),
    admin.from('deliveries').select('id, customer_id, destination_id, status, photo_url, note').eq('delivery_date', date),
    customerIds.length
      ? admin.from('customer_product_rules').select('customer_id, product_id, packs_per_case, default_container_type').in('customer_id', customerIds)
      : Promise.resolve({ data: [] as RuleRow[], error: null }),
    getRouteOverrides(admin).catch(() => ({} as Record<string, import('@/lib/field/destination-routes-store').RouteOverride>)),
  ])

  if (custRes.error) return <ErrorState message="取引先名を読み込めませんでした。" detail={custRes.error.message} />
  if (destRes.error) return <ErrorState message="納入先を読み込めませんでした。" detail={destRes.error.message} />
  if (prodRes.error) return <ErrorState message="商品情報を読み込めませんでした。" detail={prodRes.error.message} />
  if (packRes.error) return <ErrorState message="荷姿情報を読み込めませんでした。" detail={packRes.error.message} />
  if (deliveryRes.error) return <ErrorState message="配送チェック状態を読み込めませんでした。" detail={deliveryRes.error.message} />

  const custById = new Map((custRes.data ?? []).map((c) => [c.id, { name: c.name, display_color: c.display_color }]))
  const destById = new Map((destRes.data ?? []).map((d) => [d.id, d]))
  const capacityById = new Map((prodRes.data ?? []).map((p) => [p.id, p.container_capacity]))
  const packById = new Map((packRes.data ?? []).map((p) => [p.id, { base: Number(p.base_per_selling), unit: p.selling_unit_label }]))
  const ruleByPair = new Map((rulesRes.data ?? []).map((r) => [`${r.customer_id}:${r.product_id}`, r]))

  type DeliveryRow = {
    id: string
    customer_id: string
    destination_id: string | null
    status: DeliveryStatus
    photo_url: string | null
    note: string | null
  }
  const deliveryByKey = new Map<string, DeliveryRow>()
  for (const d of (deliveryRes.data ?? []) as DeliveryRow[]) {
    deliveryByKey.set(`${d.customer_id}:${d.destination_id ?? ''}`, d)
  }

  // 備考等から納入先・センター名を抽出するヘルパー
  function extractDestName(orderNote: string | null, lineNote: string | null): string | null {
    const combined = `${orderNote ?? ''} ${lineNote ?? ''}`
    const match1 = combined.match(/【納入先[:：]([^】]+)】/)
    if (match1?.[1]) return match1[1].trim()
    const match2 = combined.match(/(?:納入先|お届け先|配送先)[:：\s]*([^\s,、・\n\]】]+)/)
    if (match2?.[1]) return match2[1].trim()
    return null
  }

  function isClockTime(t: string | null | undefined): boolean {
    if (!t) return false
    return /^\d{1,2}:\d{2}$/.test(t.trim())
  }

  function resolveRouteInfo(
    destName: string | null,
    customerName: string | null,
    dest?: DestRow | null,
    orderShippingTime?: string | null,
    override?: { shippingRouteName?: string | null; departureTime?: string | null } | null,
  ): { title: string; departureTime: string | null } {
    if (override && (override.shippingRouteName || isClockTime(override.departureTime))) {
      const effectiveTime = isClockTime(override.departureTime) ? override.departureTime! : null
      const timePrefix = effectiveTime ? `${effectiveTime}発 ` : ''
      const routeSuffix = override.shippingRouteName ? ` ${override.shippingRouteName}` : ''
      return {
        title: `${timePrefix}${routeSuffix}`.trim() || '指定便',
        departureTime: effectiveTime,
      }
    }

    if (dest?.shipping_route_name || isClockTime(dest?.departure_time)) {
      const effectiveTime = isClockTime(dest?.departure_time) ? dest!.departure_time! : null
      const timePrefix = effectiveTime ? `${effectiveTime}発 ` : ''
      const routeSuffix = dest?.shipping_route_name ? ` ${dest.shipping_route_name}` : ''
      return {
        title: `${timePrefix}${routeSuffix}`.trim(),
        departureTime: effectiveTime,
      }
    }
    const d = destName ?? ''
    const c = customerName ?? ''
    if (d.includes('岩槻') || c.includes('パルシステム')) {
      return { title: '11:30発 岩槻便', departureTime: '11:30' }
    }
    if (d.includes('戸田') || d.includes('ちばコープ')) {
      return { title: '14:00発 戸田便', departureTime: '14:00' }
    }
    if (d.includes('松戸') || d.includes('柏')) {
      return { title: '14:00発 松戸・柏便', departureTime: '14:00' }
    }
    if (c.includes('直売') || d.includes('直売')) {
      return { title: '直売所便', departureTime: null }
    }
    if (orderShippingTime === 'am') {
      return { title: '午前便', departureTime: '11:30' }
    }
    if (orderShippingTime === 'pm') {
      return { title: '午後便', departureTime: '14:00' }
    }
    return { title: '一般配送・時間未指定', departureTime: null }
  }

  // 1. 取引先（customer_id）を最上位キーとするデータ集約（便ごとに分断させない）
  const orderById = new Map(orders.map((o) => [o.id, o]))

  const customerGroupMap = new Map<
    string,
    {
      customerId: string
      customerName: string
      customerColor?: string | null
      notesSet: Set<string>
      routeSet: Map<string, { title: string; departureTime: string | null }>
      destinationsMap: Map<string, DestinationDetail>
    }
  >()

  for (const it of items) {
    const order = orderById.get(it.order_id)
    if (!order) continue

    const cust = custById.get(order.customer_id)
    const customerName = cust?.name ?? '—'
    const dest = order.destination_id ? destById.get(order.destination_id) : null
    const destName = dest ? dest.code || dest.full_name : extractDestName(order.note, it.line_note) || '直接納品'

    const override = (order.destination_id && routeOverrides[`dest:${order.destination_id}`])
      || (destName ? routeOverrides[`cust:${order.customer_id}:${destName}`] : null)
      || routeOverrides[`cust:${order.customer_id}:default`]
      || null

    const routeInfo = resolveRouteInfo(destName, customerName, dest, order.shipping_time, override)

    let cEntry = customerGroupMap.get(order.customer_id)
    if (!cEntry) {
      cEntry = {
        customerId: order.customer_id,
        customerName,
        customerColor: cust?.display_color ?? null,
        notesSet: new Set<string>(),
        routeSet: new Map(),
        destinationsMap: new Map(),
      }
      customerGroupMap.set(order.customer_id, cEntry)
    }

    cEntry.routeSet.set(routeInfo.title, routeInfo)

    // 特記事項（事前アクション喚起用メモ）の抽出：AI自動生成メタ情報は除外し、本当の伝達事項のみを残す
    const cleanOrderNote = extractActionableNote(order.note)
    if (cleanOrderNote) {
      cEntry.notesSet.add(cleanOrderNote)
    }
    const cleanLineNote = extractActionableNote(it.line_note)
    if (cleanLineNote) {
      cEntry.notesSet.add(cleanLineNote)
    }
    const deliveryNote = deliveryByKey.get(`${order.customer_id}:${order.destination_id ?? ''}`)?.note
    if (deliveryNote?.trim()) {
      cEntry.notesSet.add(deliveryNote.trim())
    }
    const customerDefaultNote = deliveryByKey.get(`${order.customer_id}:`)?.note
    if (customerDefaultNote?.trim()) {
      cEntry.notesSet.add(customerDefaultNote.trim())
    }

    const effectiveDepTime = override?.departureTime !== undefined && isClockTime(override.departureTime)
      ? override.departureTime
      : (isClockTime(dest?.departure_time) ? dest!.departure_time! : routeInfo.departureTime)

    const effectiveRouteName = override?.shippingRouteName !== undefined
      ? override.shippingRouteName
      : (dest?.shipping_route_name || (routeInfo.title !== '一般配送・時間未指定' ? routeInfo.title : null))

    const rule = ruleByPair.get(`${order.customer_id}:${it.product_id}`)
    const resolvedContainer =
      it.container_type || dest?.default_container_type || rule?.default_container_type || null

    const destKey = order.destination_id || `name:${destName}`
    let dEntry = cEntry.destinationsMap.get(destKey)
    if (!dEntry) {
      const delStatus =
        deliveryByKey.get(`${order.customer_id}:${order.destination_id ?? ''}`)?.status ??
        deliveryByKey.get(`${order.customer_id}:`)?.status ??
        'planned'
      dEntry = {
        destinationId: order.destination_id ?? null,
        destinationName: destName,
        shippingRouteName: effectiveRouteName,
        departureTime: effectiveDepTime,
        containerType: resolvedContainer,
        cases: 0,
        loose: 0,
        fractionBoxes: 0,
        totalBoxes: 0,
        totalQty: 0,
        items: [],
        status: delStatus,
      }
      cEntry.destinationsMap.set(destKey, dEntry)
    } else {
      if (!dEntry.containerType && resolvedContainer) {
        dEntry.containerType = resolvedContainer
      }
      if (override?.departureTime !== undefined && isClockTime(override.departureTime)) {
        dEntry.departureTime = override.departureTime
      } else if (!dEntry.departureTime && effectiveDepTime) {
        dEntry.departureTime = effectiveDepTime
      }
      if (override?.shippingRouteName !== undefined) {
        dEntry.shippingRouteName = override.shippingRouteName
      } else if (!dEntry.shippingRouteName && effectiveRouteName) {
        dEntry.shippingRouteName = effectiveRouteName
      }
    }

    // ケース数・端数換算（規格・明細ごとに独立して端数箱を計算し、異規格の端数が1箱に混ざるバグを防止）
    let perCase: number | null =
      rule?.packs_per_case ??
      (it.pack_config_id ? packById.get(it.pack_config_id)?.base ?? null : null)
    // 規格文字列に明示的な入数（例: "(入数30)", "10入"）がある場合はそちらを優先
    const combinedSpec = `${customerName} ${it.spec || ''}`.normalize('NFKC')
    const specMatch = combinedSpec.match(/(?:入数|1箱|1ケース)\s*(\d+)|(\d+)\s*(?:入|パック|P)/i)
    if (specMatch) {
      const parsedNum = Number(specMatch[1] || specMatch[2])
      if (Number.isFinite(parsedNum) && parsedNum > 0 && parsedNum <= 200) {
        perCase = parsedNum
      }
    }
    if (!perCase || perCase <= 0) {
      if (combinedSpec.includes('農業総合研究所') || combinedSpec.includes('NSK')) {
        perCase = 24
      } else {
        perCase = capacityById.get(it.product_id) ?? 20
      }
    }
    const safePerCase = perCase && perCase > 0 ? perCase : 20

    const itemCases = Math.floor(it.quantity / safePerCase)
    const itemLoose = it.quantity % safePerCase
    const itemFractionBox = itemLoose > 0 ? 1 : 0
    const itemTotalBoxes = itemCases + itemFractionBox

    dEntry.cases += itemCases
    dEntry.loose += itemLoose
    dEntry.fractionBoxes += itemFractionBox
    dEntry.totalBoxes += itemTotalBoxes
    dEntry.totalQty += it.quantity
    dEntry.items.push({
      id: it.id,
      productName: it.product_name,
      quantityText: formatQty(
        it.quantity,
        safePerCase,
        it.pack_config_id ? packById.get(it.pack_config_id) ?? null : null,
      ),
      unit: it.unit,
      quantity: it.quantity,
      fieldStatus: (it as { field_status?: string }).field_status ?? 'not_started',
      noteText: [it.spec, resolvedContainer, it.has_card ? 'カード有' : null, cleanLineNote || null].filter(Boolean).join('・') || '—',
    })
  }

  // 2. 取引先カード用オブジェクト配列の集計と整形
  const customerCards: (CustomerDeliveryCardProps & {
    earliestDepartureTime: string | null
  })[] = []

  for (const cEntry of customerGroupMap.values()) {
    const destinationsList = Array.from(cEntry.destinationsMap.values()).filter(
      (d) => d.totalQty > 0 || d.items.length > 0,
    )
    if (destinationsList.length === 0) continue

    let totalCases = 0
    let totalFractionBoxes = 0
    let totalFractionPacks = 0
    let totalQty = 0
    let grandTotalContainers = 0

    for (const d of destinationsList) {
      totalCases += d.cases
      totalFractionBoxes += d.fractionBoxes
      totalFractionPacks += d.loose
      totalQty += d.totalQty
      grandTotalContainers += d.totalBoxes
    }

    if (grandTotalContainers < totalCases) {
      grandTotalContainers = totalCases
    }

    // 取引先配下の全納品先が loaded または delivered なら完了
    const isCompleted =
      destinationsList.length > 0 &&
      destinationsList.every((d) => d.status === 'loaded' || d.status === 'delivered')

    // 出発時刻の最も早い便を特定（並び順用）
    const routes = Array.from(cEntry.routeSet.values())
    routes.sort((a, b) => {
      if (a.departureTime && b.departureTime) return a.departureTime.localeCompare(b.departureTime)
      if (a.departureTime && !b.departureTime) return -1
      if (!a.departureTime && b.departureTime) return 1
      return a.title.localeCompare(b.title, 'ja')
    })
    const earliestDepartureTime = routes.find((r) => r.departureTime)?.departureTime ?? null

    customerCards.push({
      customerId: cEntry.customerId,
      customerName: cEntry.customerName,
      customerColor: cEntry.customerColor,
      deliveryDate: date,
      totalCases,
      totalFractionBoxes,
      totalFractionPacks,
      grandTotalContainers,
      totalQty,
      notes: Array.from(cEntry.notesSet),
      isCompleted,
      destinations: destinationsList,
      routeSummaries: routes,
      earliestDepartureTime,
    })
  }

  // ソート：未積込を優先（出発時間の早い便順 → 取引先名順）、完了済みは末尾へ
  customerCards.sort((a, b) => {
    if (a.isCompleted !== b.isCompleted) return a.isCompleted ? 1 : -1
    if (a.earliestDepartureTime && b.earliestDepartureTime) {
      const cmp = a.earliestDepartureTime.localeCompare(b.earliestDepartureTime)
      if (cmp !== 0) return cmp
    } else if (a.earliestDepartureTime && !b.earliestDepartureTime) {
      return -1
    } else if (!a.earliestDepartureTime && b.earliestDepartureTime) {
      return 1
    }
    return a.customerName.localeCompare(b.customerName, 'ja')
  })

  const globalTotalCustomers = customerCards.length

  return (
    <div className="mx-auto max-w-2xl space-y-3.5 pb-10">
      {/* ① ナビゲーションバー（収穫・パックボードと完全に統一した順序） */}
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div className="flex items-center gap-2">
          <h1 className="font-display text-xl font-black text-ink">便別積込・配送リスト</h1>
          <FieldViewSwitch active="day" date={date} />
        </div>
        <div className="flex items-center gap-2">
          <DateNav date={date} basePath={PATH} />
        </div>
      </div>

      {/* ② 現場業務ナビゲーション（🥬 収穫・袋詰めボード ⇋ 🚚 便別積込・配送リスト） */}
      <div className="grid grid-cols-2 rounded-xl bg-bg-soft p-1 border border-line text-xs sm:text-sm font-bold shadow-xs print:hidden">
        <Link
          href={`/field/shipments?date=${date}`}
          className="flex items-center justify-center gap-1.5 rounded-lg py-2 text-ink-soft hover:text-ink hover:bg-white/60 transition"
        >
          🥬 収穫・袋詰めボード
        </Link>
        <span className="flex items-center justify-center gap-1.5 rounded-lg bg-forest-700 py-2 text-white shadow-xs">
          🚚 便別積込・配送リスト
        </span>
      </div>

      {/* 未承認データがある場合の控えめな通知バー */}
      {pendingReviewCount > 0 && (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-amber-300 bg-amber-50/90 px-3.5 py-2 text-xs font-bold text-amber-950 print:hidden">
          <span>⚠️ 未承認（要確認）の注文が {pendingReviewCount} 件あります（承認後にここへ表示されます）</span>
          <Link
            href="/admin/inbox"
            className="shrink-0 rounded-lg bg-amber-600 px-2.5 py-1 text-white hover:bg-amber-700 transition"
          >
            確認する →
          </Link>
        </div>
      )}

      {globalTotalCustomers === 0 ? (
        <EmptyState
          title="この日の配送はありません"
          description="承認済み注文の出荷日がこの日になると表示されます。"
        />
      ) : (
        <DeliveriesBoardView date={date} initialCards={customerCards} />
      )}
    </div>
  )
}
