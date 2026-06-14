import Link from 'next/link'
import { AlertTriangle, PackageCheck, Truck, Clock, CheckCircle2, Plus, FileText, Users, ShoppingCart } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import { ErrorState } from '@/components/ui/States'

export const dynamic = 'force-dynamic'

const todayStr = () => new Date().toISOString().slice(0, 10)

/**
 * admin ダッシュボード（画面A）。
 * 上部: 今日の出荷KPI（ステータス別件数）
 * 中部: 要対応アラート（承認待ち / AI失敗 / 未紐付け）
 * 下部: クイックアクション
 */
export default async function AdminHome() {
  const supabase = createClient()
  const today = todayStr()

  // 今日の出荷ステータス集計 + 承認待ちを並列取得
  const [
    { data: todayOrders, error: todayErr },
    { count: pendingCount, error: pendingErr },
    { count: failedCount },
  ] = await Promise.all([
    supabase.from('orders').select('id').eq('delivery_date', today).in('status', ['approved', 'shipped']),
    supabase.from('order_receipts').select('id', { count: 'exact', head: true }).eq('status', 'pending_review'),
    supabase.from('order_receipts').select('id', { count: 'exact', head: true }).in('status', ['ai_failed', 'unmatched']),
  ])

  if (todayErr || pendingErr) {
    return <ErrorState message={todayErr?.message ?? pendingErr?.message ?? '取得エラー'} />
  }

  // 今日の出荷明細をまとめて集計
  const todayOrderIds = (todayOrders ?? []).map((o) => o.id)
  const { data: todayItems } = todayOrderIds.length
    ? await supabase
        .from('order_items')
        .select('field_status, quantity, shipped_qty')
        .in('order_id', todayOrderIds)
    : { data: [] }

  const statusCounts = { not_started: 0, packed: 0, shipped: 0, interrupted: 0 }
  for (const it of todayItems ?? []) {
    const partial = it.shipped_qty != null && it.shipped_qty < it.quantity
    if (it.field_status === 'shipped') statusCounts.shipped++
    else if (partial) statusCounts.interrupted++
    else if (it.field_status === 'packed') statusCounts.packed++
    else statusCounts.not_started++
  }
  const totalItems = (todayItems ?? []).length
  const progressPct = totalItems > 0 ? Math.round((statusCounts.shipped / totalItems) * 100) : 0

  const alertCount = (pendingCount ?? 0) + (failedCount ?? 0)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="font-display text-2xl font-bold text-ink">ダッシュボード</h1>
        <Link
          href="/admin/orders/new"
          className="inline-flex items-center gap-1.5 rounded-lg bg-earth-500 px-4 py-2 text-sm font-medium text-white hover:bg-earth-600 active:scale-95 transition-all"
        >
          <Plus className="h-4 w-4" aria-hidden />
          注文を新規入力
        </Link>
      </div>

      {/* 今日の出荷進捗 */}
      <section>
        <h2 className="mb-3 text-sm font-medium text-ink-soft">本日の出荷状況 — {today}</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="space-y-1">
            <p className="flex items-center gap-1.5 text-xs text-ink-soft">
              <Clock className="h-3.5 w-3.5" aria-hidden />
              未着手
            </p>
            <p className="num text-2xl font-bold tabular-nums text-ink">{statusCounts.not_started}</p>
            <p className="text-xs text-ink-faint">件</p>
          </Card>
          <Card className="space-y-1">
            <p className="flex items-center gap-1.5 text-xs text-ink-soft">
              <PackageCheck className="h-3.5 w-3.5 text-trust-500" aria-hidden />
              梱包完了
            </p>
            <p className="num text-2xl font-bold tabular-nums text-trust-600">{statusCounts.packed}</p>
            <p className="text-xs text-ink-faint">件</p>
          </Card>
          <Card className="space-y-1">
            <p className="flex items-center gap-1.5 text-xs text-ink-soft">
              <Truck className="h-3.5 w-3.5 text-harvest-500" aria-hidden />
              出荷済み
            </p>
            <p className="num text-2xl font-bold tabular-nums text-harvest-600">{statusCounts.shipped}</p>
            <p className="text-xs text-ink-faint">件</p>
          </Card>
          <Card className="space-y-1">
            <p className="flex items-center gap-1.5 text-xs text-ink-soft">
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
              進捗
            </p>
            <p className="num text-2xl font-bold tabular-nums text-ink">
              {progressPct}
              <span className="text-base font-normal text-ink-soft">%</span>
            </p>
            <div className="mt-1 h-1.5 rounded-full bg-line">
              <div
                className="h-full rounded-full bg-harvest-500 transition-all duration-500"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </Card>
        </div>
        {totalItems > 0 && (
          <div className="mt-2 text-right">
            <Link href={`/field/shipments?date=${today}`} className="text-xs text-trust-600 hover:underline">
              出荷一覧で詳細確認 →
            </Link>
          </div>
        )}
      </section>

      {/* 要対応 */}
      {alertCount > 0 && (
        <section>
          <h2 className="mb-3 flex items-center gap-1.5 text-sm font-medium text-ink">
            <AlertTriangle className="h-4 w-4 text-alert" aria-hidden />
            要対応
            <span className="ml-1 rounded-full bg-alert px-1.5 py-0.5 text-xs font-bold text-white">
              {alertCount}
            </span>
          </h2>
          <div className="space-y-2">
            {(pendingCount ?? 0) > 0 && (
              <Link href="/admin/inbox">
                <Card variant="elevated" interactive className="flex items-center justify-between gap-3 py-3">
                  <div>
                    <p className="text-sm font-medium text-ink">承認待ちの注文</p>
                    <p className="text-xs text-ink-soft">AI解析済み・要確認</p>
                  </div>
                  <span className="num shrink-0 rounded-full bg-earth-100 px-3 py-1 text-sm font-bold text-earth-700">
                    {pendingCount}件
                  </span>
                </Card>
              </Link>
            )}
            {(failedCount ?? 0) > 0 && (
              <Link href="/admin/inbox?status=ai_failed">
                <Card
                  variant="elevated"
                  interactive
                  className="flex items-center justify-between gap-3 border-alert/30 py-3"
                >
                  <div>
                    <p className="text-sm font-medium text-ink">解析失敗 / 取引先未紐付け</p>
                    <p className="text-xs text-ink-soft">手動で確認・紐付けが必要です</p>
                  </div>
                  <span className="num shrink-0 rounded-full bg-alert/10 px-3 py-1 text-sm font-bold text-alert">
                    {failedCount}件
                  </span>
                </Card>
              </Link>
            )}
          </div>
        </section>
      )}

      {/* クイックアクション */}
      <section>
        <h2 className="mb-3 text-sm font-medium text-ink-soft">よく使う操作</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Link href="/admin/orders/new">
            <Card interactive className="flex items-center gap-3 py-3">
              <ShoppingCart className="h-5 w-5 shrink-0 text-earth-500" aria-hidden />
              <div>
                <p className="text-sm font-medium text-ink">注文を新規入力</p>
                <p className="text-xs text-ink-soft">手動・電話注文など</p>
              </div>
            </Card>
          </Link>
          <Link href="/admin/customers">
            <Card interactive className="flex items-center gap-3 py-3">
              <Users className="h-5 w-5 shrink-0 text-trust-500" aria-hidden />
              <div>
                <p className="text-sm font-medium text-ink">取引先・規格管理</p>
                <p className="text-xs text-ink-soft">P/C・荷姿・規格の確認</p>
              </div>
            </Card>
          </Link>
          <Link href="/admin/invoices">
            <Card interactive className="flex items-center gap-3 py-3">
              <FileText className="h-5 w-5 shrink-0 text-harvest-600" aria-hidden />
              <div>
                <p className="text-sm font-medium text-ink">請求書</p>
                <p className="text-xs text-ink-soft">発行・確認・PDF</p>
              </div>
            </Card>
          </Link>
        </div>
      </section>
    </div>
  )
}
