import { Tags } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { LotForm } from '@/components/admin/LotForm'
import { requireAdmin } from '@/lib/auth/require-admin'
import { formatJpDateShort } from '@/lib/dates'

export const dynamic = 'force-dynamic'

/**
 * ロット管理（J-GAPトレサ・配送 Phase 2）。粒度は「圃場×収穫日×品目」。
 * 請求とは別粒度（ロットは帳票に載らない）。リコール時は
 * lot → order_items → orders（取引先・出荷日）で出荷先を特定できる。
 */
export default async function LotsPage() {
  const guard = await requireAdmin('ロット管理は管理者のみです。')
  if (guard) return guard

  const supabase = createClient()
  const [{ data: products, error: prodErr }, { data: lots, error: lotErr }] = await Promise.all([
    supabase.from('products').select('id, name').eq('is_active', true).order('name'),
    supabase
      .from('lots')
      .select('id, lot_no, product_id, field_name, harvest_date, gap_record_ref')
      .order('created_at', { ascending: false })
      .limit(30),
  ])
  if (prodErr) return <ErrorState message={prodErr.message} />
  if (lotErr) return <ErrorState message={lotErr.message} />

  // ロット別の紐付け明細数（直近30ロット分だけ集計）
  const lotIds = (lots ?? []).map((l) => l.id)
  const { data: itemRows, error: itemRowsErr } = lotIds.length
    ? await supabase.from('order_items').select('lot_id').in('lot_id', lotIds)
    : { data: [] as { lot_id: string | null }[], error: null }
  // 紐付け明細数は補助表示。失敗しても本体（ロット一覧）は殺さず0件扱いにする。
  if (itemRowsErr) console.error('[lots] 紐付け明細数の集計に失敗:', itemRowsErr.message)
  const countByLot = new Map<string, number>()
  for (const r of itemRows ?? []) {
    if (r.lot_id) countByLot.set(r.lot_id, (countByLot.get(r.lot_id) ?? 0) + 1)
  }
  const productName = new Map((products ?? []).map((p) => [p.id, p.name]))

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="flex items-center gap-2 font-display text-2xl font-bold text-ink">
        <Tags className="h-6 w-6 text-earth-600" aria-hidden />
        ロット（トレーサビリティ）
      </h1>

      <Card className="space-y-2">
        <h2 className="font-display text-base font-bold text-ink">ロットを作成</h2>
        <LotForm products={(products ?? []).map((p) => ({ id: p.id, name: p.name }))} />
      </Card>

      {(lots ?? []).length === 0 ? (
        <EmptyState
          title="ロットはまだありません"
          description="収穫のたびに「圃場×収穫日×品目」で1ロット作成すると、出荷明細と紐付いてリコール範囲を特定できます。"
        />
      ) : (
        <Card>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-ink-soft">
                <th className="py-1.5 pr-2 font-medium">ロット番号</th>
                <th className="py-1.5 pr-2 font-medium">品目</th>
                <th className="py-1.5 pr-2 font-medium">収穫日</th>
                <th className="py-1.5 pr-2 font-medium">GAP台帳</th>
                <th className="py-1.5 text-right font-medium">紐付け明細</th>
              </tr>
            </thead>
            <tbody>
              {(lots ?? []).map((l) => (
                <tr key={l.id} className="border-b border-line last:border-0">
                  <td className="py-2 pr-2 font-medium text-ink">{l.lot_no}</td>
                  <td className="py-2 pr-2 text-ink">{productName.get(l.product_id) ?? '—'}</td>
                  <td className="num py-2 pr-2 tabular-nums text-ink">{l.harvest_date ? formatJpDateShort(l.harvest_date) : '—'}</td>
                  <td className="py-2 pr-2 text-xs text-ink-soft">{l.gap_record_ref ?? '—'}</td>
                  <td className="num py-2 text-right tabular-nums text-ink">{countByLot.get(l.id) ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}
