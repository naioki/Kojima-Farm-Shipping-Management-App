import Decimal from 'decimal.js'
import { createClient } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { decomposeByContainer } from '@/lib/calculations/parse-quantity'
import type { FieldStatus } from '@/types/database'
import { ShipmentStatusSummary } from '@/components/field/ShipmentStatusSummary'
import { ShipmentRow } from '@/components/field/ShipmentRow'
import { ShipmentAddForm } from '@/components/field/ShipmentAddForm'
import { DateNav } from '@/components/field/DateNav'

export const dynamic = 'force-dynamic'

const PATH = '/field/shipments'
const todayStr = () => new Date().toISOString().slice(0, 10)

/** 総数を「総数 / ケース表記」に整形（products.container_capacity で分解） */
function formatQty(quantity: number, capacity: number | null): string {
  const total = new Decimal(quantity)
  const b = decomposeByContainer(total, capacity)
  if (!b) return total.toString()
  return `${total.toString()} / ${b.containers}c${b.remainder.toString()}`
}

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
    .select('id, customer_id')
    .eq('delivery_date', date)
  if (ordersErr) return <ErrorState message={ordersErr.message} />

  const orderIds = (orders ?? []).map((o) => o.id)
  const orderToCustomer = new Map((orders ?? []).map((o) => [o.id, o.customer_id]))

  // ② 明細（出荷対象）
  const items = orderIds.length
    ? (
        await supabase
          .from('order_items')
          .select('id, order_id, product_id, product_name, quantity, unit, field_status, version, spec, container_type, has_card, line_note')
          .in('order_id', orderIds)
          .order('product_name')
      ).data ?? []
    : []

  // ③ 取引先名・商品の荷姿容量（表示用）
  const customerIds = [...new Set((orders ?? []).map((o) => o.customer_id))]
  const productIds = [...new Set(items.map((i) => i.product_id))]
  const [{ data: custRows }, { data: prodRows }] = await Promise.all([
    customerIds.length
      ? supabase.from('customers').select('id, name').in('id', customerIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    productIds.length
      ? supabase.from('products').select('id, container_capacity').in('id', productIds)
      : Promise.resolve({ data: [] as { id: string; container_capacity: number | null }[] }),
  ])
  const customerName = new Map((custRows ?? []).map((c) => [c.id, c.name]))
  const capacityById = new Map((prodRows ?? []).map((p) => [p.id, p.container_capacity]))

  // ステータス集計
  const counts: Record<FieldStatus, number> = { not_started: 0, packed: 0, shipped: 0 }
  for (const it of items) counts[it.field_status as FieldStatus]++

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

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-bold text-ink">出荷一覧</h1>
        <DateNav date={date} basePath={PATH} />
      </div>

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
              {rows.map((it) => (
                <ShipmentRow
                  key={it.id}
                  itemId={it.id}
                  customerName={customerName.get(orderToCustomer.get(it.order_id) ?? '') ?? '—'}
                  quantityText={formatQty(it.quantity, capacityById.get(it.product_id) ?? null)}
                  initialStatus={it.field_status}
                  initialVersion={it.version}
                  initialSpec={it.spec}
                  initialContainer={it.container_type}
                  initialHasCard={it.has_card}
                  initialLineNote={it.line_note}
                />
              ))}
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
