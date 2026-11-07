import Link from 'next/link'
import { getAdminDashboardData } from '@/lib/dashboard/admin-data'
import { yen } from '@/lib/format'
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
  const overdueRows = data.overdueInvoices ?? []
  const tp = data.tomorrowPackStats
  const money = (key: string) => data.summary.find((s) => s.key === key)?.value ?? '—'

  const card = 'block rounded-2xl border-2 p-6 shadow-sm transition active:scale-[0.99]'

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <header>
        <h1 className="font-display text-3xl font-bold text-ink">きょうの仕事</h1>
        <p className="num mt-1 text-xl font-bold text-ink-soft">{data.header.dateLabel}</p>
      </header>

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
        <p className="text-xl font-bold text-ink">
          ② 明日 <span className="num">{tp?.deliveryDateLabel ?? '—'}</span> の出荷
        </p>
        {tp && tp.totalItems > 0 ? (
          <>
            <p className="mt-2 text-4xl font-black text-ink">
              <span className="num">{tp.totalBoxes}</span> 箱
            </p>
            <p className="mt-1 text-xl text-ink-soft">
              パック済み <span className="num font-bold text-ink">{tp.completedBoxes}</span> 箱
              <span className="num">（{tp.progressPct}%）</span>
            </p>
          </>
        ) : (
          <p className="mt-2 text-3xl font-black text-ink-soft">まだありません</p>
        )}
      </Link>

      <Link href="/admin/invoices" className={`${card} ${overdue ? 'border-alert bg-alert-bg' : 'border-line bg-bg-card'}`}>
        <p className="text-xl font-bold text-ink">③ 今月のお金</p>
        <dl className="mt-3 space-y-2 text-xl">
          <div className="flex flex-wrap justify-between gap-x-3">
            <dt className="text-ink-soft">出荷した金額（税込）</dt>
            <dd className="num ml-auto font-black text-ink">{money('shipped')}</dd>
          </div>
          <div className="flex flex-wrap justify-between gap-x-3">
            <dt className="text-ink-soft">まだ請求していない（税込）</dt>
            <dd className="num ml-auto font-black text-ink">{money('unbilled')}</dd>
          </div>
        </dl>
        {overdue && (
          <div className="mt-4 border-t-2 border-alert pt-3">
            <p className="text-lg font-bold text-alert">⚠ 期日を過ぎた未入金 {overdue.count} 件</p>
            <ul className="mt-2 space-y-1.5 text-lg">
              {overdueRows.slice(0, 3).map((r) => (
                <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="min-w-0 break-words font-bold text-ink">{r.customer}</span>
                  <span className="num font-black text-alert">{yen(r.amount)}</span>
                  <span className="num w-full text-base text-ink-soft">期日 {r.dueLabel}</span>
                </li>
              ))}
            </ul>
            {overdueRows.length > 3 && <p className="mt-1 text-base text-ink-soft">ほか {overdueRows.length - 3} 件</p>}
          </div>
        )}
      </Link>

      <p className="text-center text-base">
        <Link href="/admin" className="inline-flex min-h-10 items-center text-trust-700 underline">
          くわしい画面（ダッシュボード）へ
        </Link>
      </p>
    </div>
  )
}
