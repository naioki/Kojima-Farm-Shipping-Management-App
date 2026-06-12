import { TrendingUp, TrendingDown } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { cn } from '@/lib/cn'

type Variant = 'revenue' | 'orders' | 'margin' | 'default'

export interface KPICardProps {
  title: string
  value: string
  change?: { percent: number; period: string }
  variant?: Variant
}

/**
 * 経営向け KPI カード（design.md）。
 * 正→harvest（緑）TrendingUp、負→alert（赤）TrendingDown。色だけに頼らずアイコン併用。
 * 金額・数値は num（font-mono + tabular-nums）。
 */
export function KPICard({ title, value, change, variant = 'default' }: KPICardProps) {
  const up = (change?.percent ?? 0) >= 0
  const accent: Record<Variant, string> = {
    revenue: 'text-earth-700',
    orders: 'text-trust-600',
    margin: 'text-harvest-700',
    default: 'text-ink',
  }
  return (
    <Card variant="elevated" className="space-y-2">
      <p className="text-sm font-medium text-ink-soft">{title}</p>
      <p className={cn('num text-3xl font-bold', accent[variant])}>{value}</p>
      {change && (
        <p
          className={cn(
            'flex items-center gap-1 text-sm font-medium',
            up ? 'text-harvest-600' : 'text-alert',
          )}
        >
          {up ? (
            <TrendingUp className="h-4 w-4" aria-hidden />
          ) : (
            <TrendingDown className="h-4 w-4" aria-hidden />
          )}
          <span className="num">
            {up ? '+' : ''}
            {change.percent}%
          </span>
          <span className="text-ink-faint">{change.period}</span>
        </p>
      )}
    </Card>
  )
}
