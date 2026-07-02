import { CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/cn'
import { createClient } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { formatQty } from '@/lib/calculations/format-qty'
import { ShipmentStatusSummary } from '@/components/field/ShipmentStatusSummary'
import { ShipmentGroupRows } from '@/components/field/ShipmentGroupRows'
import { ShipmentAddForm } from '@/components/field/ShipmentAddForm'
import { DateNav } from '@/components/field/DateNav'
import { FieldViewSwitch } from '@/components/field/FieldViewSwitch'
import type { SpecWarning } from '@/types/database'

export const dynamic = 'force-dynamic'

const PATH = '/field/shipments'
const todayStr = () => new Date().toISOString().slice(0, 10)

/**
 * 出荷一覧（Laravel版 画面2）。現場が毎日使うメイン画面。
 *   - 上部にステータスサマリー（その日の進捗を色分け）
 *   - 品目ごとにグループ化
 *   - 金額は非表示（品目と数量に集中・Laravel版の意図）
 *   - 日付切替・スマート追加・◀▶ ステータス変更
 */
export default async function ShipmentsPage({
  searchParams,
}: {
  searchParams: { date?: string }
}) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.date ?? '') ? searchParams.date! : todayStr()
  const supabase = createClient()

  // ① その日の出荷日を持つ注文（型安全のため埋め込みを使わず段階取得）
  const { data: orders, error: ordersErr } = await supabase
    .from('orders')
    .select('id, customer_id, destination_id')
    .eq('delivery_date', date)
  if (ordersErr) return <ErrorState message={ordersErr.message} />

  const orderIds = (orders ?? []).map((o) => o.id)
  const orderToCustomer = new Map((orders ?? []).map((o) => [o.id, o.customer_id]))
  const orderToDestination = new Map((orders ?? []).map((o) => [o.id, o.destination_id]))

  // ② 明細（出荷対象）— spec_warnings も取得して常時表示
  const items = orderIds.length
    ? (
        await supabase
          .from('order_items')
          .select('id, order_id, product_id, product_name, quantity, unit, field_status, version, spec, container_type, has_card, line_note, shipped_qty, field_note, spec_warnings, pack_config_id')
          .in('order_id', orderIds)
          .order('product_name')
      ).data ?? []
    : []

  // ③ 取引先名・識別色・商品の荷姿容量・納入先名（表示用。表示は常に「取引先＞納入先」）
  const customerIds = [...new Set((orders ?? []).map((o) => o.customer_id))]
  const productIds = [...new Set(items.map((i) => i.product_id))]
  const destinationIds = [...new Set((orders ?? []).map((o) => o.destination_id).filter(Boolean))] as string[]
  const [{ data: custRows }, { data: prodRows }, { data: destRows }] = await Promise.all([
    customerIds.length
      ? supabase.from('customers').select('id, name, display_color').in('id', customerIds)
      : Promise.resolve({ data: [] as { id: string; name: string; display_color: string | null }[] }),
    productIds.length
      ? supabase.from('products').select('id, container_capacity').in('id', productIds)
      : Promise.resolve({ data: [] as { id: string; container_capacity: number | null }[] }),
    destinationIds.length
      ? supabase.from('delivery_destinations').select('id, code, full_name').in('id', destinationIds)
      : Promise.resolve({ data: [] as { id: string; code: string | null; full_name: string }[] }),
  ])
  const customerName = new Map((custRows ?? []).map((c) => [c.id, c.name]))
  const customerColor = new Map((custRows ?? []).map((c) => [c.id, c.display_color]))
  const capacityById = new Map((prodRows ?? []).map((p) => [p.id, p.container_capacity]))
  const destinationName = new Map((destRows ?? []).map((d) => [d.id, d.code || d.full_name]))

  // 荷姿（明細に紐づく pack_config）を取得して表示に使う
  const packIds = [...new Set(items.map((i) => i.pack_config_id).filter(Boolean))] as string[]
  const { data: packRows } = packIds.length
    ? await supabase.from('pack_configs').select('id, base_per_selling, selling_unit_label').in('id', packIds)
    : { data: [] as { id: string; base_per_selling: number; selling_unit_label: string }[] }
  const packById = new Map(
    (packRows ?? []).map((p) => [p.id, { base: Number(p.base_per_selling), unit: p.selling_unit_label }]),
  )

  // ステータス集計（中断＝できた数が受注未満で未出荷。梱包完了とは別バケツで数える）
  const counts = { not_started: 0, interrupted: 0, packed: 0, shipped: 0 }
  for (const it of items) {
    const partial = it.shipped_qty != null && it.shipped_qty < it.quantity
    if (it.field_status === 'shipped') counts.shipped++
    else if (partial) counts.interrupted++
    else if (it.field_status === 'packed') counts.packed++
    else counts.not_started++
  }

  // 品目ごとにグループ化
  const groups = new Map<string, typeof items>()
  for (const it of items) {
    const arr = groups.get(it.product_name) ?? []
    arr.push(it)
    groups.set(it.product_name, arr)
  }

  // 追加フォーム用マスタ
  const [{ data: allCustomers }, { data: allProducts }, { data: rules }] = await Promise.all([
    supabase.from('customers').select('id, name').eq('is_active', true).order('name'),
    supabase.from('products').select('id, name, unit').eq('is_active', true).order('name'),
    supabase.from('customer_product_rules').select('customer_id, product_id, packs_per_case'),
  ])
  const packsByPair: Record<string, number | null> = {}
  for (const r of rules ?? []) packsByPair[`${r.customer_id}:${r.product_id}`] = r.packs_per_case

  // 「のこり」= まだ出荷していない件数（未着手＋中断＋梱包完了）。現場が今やることの数。
  const remaining = counts.not_started + counts.interrupted + counts.packed
  const allDone = items.length > 0 && remaining === 0

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="font-display text-2xl font-bold text-ink">出荷一覧</h1>
          <FieldViewSwitch active="day" date={date} />
        </div>
        <DateNav date={date} basePath={PATH} />
      </div>

      {/* やさしい日本語の「のこり」表示。今やることの数を一目で。 */}
      {items.length > 0 && (
        <div
          className={cn(
            'flex items-center justify-between rounded-xl border px-4 py-3',
            allDone ? 'border-harvest-200 bg-harvest-50' : 'border-earth-200 bg-earth-50',
          )}
        >
          <span className="text-sm font-medium text-ink-soft">きょう やること</span>
          {allDone ? (
            <span className="flex items-center gap-1.5 text-base font-bold text-harvest-700">
              <CheckCircle2 className="h-5 w-5" aria-hidden />
              ぜんぶ おわり
            </span>
          ) : (
            <span className="text-ink-soft">
              のこり <span className="num text-2xl font-bold tabular-nums text-earth-700">{remaining}</span> 件
            </span>
          )}
        </div>
      )}

      <ShipmentStatusSummary counts={counts} />

      <ShipmentAddForm
        deliveryDate={date}
        customers={(allCustomers ?? []).map((c) => ({ id: c.id, name: c.name }))}
        products={(allProducts ?? []).map((p) => ({ id: p.id, name: p.name, unit: p.unit }))}
        packsByPair={packsByPair}
      />

      {items.length === 0 ? (
        <EmptyState
          title="この日の出荷対象はありません"
          description="上の「スマート追加」で追加するか、承認済み注文の出荷日がこの日になると表示されます。"
        />
      ) : (
        <div className="space-y-4">
          {[...groups.entries()].map(([productName, rows]) => (
            <Card key={productName} className="space-y-2">
              <h2 className="font-display text-base font-bold text-ink">
                {productName}
                <span className="ml-2 text-sm font-normal text-ink-soft">{rows.length}件</span>
              </h2>
              <ShipmentGroupRows
                rows={rows.map((it) => {
                  const custId = orderToCustomer.get(it.order_id) ?? ''
                  const destId = orderToDestination.get(it.order_id)
                  return {
                    itemId: it.id,
                    customerName: customerName.get(custId) ?? '—',
                    customerColor: customerColor.get(custId) ?? null,
                    destinationName: destId ? destinationName.get(destId) ?? null : null,
                    quantityText: formatQty(
                      it.quantity,
                      capacityById.get(it.product_id) ?? null,
                      it.pack_config_id ? packById.get(it.pack_config_id) ?? null : null,
                    ),
                    orderedQty: it.quantity,
                    initialStatus: it.field_status,
                    initialVersion: it.version,
                    initialSpec: it.spec,
                    initialContainer: it.container_type,
                    initialHasCard: it.has_card,
                    initialLineNote: it.line_note,
                    initialShippedQty: it.shipped_qty,
                    initialFieldNote: it.field_note,
                    specWarnings: (it.spec_warnings as SpecWarning[] | null),
                  }
                })}
              />
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
