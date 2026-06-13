import { createClient } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { AddProductForm } from '@/components/admin/AddProductForm'
import { ProductsTable, type ProductRow } from '@/components/admin/ProductsTable'
import type { TaxRate } from '@/types/database'

export const dynamic = 'force-dynamic'

/**
 * 商品（品目）設定。週間マトリックスの品目タブ・スマート追加の選択肢になる品目を追加・編集する。
 * 在庫数（stock_qty）もここで調整できる（Laravel版 画面4の在庫管理に対応）。バーコードは対象外。
 */
export default async function ProductsPage() {
  const supabase = createClient()
  const { data: products, error } = await supabase
    .from('products')
    .select('id, name, name_kana, unit, default_tax_rate, container_capacity, default_unit_price, stock_qty, is_active')
    .order('name')
  if (error) return <ErrorState message={error.message} />

  const rows: ProductRow[] = (products ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    name_kana: p.name_kana,
    unit: p.unit,
    default_tax_rate: p.default_tax_rate as TaxRate,
    container_capacity: p.container_capacity,
    default_unit_price: p.default_unit_price,
    stock_qty: p.stock_qty,
    is_active: p.is_active,
  }))

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <h1 className="font-display text-2xl font-bold text-ink">商品（品目）設定</h1>

      <Card className="space-y-3">
        <h2 className="font-display text-base font-bold text-ink">品目を追加</h2>
        <AddProductForm />
      </Card>

      {!rows.length ? (
        <EmptyState title="品目がありません" description="上のフォームから追加してください。" />
      ) : (
        <Card className="space-y-3">
          <h2 className="font-display text-base font-bold text-ink">品目一覧・在庫</h2>
          <ProductsTable products={rows} />
        </Card>
      )}
    </div>
  )
}
