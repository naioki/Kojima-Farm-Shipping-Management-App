import Link from 'next/link'
import { AlertCircle, AlertTriangle, Info } from 'lucide-react'
import { Card } from '@/components/ui/Card'

export type AlertTone = 'alert' | 'warning' | 'info'

export interface AlertItem {
  id: string
  tone: AlertTone
  label: string
  /** 例: '最終更新: 5分前'。 */
  meta?: string
  count: number
  href: string
}

const toneCfg: Record<AlertTone, { icon: typeof Info; ring: string; chip: string }> = {
  alert: { icon: AlertCircle, ring: 'text-alert', chip: 'bg-alert text-white' },
  warning: { icon: AlertTriangle, ring: 'text-warning', chip: 'bg-warning text-white' },
  info: { icon: Info, ring: 'text-trust-600', chip: 'bg-trust-500 text-white' },
}

/**
 * 要対応アラート。0件のときは「対応待ちはありません」を出す（空状態必須）。
 */
export function AlertsPanel({ alerts, allHref = '/admin/inbox' }: { alerts: AlertItem[]; allHref?: string }) {
  return (
    <Card variant="elevated" className="h-full">
      <h2 className="mb-3 text-sm font-semibold text-ink">要対応アラート</h2>

      {alerts.length === 0 ? (
        <p className="flex items-center gap-2 py-6 text-sm text-ink-soft">
          <Info className="h-4 w-4 text-harvest-600" aria-hidden />
          対応待ちはありません。
        </p>
      ) : (
        <ul className="space-y-1">
          {alerts.map((a) => {
            const cfg = toneCfg[a.tone]
            const Icon = cfg.icon
            return (
              <li key={a.id}>
                <Link
                  href={a.href}
                  className="flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-bg-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-trust-100"
                >
                  <Icon className={`h-5 w-5 shrink-0 ${cfg.ring}`} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{a.label}</p>
                    {a.meta && <p className="text-xs text-ink-faint">{a.meta}</p>}
                  </div>
                  <span
                    className={`num flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full px-1.5 text-xs font-bold ${cfg.chip}`}
                  >
                    {a.count}
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}

      <div className="mt-2 border-t border-line/60 pt-2">
        <Link href={allHref} className="text-xs font-medium text-trust-600 hover:underline">
          すべてのアラートを見る →
        </Link>
      </div>
    </Card>
  )
}
