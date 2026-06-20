import Link from 'next/link'
import { Bell, LifeBuoy } from 'lucide-react'

export interface DashboardHeaderProps {
  /** 表示名（例: 小島）。 */
  name: string
  /** あいさつ（おはようございます 等）。サーバ側で時刻から決める。 */
  greeting: string
  /** 例: '2025年5月24日 (土)'。 */
  dateLabel: string
  /** 未対応通知件数。0 ならバッジ非表示。 */
  notificationCount: number
  /** 通知ベルのリンク先（既定: 要対応の受信箱）。 */
  notificationsHref?: string
  /** サポートのリンク先。 */
  supportHref?: string
}

/**
 * ダッシュボード上部のヘッダー（タイトル＋あいさつ／通知・サポート・日付）。
 * 純表示。色は design.md トークン、数値は .num。
 */
export function DashboardHeader({
  name,
  greeting,
  dateLabel,
  notificationCount,
  notificationsHref = '/admin/inbox',
  supportHref = '/admin/settings',
}: DashboardHeaderProps) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h1 className="font-display text-2xl font-bold text-ink">ダッシュボード</h1>
        <p className="mt-1 text-sm text-ink-soft">
          {greeting}、{name}さん！
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <Link
          href={notificationsHref}
          aria-label={`通知${notificationCount > 0 ? `（${notificationCount}件）` : ''}`}
          className="relative inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-bg-card px-3 text-sm font-medium text-ink-soft shadow-sm transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-trust-100"
        >
          <Bell className="h-4 w-4" aria-hidden />
          <span className="hidden sm:inline">通知</span>
          {notificationCount > 0 && (
            <span className="num absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-alert px-1 text-[11px] font-bold leading-none text-white">
              {notificationCount > 99 ? '99+' : notificationCount}
            </span>
          )}
        </Link>

        <Link
          href={supportHref}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-bg-card px-3 text-sm font-medium text-ink-soft shadow-sm transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-trust-100"
        >
          <LifeBuoy className="h-4 w-4" aria-hidden />
          <span className="hidden sm:inline">サポート</span>
        </Link>

        <span className="num hidden h-9 items-center rounded-lg bg-bg-soft px-3 text-sm font-medium text-ink-soft md:inline-flex">
          {dateLabel}
        </span>
      </div>
    </header>
  )
}
