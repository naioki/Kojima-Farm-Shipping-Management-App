import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import { ErrorState } from '@/components/ui/States'

export const dynamic = 'force-dynamic'

/**
 * admin ダッシュボードの初期画面（最小版）。
 * 承認待ち件数など要対応の入口を出す。売上KPI/グラフ（KPICard/recharts）は後続で接続。
 */
export default async function AdminHome() {
  const supabase = createClient()
  const { count, error } = await supabase
    .from('order_receipts')
    .select('id', { count: 'exact', head: true })
    .in('status', ['pending_review', 'ai_failed', 'unmatched'])

  if (error) return <ErrorState message={error.message} />

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-bold text-ink">ダッシュボード</h1>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Link href="/admin/inbox">
          <Card variant="elevated" interactive className="space-y-2">
            <p className="text-sm font-medium text-ink-soft">承認待ち</p>
            <p className="num text-3xl font-bold text-earth-700">{count ?? 0}</p>
            <p className="text-sm text-trust-600">承認画面へ →</p>
          </Card>
        </Link>
      </div>
      <p className="text-sm text-ink-faint">
        ※ 売上・粗利の KPI と SalesChart（recharts）は集計接続後に表示します。
      </p>
    </div>
  )
}
