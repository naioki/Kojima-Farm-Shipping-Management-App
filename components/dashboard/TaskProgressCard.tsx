import { Card } from '@/components/ui/Card'
import { cn } from '@/lib/cn'
import type { HarvestTaskStatus } from '@/types/database'

const STATUS: Record<HarvestTaskStatus, { label: string; bar: string; pct: number }> = {
  not_started: { label: '未着手', bar: 'bg-line-strong', pct: 0 },
  harvesting: { label: '収穫中', bar: 'bg-trust-500', pct: 40 },
  packing: { label: '梱包中', bar: 'bg-earth-500', pct: 70 },
  completed: { label: '完了', bar: 'bg-harvest-500', pct: 100 },
  delayed: { label: '遅延', bar: 'bg-alert', pct: 50 },
}

export interface TaskProgressCardProps {
  productName: string
  status: HarvestTaskStatus
  requiredQty: number
  unit?: string
}

/**
 * スタッフ向けタスク進捗カード（design.md）。プログレスバー必須。
 * delayed→alert（赤）、completed→harvest（緑）。色だけでなくラベルも併記。
 */
export function TaskProgressCard({ productName, status, requiredQty, unit = '個' }: TaskProgressCardProps) {
  const s = STATUS[status]
  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-lg font-bold text-ink">{productName}</h3>
        <span
          className={cn(
            'rounded px-2 py-0.5 text-xs font-medium',
            status === 'delayed' ? 'bg-alert-bg text-alert' : 'bg-bg-soft text-ink-soft',
          )}
        >
          {s.label}
        </span>
      </div>
      <p className="num text-sm text-ink-soft">
        必要数 {requiredQty.toLocaleString('ja-JP')} {unit}
      </p>
      <div
        className="h-2 w-full overflow-hidden rounded bg-bg-soft"
        role="progressbar"
        aria-valuenow={s.pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className={cn('animate-fill h-full rounded', s.bar)} style={{ width: `${s.pct}%` }} />
      </div>
    </Card>
  )
}
