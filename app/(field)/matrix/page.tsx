import Decimal from 'decimal.js'
import { createClient } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { MatrixCell } from '@/components/field/MatrixCell'
import { decomposeByContainer } from '@/lib/calculations/parse-quantity'

export const dynamic = 'force-dynamic'

/**
 * 圃場マトリックス（features.md Phase D）。
 * 当面は「今日の出荷対象」を単列で表示する安全版タップループ。
 * 複数日グリッド・品目タブ・7日棒グラフ（recharts dynamic import）は後続。
 */
export default async function MatrixPage() {
  const supabase = createClient()
  const today = new Date().toISOString().slice(0, 10)

  const { data: items, error } = await supabase
    .from('order_items')
    .select('id, product_name, quantity, unit, field_status, version, orders!inner(delivery_date, customer_id)')
    .eq('orders.delivery_date', today)
    .order('product_name')

  if (error) return <ErrorState message={error.message} />

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="font-display text-2xl font-bold text-ink">圃場マトリックス（今日）</h1>

      {!items?.length ? (
        <EmptyState title="今日の出荷対象はありません" description="承認された注文の出荷日が今日になると表示されます。" />
      ) : (
        <Card className="space-y-2">
          {items.map((it) => {
            const total = new Decimal(it.quantity)
            // container_capacity はここでは未取得のため総数のみ。荷姿展開は出荷指示書で行う。
            const breakdown = decomposeByContainer(total, null)
            const qtyText = breakdown
              ? `${total.toString()} / ${breakdown.containers}c${breakdown.remainder.toString()}`
              : total.toString()
            return (
              <div key={it.id} className="flex items-center justify-between gap-3 border-b border-line py-2 last:border-0">
                <span className="text-sm text-ink">{it.product_name}</span>
                <MatrixCell
                  itemId={it.id}
                  initialStatus={it.field_status}
                  initialVersion={it.version}
                  label={it.product_name}
                  quantityText={qtyText}
                />
              </div>
            )
          })}
        </Card>
      )}
    </div>
  )
}
