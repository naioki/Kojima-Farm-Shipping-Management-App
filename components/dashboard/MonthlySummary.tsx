import { TrendingUp, TrendingDown } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { signedPct } from '@/lib/format'
import type { SummaryRow } from './types'

/** 今月のサマリー（受注件数/出荷金額/請求金額/未請求額＋前月比＋スパークライン）。 */
export function MonthlySummary({ rows }: { rows: SummaryRow[] }) {
  return (
    <Card variant="elevated" className="flex h-full flex-col">
      <h2 className="mb-3 text-sm font-semibold text-ink">今月のサマリー</h2>
      <ul className="flex-1 divide-y divide-line/60">
        {rows.map((r) => {
          const positive = (r.deltaPct ?? 0) >= 0
          // 良し悪し: 通常は増=良。invertDelta（未請求額など）は減=良。
          const good = r.invertDelta ? !positive : positive
          return (
            <li key={r.key} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="text-xs text-ink-soft">{r.label}</p>
                <p className="num mt-0.5 text-lg font-bold text-ink">{r.value}</p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <Sparkline data={r.spark} good={good} />
                {r.deltaPct != null && (
                  <span
                    className={`flex items-center gap-0.5 text-xs font-medium ${
                      good ? 'text-harvest-600' : 'text-alert'
                    }`}
                  >
                    {positive ? (
                      <TrendingUp className="h-3.5 w-3.5" aria-hidden />
                    ) : (
                      <TrendingDown className="h-3.5 w-3.5" aria-hidden />
                    )}
                    <span className="num">{signedPct(r.deltaPct)}</span>
                  </span>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

/** 依存ゼロの軽量スパークライン（インラインSVG）。 */
function Sparkline({ data, good }: { data: number[]; good: boolean }) {
  const w = 64
  const h = 24
  if (data.length < 2) return <svg width={w} height={h} aria-hidden />
  const min = Math.min(...data)
  const max = Math.max(...data)
  const span = max - min || 1
  const stroke = good ? 'var(--harvest-500)' : 'var(--alert)'
  const pts = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * (w - 2) + 1
      const y = h - 2 - ((v - min) / span) * (h - 4)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden className="shrink-0">
      <polyline
        points={pts}
        fill="none"
        stroke={stroke}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
