import { Clock, PackageCheck, Truck, TrendingUp } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { yen } from '@/lib/format'
import type { TodayShipmentStats } from './types'

/**
 * 本日の出荷状況（件数＋金額＋進捗）。comp の4枚カード。
 * 色だけに頼らずアイコン併用（design.md / WCAG）。数値は .num。
 */
export function ShipmentStatusCards({ stats }: { stats: TodayShipmentStats }) {
  const a = stats.amounts
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard
        icon={<Clock className="h-5 w-5" aria-hidden />}
        tone="neutral"
        label="未着手"
        count={stats.notStarted}
        amount={a?.notStarted}
      />
      <StatCard
        icon={<PackageCheck className="h-5 w-5" aria-hidden />}
        tone="earth"
        label="梱包完了"
        count={stats.packed}
        amount={a?.packed}
      />
      <StatCard
        icon={<Truck className="h-5 w-5" aria-hidden />}
        tone="harvest"
        label="出荷済み"
        count={stats.shipped}
        amount={a?.shipped}
      />
      <ProgressCard pct={stats.progressPct} shipped={stats.shipped} total={stats.totalItems} />
    </div>
  )
}

type Tone = 'neutral' | 'earth' | 'harvest'

const toneBadge: Record<Tone, string> = {
  neutral: 'bg-bg-soft text-ink-soft',
  earth: 'bg-earth-100 text-earth-700',
  harvest: 'bg-harvest-100 text-harvest-700',
}
const toneNum: Record<Tone, string> = {
  neutral: 'text-ink',
  earth: 'text-earth-700',
  harvest: 'text-harvest-700',
}

function StatCard({
  icon,
  tone,
  label,
  count,
  amount,
}: {
  icon: React.ReactNode
  tone: Tone
  label: string
  count: number
  amount?: number | null
}) {
  return (
    <Card variant="elevated" className="relative">
      <span
        className={`absolute right-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-lg ${toneBadge[tone]}`}
      >
        {icon}
      </span>
      <p className="text-sm font-medium text-ink-soft">{label}</p>
      <p className="mt-1 flex items-baseline gap-1">
        <span className={`num text-3xl font-bold ${toneNum[tone]}`}>{count}</span>
        <span className="text-sm text-ink-faint">件</span>
      </p>
      <p className="num mt-1 text-xs text-ink-faint">{yen(amount)}</p>
    </Card>
  )
}

function ProgressCard({ pct, shipped, total }: { pct: number; shipped: number; total: number }) {
  return (
    <Card variant="elevated" className="relative">
      <span className="absolute right-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-lg bg-trust-100 text-trust-600">
        <TrendingUp className="h-5 w-5" aria-hidden />
      </span>
      <p className="text-sm font-medium text-ink-soft">進捗率</p>
      <p className="mt-1 flex items-baseline gap-1">
        <span className="num text-3xl font-bold text-trust-600">{pct}</span>
        <span className="text-sm text-ink-faint">%</span>
      </p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line">
        <div
          className="h-full rounded-full bg-harvest-500 transition-all duration-700 ease-organic"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="num mt-1.5 text-xs text-ink-faint">
        {shipped} / {total} 件
      </p>
    </Card>
  )
}
