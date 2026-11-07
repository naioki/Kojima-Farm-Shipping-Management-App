import { Clock, PackageCheck, Truck, TrendingUp } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { yen } from '@/lib/format'
import type { TodayShipmentStats } from './types'

/**
 * 本日納品分の状況（箱数＋金額＋進捗）。4枚カード（スマホでも2列）。
 * 数字はすべて箱数基準: 進捗率 = (梱包完了＋出荷済み)箱 ÷ 全箱 で、カードの箱数と必ず一致する。
 * 色だけに頼らずアイコン併用（design.md / WCAG）。数値は .num。
 */
export function ShipmentStatusCards({ stats }: { stats: TodayShipmentStats }) {
  const a = stats.amounts
  const c = stats.itemCounts
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatCard
        icon={<Clock className="h-5 w-5" aria-hidden />}
        tone="neutral"
        label="未着手"
        boxes={stats.notStarted}
        items={c?.notStarted}
        amount={a?.notStarted}
      />
      <StatCard
        icon={<PackageCheck className="h-5 w-5" aria-hidden />}
        tone="earth"
        label="梱包完了"
        boxes={stats.packed}
        items={c?.packed}
        amount={a?.packed}
      />
      <StatCard
        icon={<Truck className="h-5 w-5" aria-hidden />}
        tone="harvest"
        label="出荷済み"
        boxes={stats.shipped}
        items={c?.shipped}
        amount={a?.shipped}
      />
      <ProgressCard pct={stats.progressPct} done={stats.doneBoxes} total={stats.totalBoxes} />
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
  boxes,
  items,
  amount,
}: {
  icon: React.ReactNode
  tone: Tone
  label: string
  boxes: number
  items?: number
  amount?: number | null
}) {
  return (
    <Card variant="elevated" className="relative min-w-0 p-4 sm:p-5">
      <span
        className={`absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-lg sm:right-4 sm:top-4 sm:h-9 sm:w-9 ${toneBadge[tone]}`}
      >
        {icon}
      </span>
      <p className="text-sm font-medium text-ink-soft">{label}</p>
      <p className="mt-1 flex items-baseline gap-1">
        <span className={`num text-2xl font-bold sm:text-3xl ${toneNum[tone]}`}>{boxes.toLocaleString('ja-JP')}</span>
        <span className="text-sm text-ink-faint">箱</span>
      </p>
      <p className="num mt-1 text-xs text-ink-faint">
        {items != null && <>{items}明細・</>}
        {yen(amount)}
      </p>
    </Card>
  )
}

function ProgressCard({ pct, done, total }: { pct: number; done: number; total: number }) {
  return (
    <Card variant="elevated" className="relative min-w-0 p-4 sm:p-5">
      <span className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-lg bg-trust-100 text-trust-600 sm:right-4 sm:top-4 sm:h-9 sm:w-9">
        <TrendingUp className="h-5 w-5" aria-hidden />
      </span>
      <p className="text-sm font-medium text-ink-soft">進捗率</p>
      <p className="mt-1 flex items-baseline gap-1">
        <span className="num text-2xl font-bold text-trust-600 sm:text-3xl">{pct}</span>
        <span className="text-sm text-ink-faint">%</span>
      </p>
      <div
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-line"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="梱包完了・出荷済みの箱の割合"
      >
        <div
          className="h-full rounded-full bg-harvest-500 transition-all duration-700 ease-organic"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="num mt-1.5 text-xs text-ink-faint">
        梱包・出荷済み {done.toLocaleString('ja-JP')} / {total.toLocaleString('ja-JP')} 箱
      </p>
    </Card>
  )
}
