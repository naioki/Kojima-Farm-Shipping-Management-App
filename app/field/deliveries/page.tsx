import { Truck } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { PrintButton } from '@/components/admin/PrintButton'
import { DateNav } from '@/components/field/DateNav'
import { DeliveryCheckCard, type DeliveryCheckItem } from '@/components/field/DeliveryCheckCard'
import { formatQty } from '@/lib/calculations/format-qty'
import { jstTodayStr } from '@/lib/dates'
import type { DeliveryStatus } from '@/types/database'

export const dynamic = 'force-dynamic'

const PATH = '/field/deliveries'

interface DeliveryGroup {
  key: string
  customerId: string
  destinationId: string | null
  customerName: string
  destinationName: string | null
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
    .select('id, customer_id, destination_id, status')
    .eq('delivery_date', date)
    .neq('status', 'cancelled')
  if (ordersErr) return <ErrorState message={ordersErr.message} />

  const orderIds = (orders ?? []).map((o) => o.id)
  const items = orderIds.length
    ? (
        await supabase
          .from('order_items')
          .select('id, order_id, product_id, product_name, quantity, unit, spec, container_type, has_card, line_note, pack_config_id')
          .in('order_id', orderIds)
          .order('product_name')
      ).data ?? []
    : []

  // 表示用マスタ（表示は常に「取引先＞納入先」）＋その日の配送チェック状態
  const customerIds = [...new Set((orders ?? []).map((o) => o.customer_id))]
  const destinationIds = [...new Set((orders ?? []).map((o) => o.destination_id).filter(Boolean))] as string[]
  const productIds = [...new Set(items.map((i) => i.product_id))]
  const packIds = [...new Set(items.map((i) => i.pack_config_id).filter(Boolean))] as string[]
  const [{ data: custRows }, { data: destRows }, { data: prodRows }, { data: packRows }, { data: deliveryRows }] =
    await Promise.all([
      customerIds.length
        ? supabase.from('customers').select('id, name').in('id', customerIds)
        : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      destinationIds.length
        ? supabase.from('delivery_destinations').select('id, code, full_name').in('id', destinationIds)
        : Promise.resolve({ data: [] as { id: string; code: string | null; full_name: string }[] }),
      productIds.length
        ? supabase.from('products').select('id, container_capacity').in('id', productIds)
        : Promise.resolve({ data: [] as { id: string; container_capacity: number | null }[] }),
      packIds.length
        ? supabase.from('pack_configs').select('id, base_per_selling, selling_unit_label').in('id', packIds)
        : Promise.resolve({ data: [] as { id: string; base_per_selling: number; selling_unit_label: string }[] }),
      supabase.from('deliveries').select('id, customer_id, destination_id, status, photo_url').eq('delivery_date', date),
    ])
  const customerName = new Map((custRows ?? []).map((c) => [c.id, c.name]))
  const destinationName = new Map((destRows ?? []).map((d) => [d.id, d.code || d.full_name]))
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

  // 配送単位（取引先×納入先）にグルーピング。deliveries テーブルと同じキー設計（migrations/0015）。
  const orderById = new Map((orders ?? []).map((o) => [o.id, o]))
  const groups = new Map<string, DeliveryGroup>()
  for (const it of items) {
    const order = orderById.get(it.order_id)
    if (!order) continue
    const key = `${order.customer_id}:${order.destination_id ?? ''}`
    let g = groups.get(key)
    if (!g) {
      g = {
        key,
        customerId: order.customer_id,
        destinationId: order.destination_id ?? null,
        customerName: customerName.get(order.customer_id) ?? '—',
        destinationName: order.destination_id ? destinationName.get(order.destination_id) ?? null : null,
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
  const sorted = [...groups.values()].sort((a, b) =>
    `${a.customerName}${a.destinationName ?? ''}`.localeCompare(`${b.customerName}${b.destinationName ?? ''}`, 'ja'),
  )
  const totalItems = items.length
  const doneCount = sorted.filter((g) => deliveryByKey.get(g.key)?.status === 'delivered').length

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <h1 className="flex items-center gap-2 font-display text-2xl font-bold text-ink">
          <Truck className="h-6 w-6 text-earth-600" aria-hidden />
          配送リスト
        </h1>
        <div className="flex items-center gap-2">
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
          {/* のこり表示（出荷一覧と同じやさしい日本語） */}
          <div className="flex items-center justify-between rounded-xl border border-earth-200 bg-earth-50 px-4 py-3 print:hidden">
            <span className="text-sm font-medium text-ink-soft">きょうの 配送</span>
            <span className="text-ink-soft">
              おわり <span className="num text-2xl font-bold tabular-nums text-earth-700">{doneCount}</span>
              <span className="mx-1">/</span>
              {sorted.length} 件
            </span>
          </div>

          {/* 印刷帳票ヘッダー（印刷時のみ） */}
          <div className="hidden print:block">
            <h1 className="text-xl font-bold">配送一覧　{date}</h1>
            <p className="mt-1 text-sm">
              配送先 {sorted.length} 件 ／ 明細 {totalItems} 行　　確認者：＿＿＿＿＿＿＿＿
            </p>
          </div>

          <div className="space-y-4">
            {sorted.map((g) => (
              <DeliveryCheckCard
                key={g.key}
                status={deliveryByKey.get(g.key)?.status ?? 'planned'}
                customerName={g.customerName}
                destinationName={g.destinationName}
                items={g.items}
                deliveryDate={date}
                customerId={g.customerId}
                destinationId={g.destinationId}
                deliveryId={deliveryByKey.get(g.key)?.id ?? null}
                hasPhoto={Boolean(deliveryByKey.get(g.key)?.photoUrl)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
