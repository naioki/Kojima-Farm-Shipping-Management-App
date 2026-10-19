import Link from 'next/link'
import { Truck, Clock, CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/cn'
import { createClient } from '@/lib/supabase/server'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { PrintButton } from '@/components/admin/PrintButton'
import { DateNav } from '@/components/field/DateNav'
import { DeliveryCheckCard, type DeliveryCheckItem } from '@/components/field/DeliveryCheckCard'
import { formatQty } from '@/lib/calculations/format-qty'
import { jstTodayStr, formatJpDate } from '@/lib/dates'
import type { DeliveryStatus } from '@/types/database'

export const dynamic = 'force-dynamic'

const PATH = '/field/deliveries'

interface DeliveryGroup {
  key: string
  customerId: string
  destinationId: string | null
  customerName: string
  destinationName: string | null
  shippingRouteName: string | null
  departureTime: string | null
  packSortOrder: number
  items: DeliveryCheckItem[]
}

/**
 * 配送リスト（設計提案 Phase 0-1）。その日の注文を「取引先＞納入先」＝配送単位でまとめ、
 * 出発前ダブルチェック（1行ずつタップ→積込OK→納品完了）を記録する。
 * 印刷すると紙の配送一覧（チェック欄付き）になる（並行運用期は紙が正・アプリは紙の生成元）。
 * スタッフ・管理者どちらも使う（認証は field レイアウトが担う）。
 */
export default async function DeliveriesPage({
  searchParams,
}: {
  searchParams: { date?: string }
}) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.date ?? '') ? searchParams.date! : jstTodayStr()
  const supabase = createClient()

  // その日の出荷対象注文（キャンセルは除外）
  const { data: orders, error: ordersErr } = await supabase
    .from('orders')
    .select('id, customer_id, destination_id, status, note')
    .eq('delivery_date', date)
    .neq('status', 'cancelled')
  if (ordersErr) return <ErrorState message={ordersErr.message} />

  const orderIds = (orders ?? []).map((o) => o.id)
  // ★取得失敗を「この日の配送はありません」に化けさせない。出発前ダブルチェックの
  //   対象が空で出ると、積み忘れたまま出発してしまう。必ずエラーとして見せる。
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

  // 表示用マスタ（表示は常に「取引先＞納入先」）＋その日の配送チェック状態
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

  // ★納入先マスタ取得（0026 未適用環境への安全なフォールバック付き）
  const [custRes, destRes, prodRes, packRes, deliveryRes] = await Promise.all([
    customerIds.length
      ? supabase.from('customers').select('id, name').in('id', customerIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[], error: null }),
    (async (): Promise<{ data: DestRow[] | null; error: { message: string } | null }> => {
      if (!destinationIds.length) return { data: [], error: null }
      const r1 = await supabase
        .from('delivery_destinations')
        .select('id, code, full_name, shipping_route_name, departure_time, pack_sort_order')
        .in('id', destinationIds)
      if (!r1.error) return { data: (r1.data ?? []) as DestRow[], error: null }
      // 0026 未適用DBへのフォールバック
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
    supabase.from('deliveries').select('id, customer_id, destination_id, status, photo_url').eq('delivery_date', date),
  ])
  if (custRes.error)
    return <ErrorState message="取引先名を読み込めませんでした。時間をおいて再度お試しください。" detail={custRes.error.message} />
  if (destRes.error)
    return <ErrorState message="納入先を読み込めませんでした。時間をおいて再度お試しください。" detail={destRes.error.message} />
  if (prodRes.error)
    return <ErrorState message="商品情報を読み込めませんでした。時間をおいて再度お試しください。" detail={prodRes.error.message} />
  if (packRes.error)
    return <ErrorState message="荷姿情報を読み込めませんでした。時間をおいて再度お試しください。" detail={packRes.error.message} />
  if (deliveryRes.error)
    return <ErrorState message="配送チェックの状態を読み込めませんでした。時間をおいて再度お試しください。" detail={deliveryRes.error.message} />
  const { data: custRows } = custRes
  const { data: destRows } = destRes
  const { data: prodRows } = prodRes
  const { data: packRows } = packRes
  const { data: deliveryRows } = deliveryRes
  const customerName = new Map((custRows ?? []).map((c) => [c.id, c.name]))
  const destById = new Map((destRows ?? []).map((d) => [d.id, d]))
  const capacityById = new Map((prodRows ?? []).map((p) => [p.id, p.container_capacity]))
  const packById = new Map(
    (packRows ?? []).map((p) => [p.id, { base: Number(p.base_per_selling), unit: p.selling_unit_label }]),
  )
  const deliveryByKey = new Map(
    (deliveryRows ?? []).map((d) => [
      `${d.customer_id}:${d.destination_id ?? ''}`,
      { id: d.id, status: d.status as DeliveryStatus, photoUrl: d.photo_url },
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

  // 配送単位（取引先×納入先）にグルーピング。deliveries テーブルと同じキー設計（migrations/0015）。
  const orderById = new Map((orders ?? []).map((o) => [o.id, o]))
  const groups = new Map<string, DeliveryGroup>()
  for (const it of items) {
    const order = orderById.get(it.order_id)
    if (!order) continue
    const key = `${order.customer_id}:${order.destination_id ?? ''}`
    let g = groups.get(key)
    if (!g) {
      const dest = order.destination_id ? destById.get(order.destination_id) : null
      const resolvedDestName =
        dest ? dest.code || dest.full_name : extractDestName(order.note, it.line_note)
      g = {
        key,
        customerId: order.customer_id,
        destinationId: order.destination_id ?? null,
        customerName: customerName.get(order.customer_id) ?? '—',
        destinationName: resolvedDestName,
        shippingRouteName: dest?.shipping_route_name ?? null,
        departureTime: dest?.departure_time ?? null,
        packSortOrder: dest?.pack_sort_order ?? 100,
        items: [],
      }
      groups.set(key, g)
    }
    g.items.push({
      id: it.id,
      productName: it.product_name,
      quantityText: formatQty(
        it.quantity,
        capacityById.get(it.product_id) ?? null,
        it.pack_config_id ? packById.get(it.pack_config_id) ?? null : null,
      ),
      unit: it.unit,
      quantity: it.quantity,
      noteText:
        [it.spec, it.container_type, it.has_card ? 'カード有' : null, it.line_note].filter(Boolean).join('・') || '—',
    })
  }

  // 便（ルート・出発時刻）ごとのグループ化（納入先名からの自動推測付き）
  interface RouteGroup {
    key: string
    title: string
    departureTime: string | null
    groups: DeliveryGroup[]
    totalLines: number
    deliveredCount: number
    isDone: boolean
  }

  function resolveRouteInfo(g: DeliveryGroup): { title: string; departureTime: string | null } {
    if (g.shippingRouteName || g.departureTime) {
      const timePrefix = g.departureTime ? `${g.departureTime}発` : ''
      const routeSuffix = g.shippingRouteName ? ` ${g.shippingRouteName}` : ''
      return {
        title: `${timePrefix}${routeSuffix}`.trim(),
        departureTime: g.departureTime,
      }
    }
    const d = g.destinationName ?? ''
    const c = g.customerName ?? ''
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

  const routeMap = new Map<string, RouteGroup>()
  for (const g of groups.values()) {
    const routeInfo = resolveRouteInfo(g)
    const routeKey = routeInfo.title

    let rg = routeMap.get(routeKey)
    if (!rg) {
      rg = {
        key: routeKey,
        title: routeInfo.title,
        departureTime: routeInfo.departureTime,
        groups: [],
        totalLines: 0,
        deliveredCount: 0,
        isDone: false,
      }
      routeMap.set(routeKey, rg)
    }
    rg.groups.push(g)
    rg.totalLines += g.items.length
    if (deliveryByKey.get(g.key)?.status === 'delivered') {
      rg.deliveredCount += 1
    }
  }

  // 便内・便自体の並び替え
  for (const rg of routeMap.values()) {
    rg.groups.sort((a, b) => {
      if (a.packSortOrder !== b.packSortOrder) {
        return a.packSortOrder - b.packSortOrder
      }
      return `${a.customerName}${a.destinationName ?? ''}`.localeCompare(
        `${b.customerName}${b.destinationName ?? ''}`,
        'ja',
      )
    })
    rg.isDone = rg.deliveredCount === rg.groups.length
  }

  const sortedRoutes = Array.from(routeMap.values()).sort((a, b) => {
    const isUnscheduledA = a.key.includes('時間未指定')
    const isUnscheduledB = b.key.includes('時間未指定')
    if (isUnscheduledA && !isUnscheduledB) return 1
    if (!isUnscheduledA && isUnscheduledB) return -1
    if (a.departureTime && b.departureTime) {
      return a.departureTime.localeCompare(b.departureTime)
    }
    if (a.departureTime && !b.departureTime) return -1
    if (!a.departureTime && b.departureTime) return 1
    return a.title.localeCompare(b.title, 'ja')
  })

  const sorted = [...groups.values()]
  const totalItems = items.length
  const doneCount = sorted.filter((g) => deliveryByKey.get(g.key)?.status === 'delivered').length

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      {/* 現場業務ナビゲーション（🥬 収穫・袋詰めボード ⇋ 🚚 全品目便別積込・配送） */}
      <div className="flex items-center justify-between rounded-xl bg-bg-soft p-1 border border-line text-xs font-bold print:hidden">
        <div className="flex items-center gap-1">
          <Link
            href={`/field/shipments?date=${date}`}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-ink-soft hover:text-ink hover:bg-white/60 transition"
          >
            🥬 収穫・袋詰めボード
          </Link>
          <span className="flex items-center gap-1.5 rounded-lg bg-earth-700 px-3 py-1.5 text-white shadow-xs">
            🚚 便別積込・配送リスト
          </span>
        </div>
        <Link
          href={`/field/shipments?date=${date}`}
          className="text-[11px] text-ink-muted hover:text-earth-800 pr-2 transition"
        >
          品目別（収穫計算・袋詰め）へ →
        </Link>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 print:hidden">
        <h1 className="flex items-center gap-2 font-display text-xl sm:text-2xl font-bold text-ink">
          <Truck className="h-6 w-6 text-earth-600 shrink-0" aria-hidden />
          <span>便別積込・配送リスト</span>
        </h1>
        <div className="flex items-center justify-between sm:justify-end gap-2 w-full sm:w-auto">
          <DateNav date={date} basePath={PATH} />
          {sorted.length > 0 && <PrintButton label="印刷" />}
        </div>
      </div>

      {sorted.length === 0 ? (
        <EmptyState
          title="この日の配送はありません"
          description="承認済み注文の出荷日がこの日になると表示されます。"
        />
      ) : (
        <>
          {/* のこり表示（全品目便別のやさしい日本語） */}
          <div className="flex items-center justify-between rounded-xl border border-earth-200 bg-earth-50 px-4 py-3 print:hidden">
            <span className="text-sm font-medium text-ink-soft">きょうの 配送（全品目横断）</span>
            <span className="text-ink-soft">
              おわり <span className="num text-2xl font-bold tabular-nums text-earth-700">{doneCount}</span>
              <span className="mx-1">/</span>
              {sorted.length} 配送先
              <span className="ml-2 text-xs text-ink-muted">（全 {sortedRoutes.length} 便）</span>
            </span>
          </div>

          {/* 印刷帳票ヘッダー（印刷時のみ） */}
          <div className="hidden print:block">
            <h1 className="text-xl font-bold">便別配送一覧　{formatJpDate(date)}</h1>
            <p className="mt-1 text-sm">
              配送先 {sorted.length} 件 ／ 全 {sortedRoutes.length} 便 ／ 明細 {totalItems} 行　　確認者：＿＿＿＿＿＿＿＿
            </p>
          </div>

          {/* 便別（ルート・出発時刻）グループ一覧 */}
          <div className="space-y-6">
            {sortedRoutes.map((rg) => (
              <div
                key={rg.key}
                className={cn(
                  'rounded-2xl border p-4 shadow-sm space-y-3.5 transition-all',
                  rg.isDone
                    ? 'border-emerald-200 bg-emerald-50/20'
                    : 'border-earth-300 bg-white border-l-4 border-l-earth-600 shadow-md',
                )}
              >
                {/* 便ヘッダー */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line/60 pb-2.5">
                  <div className="flex items-center gap-2">
                    <span className="flex items-center gap-1.5 rounded-lg bg-earth-100 px-2.5 py-1 text-xs font-black text-earth-900">
                      <Clock className="h-3.5 w-3.5 text-earth-700" />
                      {rg.title}
                    </span>
                    <span className="text-xs font-bold text-ink-soft">
                      ({rg.groups.length} 配送先 / {rg.totalLines} 品目明細)
                    </span>
                  </div>

                  {rg.isDone ? (
                    <span className="inline-flex items-center gap-1 rounded-md bg-emerald-100 px-2.5 py-0.5 text-xs font-black text-emerald-800">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" /> 積込・配送完了
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-md border border-earth-300 bg-earth-50 px-2.5 py-0.5 text-xs font-bold text-earth-800">
                      残り {rg.groups.length - rg.deliveredCount} 配送先
                    </span>
                  )}
                </div>

                {/* 帳票印刷用ルート見出し */}
                <div className="hidden print:block pt-1 pb-1">
                  <h2 className="text-sm font-bold text-ink">【便】 {rg.title}（{rg.groups.length}件）</h2>
                </div>

                {/* この便に含まれる配送カード一覧 */}
                <div className="space-y-3">
                  {rg.groups.map((g) => (
                    <DeliveryCheckCard
                      key={g.key}
                      status={deliveryByKey.get(g.key)?.status ?? 'planned'}
                      customerName={g.customerName}
                      destinationName={g.destinationName}
                      departureTime={g.departureTime}
                      shippingRouteName={g.shippingRouteName}
                      items={g.items}
                      deliveryDate={date}
                      customerId={g.customerId}
                      destinationId={g.destinationId}
                      deliveryId={deliveryByKey.get(g.key)?.id ?? null}
                      hasPhoto={Boolean(deliveryByKey.get(g.key)?.photoUrl)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
