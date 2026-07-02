import { Truck } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { PrintButton } from '@/components/admin/PrintButton'
import { DateNav } from '@/components/field/DateNav'
import { formatQty } from '@/lib/calculations/format-qty'
import { requireAdmin } from '@/lib/auth/require-admin'

export const dynamic = 'force-dynamic'

const PATH = '/admin/deliveries'
const todayStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

interface DeliveryGroup {
  key: string
  customerName: string
  destinationName: string | null
  items: {
    id: string
    productName: string
    quantityText: string
    unit: string
    spec: string | null
    containerType: string | null
    hasCard: boolean | null
    lineNote: string | null
  }[]
}

/**
 * 配送リスト（設計提案 Phase 0）。その日の承認済み注文を「取引先＞納入先」＝配送単位で
 * まとめ、印刷して紙の配送一覧として使う（並行運用期は紙が正・アプリは紙の生成元）。
 * チェック欄（積込・納品）は紙上で✓する。デジタルでのチェック操作は Phase 1（deliveries行の生成と状態遷移）。
 */
export default async function DeliveriesPage({
  searchParams,
}: {
  searchParams: { date?: string }
}) {
  const guard = await requireAdmin('配送リストは管理者のみです。')
  if (guard) return guard

  const date = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.date ?? '') ? searchParams.date! : todayStr()
  const supabase = createClient()

  // その日の出荷対象注文（キャンセルは除外。承認前も現物準備の参考に載せ、印には状態を明記）
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

  // 表示用マスタ（表示は常に「取引先＞納入先」）
  const customerIds = [...new Set((orders ?? []).map((o) => o.customer_id))]
  const destinationIds = [...new Set((orders ?? []).map((o) => o.destination_id).filter(Boolean))] as string[]
  const productIds = [...new Set(items.map((i) => i.product_id))]
  const packIds = [...new Set(items.map((i) => i.pack_config_id).filter(Boolean))] as string[]
  const [{ data: custRows }, { data: destRows }, { data: prodRows }, { data: packRows }] = await Promise.all([
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
  ])
  const customerName = new Map((custRows ?? []).map((c) => [c.id, c.name]))
  const destinationName = new Map((destRows ?? []).map((d) => [d.id, d.code || d.full_name]))
  const capacityById = new Map((prodRows ?? []).map((p) => [p.id, p.container_capacity]))
  const packById = new Map(
    (packRows ?? []).map((p) => [p.id, { base: Number(p.base_per_selling), unit: p.selling_unit_label }]),
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
      spec: it.spec,
      containerType: it.container_type,
      hasCard: it.has_card,
      lineNote: it.line_note,
    })
  }
  const sorted = [...groups.values()].sort((a, b) =>
    `${a.customerName}${a.destinationName ?? ''}`.localeCompare(`${b.customerName}${b.destinationName ?? ''}`, 'ja'),
  )
  const totalItems = items.length

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <h1 className="flex items-center gap-2 font-display text-2xl font-bold text-ink">
          <Truck className="h-6 w-6 text-earth-600" aria-hidden />
          配送リスト
        </h1>
        <div className="flex items-center gap-2">
          <DateNav date={date} basePath={PATH} />
          {sorted.length > 0 && <PrintButton label="配送一覧を印刷" />}
        </div>
      </div>

      {sorted.length === 0 ? (
        <EmptyState
          title="この日の配送はありません"
          description="承認済み注文の出荷日がこの日になると表示されます。"
        />
      ) : (
        <>
          {/* 印刷帳票ヘッダー（画面では非表示・印刷時のみ） */}
          <div className="hidden print:block">
            <h1 className="text-xl font-bold">配送一覧　{date}</h1>
            <p className="mt-1 text-sm">
              配送先 {sorted.length} 件 ／ 明細 {totalItems} 行　　確認者：＿＿＿＿＿＿＿＿
            </p>
          </div>

          <div className="space-y-4">
            {sorted.map((g) => (
              <Card key={g.key} className="space-y-2 print:break-inside-avoid print:rounded-none print:border print:border-black print:shadow-none">
                <h2 className="font-display text-base font-bold text-ink">
                  {g.customerName}
                  {g.destinationName && <span className="text-ink-soft">　＞ {g.destinationName}</span>}
                  <span className="ml-2 text-sm font-normal text-ink-soft">{g.items.length}件</span>
                </h2>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-xs text-ink-soft print:border-black">
                      <th className="py-1 pr-2 font-medium">品目</th>
                      <th className="py-1 pr-2 font-medium">数量</th>
                      <th className="py-1 pr-2 font-medium">荷姿・メモ</th>
                      <th className="w-14 py-1 text-center font-medium">積込</th>
                      <th className="w-14 py-1 text-center font-medium">納品</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.items.map((it) => (
                      <tr key={it.id} className="border-b border-line last:border-0 print:border-black">
                        <td className="py-1.5 pr-2 font-medium text-ink">{it.productName}</td>
                        <td className="num py-1.5 pr-2 tabular-nums text-ink">
                          {it.quantityText}
                          <span className="ml-1 text-xs text-ink-soft">{it.unit}</span>
                        </td>
                        <td className="py-1.5 pr-2 text-xs text-ink-soft">
                          {[it.spec, it.containerType, it.hasCard ? 'カード有' : null, it.lineNote]
                            .filter(Boolean)
                            .join('・') || '—'}
                        </td>
                        {/* 紙上で✓するチェック欄（誤配送0%のダブルチェック。デジタル化はPhase 1） */}
                        <td className="py-1.5 text-center text-lg leading-none text-ink-soft">□</td>
                        <td className="py-1.5 text-center text-lg leading-none text-ink-soft">□</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
