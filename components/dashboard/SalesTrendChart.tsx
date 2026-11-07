'use client'

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts'
import { Card } from '@/components/ui/Card'
import { yen } from '@/lib/format'
import { chooseYenUnit, formatAxisTick } from '@/lib/dashboard/compute'
import type { TrendPoint } from './types'

/**
 * 今月の出荷推移（日次・折れ線・税込）。1日〜今日の全日（出荷のない日は0）。
 * 縦軸の単位は金額の大きさで 円／千円／万円 を切り替える。recharts はバンドルが重いので
 * 呼び出し側で next/dynamic（ssr:false）読み込みする想定（stack.md）。
 */
export function SalesTrendChart({ data }: { data: TrendPoint[] }) {
  const hasData = data.some((d) => d.value > 0)
  const unit = chooseYenUnit(Math.max(0, ...data.map((d) => d.value)))
  return (
    <Card variant="elevated" className="flex h-full flex-col">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-ink">今月の出荷推移（税込）</h2>
        {hasData && <span className="text-xs text-ink-faint">単位: {unit.label}</span>}
      </div>
      {!hasData ? (
        <div className="flex h-44 flex-1 items-center justify-center text-sm text-ink-faint">
          まだ出荷データがありません
        </div>
      ) : (
        <div className="h-44 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -8 }}>
              <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: 'var(--ink-faint)' }}
                tickLine={false}
                axisLine={{ stroke: 'var(--line)' }}
                interval="preserveStartEnd"
                minTickGap={24}
              />
              <YAxis
                tick={{ fontSize: 11, fill: 'var(--ink-faint)' }}
                tickLine={false}
                axisLine={false}
                width={40}
                allowDecimals
                tickFormatter={(v: number) => formatAxisTick(v, unit.divisor)}
              />
              <Tooltip
                cursor={{ stroke: 'var(--line-strong)' }}
                contentStyle={{
                  borderRadius: 10,
                  border: '1px solid var(--line)',
                  fontSize: 12,
                  boxShadow: 'var(--shadow-lg)',
                }}
                formatter={(v: number) => [yen(v), '出荷']}
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke="var(--harvest-600)"
                strokeWidth={2.5}
                dot={false}
                activeDot={{ r: 4, fill: 'var(--harvest-600)' }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  )
}
