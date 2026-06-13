import { createClient } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { AddProductForm } from '@/components/admin/AddProductForm'

export const dynamic = 'force-dynamic'

/**
 * 商品（品目）設定。週間マトリックスの品目タブ・スマート追加の選択肢になる品目をここで追加する。
 * （Laravel版 画面4の「在庫・バーコード」は対象外。当面は品目マスタの追加・一覧のみ）
 */
export default async function ProductsPage() {
  const supabase = createClient()
  const { data: products, error } = await supabase
    .from('products')
    .select('id, name, name_kana, unit, default_tax_rate, container_capacity, default_unit_price, is_active')
    .order('name')
  if (error) return <ErrorState message={error.message} />

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="font-display text-2xl font-bold text-ink">商品（品目）設定</h1>

      <Card className="space-y-3">
        <h2 className="font-display text-base font-bold text-ink">品目を追加</h2>
        <AddProductForm />
      </Card>

      {!products?.length ? (
        <EmptyState title="品目がありません" description="上のフォームから追加してください。" />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="text-left text-ink-soft">
                  <th className="px-2 py-2 font-medium">品目</th>
                  <th className="px-2 py-2 font-medium">単位</th>
                  <th className="px-2 py-2 font-medium">税率</th>
                  <th className="num px-2 py-2 text-right font-medium">コンテナ容量</th>
                  <th className="num px-2 py-2 text-right font-medium">既定単価</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => (
                  <tr key={p.id} className="border-t border-line">
                    <td className="px-2 py-2 font-medium text-ink">
                      {p.name}
                      {!p.is_active && <span className="ml-2 text-xs text-ink-faint">（停止中）</span>}
                    </td>
                    <td className="px-2 py-2 text-ink-soft">{p.unit}</td>
                    <td className="px-2 py-2 text-ink-soft">{p.default_tax_rate}%</td>
                    <td className="num px-2 py-2 text-right tabular-nums text-ink-soft">
                      {p.container_capacity ?? '—'}
                    </td>
                    <td className="num px-2 py-2 text-right tabular-nums text-ink-soft">
                      {p.default_unit_price != null ? `¥${p.default_unit_price.toLocaleString()}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}
