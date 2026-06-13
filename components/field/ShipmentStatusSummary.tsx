import { Circle, Check, Truck } from 'lucide-react'
import type { FieldStatus } from '@/types/database'

/**
 * 出荷一覧 上部のステータスサマリー（Laravel版 画面2）。
 * その日の進捗を色分けで一瞬で把握させる。安全版タップループ（features.md §7）に合わせ
 * 3段階（未着手→梱包完了→出荷済）。Laravel版の5段階（準備中/一時中断を含む）とは異なる。
 *
 * 色は Tailwind カスタムテーマトークンを literal で持つ（JIT が動的クラスを拾えないため・design.md）。
 */

const ICONS = { not_started: Circle, packed: Check, shipped: Truck } as const

const CHIP: Record<FieldStatus, { wrap: string; dot: string; label: string }> = {
  not_started: { wrap: 'bg-bg-soft text-ink-soft', dot: 'text-line-strong', label: '未着手' },
  packed: { wrap: 'bg-trust-50 text-trust-700', dot: 'text-trust-500', label: '梱包完了' },
  shipped: { wrap: 'bg-harvest-50 text-harvest-700', dot: 'text-harvest-500', label: '出荷済' },
}

const ORDER: FieldStatus[] = ['not_started', 'packed', 'shipped']

export function ShipmentStatusSummary({ counts }: { counts: Record<FieldStatus, number> }) {
  const total = ORDER.reduce((s, k) => s + counts[k], 0)
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-ink-soft">
        合計 <span className="num font-bold text-ink">{total}</span> 件
      </span>
      {ORDER.map((status) => {
        const c = CHIP[status]
        const Icon = ICONS[status]
        return (
          <span
            key={status}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ${c.wrap}`}
          >
            <Icon className={`h-4 w-4 ${c.dot}`} aria-hidden />
            {c.label}
            <span className="num font-bold">{counts[status]}</span>
          </span>
        )
      })}
    </div>
  )
}
