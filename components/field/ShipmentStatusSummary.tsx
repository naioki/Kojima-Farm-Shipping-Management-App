import { Circle, Check, Truck, PauseCircle } from 'lucide-react'
import { FIELD_STATUS_STYLE } from '@/lib/field/status-style'
import type { RowStatusKey } from '@/lib/field/shipment-sort'

/**
 * 出荷一覧 上部のステータスサマリー（Laravel版 画面2）。
 * その日の進捗を色分けで一瞬で把握させる。安全版タップループ（features.md §7）の
 * 未着手→梱包完了→出荷済 に、部分完了の「中断」（黄色）を独立バケツで加える。
 *   - 中断は「できた数 < 受注 かつ 未出荷」。梱包完了（全量）と二重計上しない。
 *
 * 色・ラベルは lib/field/status-style.ts（単一の正）から取る。出荷一覧の行・
 * マトリックスのセルと必ず同じ色になるようにするため、ここでは定義しない。
 */

export interface ShipmentStatusCounts {
  not_started: number
  interrupted: number
  packed: number
  shipped: number
}

type Key = RowStatusKey

const ICONS: Record<Key, typeof Circle> = {
  not_started: Circle,
  interrupted: PauseCircle,
  packed: Check,
  shipped: Truck,
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
        const c = FIELD_STATUS_STYLE[key]
        const Icon = ICONS[key]
        return (
          <span
            key={key}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ${c.chip}`}
          >
            <Icon className={`h-4 w-4 ${c.chipIcon}`} aria-hidden />
            {c.label}
            <span className="num font-bold">{counts[key]}</span>
          </span>
        )
      })}
    </div>
  )
}
