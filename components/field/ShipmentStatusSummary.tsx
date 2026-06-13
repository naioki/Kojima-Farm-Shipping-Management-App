import { Circle, Check, Truck, PauseCircle } from 'lucide-react'

/**
 * 出荷一覧 上部のステータスサマリー（Laravel版 画面2）。
 * その日の進捗を色分けで一瞬で把握させる。安全版タップループ（features.md §7）の
 * 未着手→梱包完了→出荷済 に、部分完了の「中断」（黄色）を独立バケツで加える。
 *   - 中断は「できた数 < 受注 かつ 未出荷」。梱包完了（全量）と二重計上しない。
 *
 * 色は Tailwind カスタムテーマトークンを literal で持つ（JIT が動的クラスを拾えないため・design.md）。
 */

export interface ShipmentStatusCounts {
  not_started: number
  interrupted: number
  packed: number
  shipped: number
}

type Key = keyof ShipmentStatusCounts

const ICONS: Record<Key, typeof Circle> = {
  not_started: Circle,
  interrupted: PauseCircle,
  packed: Check,
  shipped: Truck,
}

const CHIP: Record<Key, { wrap: string; dot: string; label: string }> = {
  not_started: { wrap: 'bg-bg-soft text-ink-soft', dot: 'text-line-strong', label: '未着手' },
  interrupted: { wrap: 'bg-warning-bg text-warning', dot: 'text-warning', label: '中断' },
  packed: { wrap: 'bg-trust-50 text-trust-700', dot: 'text-trust-500', label: '梱包完了' },
  shipped: { wrap: 'bg-harvest-50 text-harvest-700', dot: 'text-harvest-500', label: '出荷済' },
}

const ORDER: Key[] = ['not_started', 'interrupted', 'packed', 'shipped']

export function ShipmentStatusSummary({ counts }: { counts: ShipmentStatusCounts }) {
  const total = ORDER.reduce((s, k) => s + counts[k], 0)
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-ink-soft">
        合計 <span className="num font-bold text-ink">{total}</span> 件
      </span>
      {ORDER.map((key) => {
        const c = CHIP[key]
        const Icon = ICONS[key]
        return (
          <span
            key={key}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ${c.wrap}`}
          >
            <Icon className={`h-4 w-4 ${c.dot}`} aria-hidden />
            {c.label}
            <span className="num font-bold">{counts[key]}</span>
          </span>
        )
      })}
    </div>
  )
}
