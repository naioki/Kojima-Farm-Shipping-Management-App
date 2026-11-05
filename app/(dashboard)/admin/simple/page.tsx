import Link from 'next/link'
import { getAdminDashboardData } from '@/lib/dashboard/admin-data'
import { ErrorState } from '@/components/ui/States'
import { requireAdmin } from '@/lib/auth/require-admin'

export const dynamic = 'force-dynamic'

/**
 * かんたん画面（紙の卒業のための入口）。大きな文字で「今日の承認」「明日の出荷」「今月のお金」の3つだけ。
 * 数字はダッシュボードと同じ集計（lib/dashboard/admin-data）を使い、画面ごとに数字がずれないようにする。
 */
export default async function SimpleHome() {
  const guard = await requireAdmin('この画面は管理者のみです。')
  if (guard) return guard

  let data
  try {
    data = await getAdminDashboardData()
  } catch (e) {
    return <ErrorState message={e instanceof Error ? e.message : '読み込みに失敗しました'} />
  }

  const pending = data.alerts?.find((a) => a.id === 'po')?.count ?? 0
  const overdue = data.alerts?.find((a) => a.id === 'ar')
  const tp = data.tomorrowPackStats
  const money = (key: string) => data.summary.find((s) => s.key === key)?.value ?? '—'

  const card = 'block rounded-2xl border-2 p-6 shadow-sm transition active:scale-[0.99]'

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <h1 className="font-display text-3xl font-bold text-ink">きょうの仕事</h1>

      <Link
        href="/admin/approvals"
        className={`${card} ${pending > 0 ? 'border-alert bg-alert-bg' : 'border-line bg-bg-card'}`}
      >
        <p className="text-xl font-bold text-ink">① 注文の承認</p>
        <p className="mt-2 text-4xl font-black text-ink">
          {pending > 0 ? (
            <>
              <span className="num text-alert">{pending}</span> 件 待っています
            </>
          ) : (
            'ありません ✓'
          )}
        </p>
        {pending > 0 && <p className="mt-2 text-lg font-bold text-trust-700">押して承認する →</p>}
      </Link>

      <Link href={tp ? `/field/shipments?date=${tp.deliveryDate}` : '/field/shipments'} className={`${card} border-line bg-bg-card`}>
        <p className="text-xl font-bold text-ink">② 明日（{tp?.deliveryDateLabel ?? '—'}）の出荷</p>
        {tp && tp.totalItems > 0 ? (
          <>
            <p className="mt-2 text-4xl font-black text-ink">
              <span className="num">{tp.totalBoxes}</span> 箱
            </p>
            <p className="mt-1 text-xl text-ink-soft">
              パック済み <span className="num font-bold text-ink">{tp.completedBoxes}</span> 箱（{tp.progressPct}%）
            </p>
          </>
        ) : (
          <p className="mt-2 text-3xl font-black text-ink-soft">まだありません</p>
        )}
      </Link>

      <Link href="/admin/invoices" className={`${card} ${overdue ? 'border-alert bg-alert-bg' : 'border-line bg-bg-card'}`}>
        <p className="text-xl font-bold text-ink">③ 今月のお金</p>
        <dl className="mt-3 space-y-2 text-xl">
          <div className="flex justify-between gap-3">
            <dt className="text-ink-soft">出荷した金額</dt>
            <dd className="num font-black text-ink">{money('shipped')}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-ink-soft">まだ請求していない</dt>
            <dd className="num font-black text-ink">{money('unbilled')}</dd>
          </div>
        </dl>
        {overdue && <p className="mt-3 text-lg font-bold text-alert">⚠ 期日を過ぎた未入金 {overdue.count} 件</p>}
      </Link>

      <p className="text-center text-base">
        <Link href="/admin" className="text-trust-700 underline">
          くわしい画面（ダッシュボード）へ
        </Link>
      </p>
    </div>
  )
}
