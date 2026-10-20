import Link from 'next/link'
import { Truck, Clock, CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/cn'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getRouteOverrides } from '@/lib/field/destination-routes-store'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { DateNav } from '@/components/field/DateNav'
import {
  CustomerDeliveryCard,
  type CustomerDeliveryCardProps,
  type DestinationDetail,
} from '@/components/field/CustomerDeliveryCard'
import { formatQty } from '@/lib/calculations/format-qty'
import { jstTodayStr, formatJpDate } from '@/lib/dates'
import type { DeliveryStatus } from '@/types/database'

export const dynamic = 'force-dynamic'

const PATH = '/field/deliveries'

/**
 * 配送リスト（手書き伝票思想の「取引先ワンボックス集約」画面）。
 * - 最上位グルーピングを「取引先」に統一し、同一取引先が便ごとに分裂する問題を完全解消。
 * - 最優先情報として「総コンテナ（ケース）数 ＋ 端数」を特大フォントで配置。
 * - 事前アクション喚起型メモ（空コンテナ持参など）を見落とさない注意枠プレビュー。
 * - 指で押しやすい大きな「積込 OK」トグルボタンで一括チェック。
 * - 納品先・便ごとの個別内訳はアコーディオン内に格納（開くと端数の便が即座に判明）。
 */
export default async function DeliveriesPage({
  searchParams,
}: {
  searchParams: { date?: string }
}) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.date ?? '') ? searchParams.date! : jstTodayStr()
  const supabase = createClient()

  const admin = createAdminClient()

  // その日の出荷対象注文（キャンセルは除外）
  const { data: orders, error: ordersErr } = await supabase
    .from('orders')
    .select('id, customer_id, destination_id, status, note, shipping_time')
    .eq('delivery_date', date)
    .neq('status', 'cancelled')
  if (ordersErr) return <ErrorState message={ordersErr.message} />

  const orderIds = (orders ?? []).map((o) => o.id)
  const itemsRes = orderIds.length
    ? await supabase
        .from('order_items')
        .select('id, order_id, product_id, product_name, quantity, unit, spec, container_type, has_card, line_note, pack_config_id')
        .in('order_id', orderIds)
        .order('product_name')
    : null
  if (itemsRes?.error)
    return <ErrorState message="配送明細を読み込めませんでした。時間をおいて再度お試しください。" detail={itemsRes.error.message} />
  const items = itemsRes?.data ?? []

  // 表示用マスタ＋その日の配送チェック状態
  const customerIds = [...new Set((orders ?? []).map((o) => o.customer_id))]
  const destinationIds = [...new Set((orders ?? []).map((o) => o.destination_id).filter(Boolean))] as string[]
  const productIds = [...new Set(items.map((i) => i.product_id))]
  const packIds = [...new Set(items.map((i) => i.pack_config_id).filter(Boolean))] as string[]

  type DestRow = {
    id: string
    code: string | null
    full_name: string
    shipping_route_name?: string | null
    departure_time?: string | null
    pack_sort_order?: number | null
  }

  const [custRes, destRes, prodRes, packRes, deliveryRes, routeOverrides] = await Promise.all([
    customerIds.length
      ? supabase.from('customers').select('id, name, display_color').in('id', customerIds)
      : Promise.resolve({ data: [] as { id: string; name: string; display_color?: string | null }[], error: null }),
    (async (): Promise<{ data: DestRow[] | null; error: { message: string } | null }> => {
      if (!destinationIds.length) return { data: [], error: null }
      const r1 = await supabase
        .from('delivery_destinations')
        .select('id, code, full_name, shipping_route_name, departure_time, pack_sort_order')
        .in('id', destinationIds)
      if (!r1.error) return { data: (r1.data ?? []) as DestRow[], error: null }
      const r2 = await supabase
        .from('delivery_destinations')
        .select('id, code, full_name')
        .in('id', destinationIds)
      if (r2.error) return { data: null, error: r2.error }
      return { data: (r2.data ?? []) as DestRow[], error: null }
    })(),
    productIds.length
      ? supabase.from('products').select('id, container_capacity').in('id', productIds)
      : Promise.resolve({ data: [] as { id: string; container_capacity: number | null }[], error: null }),
    packIds.length
      ? supabase.from('pack_configs').select('id, base_per_selling, selling_unit_label').in('id', packIds)
      : Promise.resolve({ data: [] as { id: string; base_per_selling: number; selling_unit_label: string }[], error: null }),
    supabase.from('deliveries').select('id, customer_id, destination_id, status, photo_url, note').eq('delivery_date', date),
    getRouteOverrides(admin).catch(() => ({} as Record<string, import('@/lib/field/destination-routes-store').RouteOverride>)),
  ])

  if (custRes.error) return <ErrorState message="取引先名を読み込めませんでした。" detail={custRes.error.message} />
  if (destRes.error) return <ErrorState message="納入先を読み込めませんでした。" detail={destRes.error.message} />
  if (prodRes.error) return <ErrorState message="商品情報を読み込めませんでした。" detail={prodRes.error.message} />
  if (packRes.error) return <ErrorState message="荷姿情報を読み込めませんでした。" detail={packRes.error.message} />
  if (deliveryRes.error) return <ErrorState message="配送チェック状態を読み込めませんでした。" detail={deliveryRes.error.message} />

  const custById = new Map((custRes.data ?? []).map((c) => [c.id, c]))
  const destById = new Map((destRes.data ?? []).map((d) => [d.id, d]))
  const capacityById = new Map((prodRes.data ?? []).map((p) => [p.id, p.container_capacity]))
  const packById = new Map(
    (packRes.data ?? []).map((p) => [p.id, { base: Number(p.base_per_selling), unit: p.selling_unit_label }]),
  )
  const deliveryByKey = new Map(
    (deliveryRes.data ?? []).map((d) => [
      `${d.customer_id}:${d.destination_id ?? ''}`,
      { id: d.id, status: d.status as DeliveryStatus, photoUrl: d.photo_url, note: d.note },
    ]),
  )

  // AIやメモから納入先名を補完するヘルパー
  function extractDestName(note?: string | null, lineNote?: string | null): string | null {
    if (note) {
      const m1 = note.match(/(?:納入先|お届け先|配送先)(?:\(OCR\))?[:：\s]+([^\n,、・\]】]+)/)
      if (m1?.[1]) return m1[1].trim()
      const m2 = note.match(/【(?:納入先|お届け先|配送先)[:：\s]*([^】]+)】/)
      if (m2?.[1]) return m2[1].trim()
    }
    if (lineNote) {
      const m3 = lineNote.match(/納入先要確認\(([^)]+)\)/)
      if (m3?.[1]) return m3[1].trim()
    }
    return null
  }

  // 便（ルート・出発時刻）の自動解決ヘルパー
  function resolveRouteInfo(
    destName: string | null,
    customerName: string,
    dest?: DestRow | null,
    orderShippingTime?: string | null,
    override?: { departureTime: string | null; shippingRouteName: string | null } | null,
  ): { title: string; departureTime: string | null } {
    if (override) {
      const effectiveTime = override.departureTime
      const routeName = override.shippingRouteName || dest?.shipping_route_name || null
      if (routeName || effectiveTime) {
        const timePrefix = effectiveTime ? `${effectiveTime}発` : ''
        const routeSuffix = routeName ? ` ${routeName}` : ''
        return {
          title: `${timePrefix}${routeSuffix}`.trim(),
          departureTime: effectiveTime,
        }
      }
    }
    const effectiveTime = orderShippingTime || dest?.departure_time || null
    if (dest?.shipping_route_name || effectiveTime) {
      const timePrefix = effectiveTime ? `${effectiveTime}発` : ''
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
    return { title: '一般配送・時間未指定', departureTime: null }
  }

  // 1. 取引先（customer_id）を最上位キーとするデータ集約（便ごとに分断させない）
  const orderById = new Map((orders ?? []).map((o) => [o.id, o]))

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

    // 0026未適用環境でも確実に反映されるよう app_settings からの RouteOverride を最優先適用
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

    // ルート情報の記録（取引先が複数便にまたがる場合も全ルートを追跡）
    cEntry.routeSet.set(routeInfo.title, routeInfo)

    // 特記事項（事前アクション喚起用メモ）の抽出
    if (order.note && !order.note.startsWith('【納入先')) {
      const cleanNote = order.note.replace(/(?:納入先|お届け先|配送先)[^\n,、・\]】]+[\]】]?/g, '').trim()
      if (cleanNote) cEntry.notesSet.add(cleanNote)
    }
    if (it.line_note && (it.line_note.includes('持参') || it.line_note.includes('注意') || it.line_note.includes('便') || it.line_note.includes('コンテナ'))) {
      cEntry.notesSet.add(it.line_note.trim())
    }
    const deliveryNote = deliveryByKey.get(`${order.customer_id}:${order.destination_id ?? ''}`)?.note
    if (deliveryNote?.trim()) {
      cEntry.notesSet.add(deliveryNote.trim())
    }

    // 納品先マップへの追加（同一納品先が便やメモ違いで分裂しないよう、納品先IDまたは正規化名で1本化）
    const effectiveDepTime = override?.departureTime !== undefined
      ? override.departureTime
      : (order.shipping_time || dest?.departure_time || routeInfo.departureTime)

    const effectiveRouteName = override?.shippingRouteName !== undefined
      ? override.shippingRouteName
      : (dest?.shipping_route_name || (routeInfo.title !== '一般配送・時間未指定' ? routeInfo.title : null))

    const destKey = order.destination_id || `name:${destName}`
    let dEntry = cEntry.destinationsMap.get(destKey)
    if (!dEntry) {
      const delStatus = deliveryByKey.get(`${order.customer_id}:${order.destination_id ?? ''}`)?.status ?? 'planned'
      dEntry = {
        destinationId: order.destination_id ?? null,
        destinationName: destName,
        shippingRouteName: effectiveRouteName,
        departureTime: effectiveDepTime,
        containerType: it.container_type || null,
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
      if (!dEntry.containerType && it.container_type) {
        dEntry.containerType = it.container_type
      }
      if (override?.departureTime !== undefined) {
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

    // ケース数・端数換算
    const perCase: number = (it.pack_config_id ? packById.get(it.pack_config_id)?.base : null) || (capacityById.get(it.product_id) ?? 20) || 20
    const itemCases = Math.floor(it.quantity / perCase)
    const itemLoose = it.quantity % perCase

    dEntry.cases += itemCases
    dEntry.loose += itemLoose
    dEntry.totalQty += it.quantity
    dEntry.items.push({
      id: it.id,
      productName: it.product_name,
      quantityText: formatQty(
        it.quantity,
        capacityById.get(it.product_id) ?? null,
        it.pack_config_id ? packById.get(it.pack_config_id) ?? null : null,
      ),
      unit: it.unit,
      quantity: it.quantity,
      noteText: [it.spec, it.container_type, it.has_card ? 'カード有' : null, it.line_note].filter(Boolean).join('・') || '—',
    })
  }

  // 2. 取引先カード用オブジェクト配列の集計と整形
  const customerCards: (CustomerDeliveryCardProps & {
    earliestDepartureTime: string | null
  })[] = []

  for (const cEntry of customerGroupMap.values()) {
    const destinationsList = Array.from(cEntry.destinationsMap.values())

    let totalCases = 0
    let totalFractionBoxes = 0
    let totalFractionPacks = 0
    let totalQty = 0
    let grandTotalContainers = 0

    for (const d of destinationsList) {
      if (d.loose >= 20) {
        d.cases += Math.floor(d.loose / 20)
        d.loose %= 20
      }
      d.fractionBoxes = d.loose > 0 ? 1 : 0
      d.totalBoxes = d.cases + d.fractionBoxes

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
  const globalCompletedCustomers = customerCards.filter((c) => c.isCompleted).length
  const globalRemaining = globalTotalCustomers - globalCompletedCustomers

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      {/* 現場業務ナビゲーション（🥬 収穫・袋詰めボード ⇋ 🚚 便別積込・配送リスト） */}
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

      {/* ヘッダー */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 print:hidden">
        <h1 className="flex items-center gap-2 font-display text-xl sm:text-2xl font-bold text-ink">
          <Truck className="h-6 w-6 text-earth-600 shrink-0" aria-hidden />
          <span>便別積込・配送リスト</span>
        </h1>
        <div className="flex items-center justify-between sm:justify-end gap-2 w-full sm:w-auto">
          <DateNav date={date} basePath={PATH} />
        </div>
      </div>

      {globalTotalCustomers === 0 ? (
        <EmptyState
          title="この日の配送はありません"
          description="承認済み注文の出荷日がこの日になると表示されます。"
        />
      ) : (
        <>
          {/* 進捗表示（取引先集約進捗） */}
          <div className="flex items-center justify-between rounded-xl border border-earth-200 bg-earth-50 px-4 py-3 print:hidden">
            <span className="text-xs sm:text-sm font-bold text-ink-soft">
              本日の積込進捗（取引先集約）
            </span>
            <span className="text-ink-soft font-medium text-xs sm:text-sm flex items-center">
              完了 <span className="num text-2xl font-black tabular-nums text-earth-700 mx-1">{globalCompletedCustomers}</span>
              <span className="mx-1">/</span>
              {globalTotalCustomers} 取引先
              {globalRemaining > 0 ? (
                <span className="ml-2 rounded-full bg-amber-100 text-amber-800 border border-amber-300 px-2 py-0.5 text-xs font-black">
                  残り {globalRemaining}
                </span>
              ) : (
                <span className="ml-2 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300 px-2 py-0.5 text-xs font-black inline-flex items-center gap-0.5">
                  <CheckCircle2 className="h-3.5 w-3.5" /> 全積込完了
                </span>
              )}
            </span>
          </div>

          {/* 取引先ワンボックス集約カード一覧（和郷園等の同一取引先が1つのカードに集約） */}
          <div className="space-y-3.5">
            {customerCards.map((c) => (
              <CustomerDeliveryCard
                key={c.customerId}
                {...c}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}