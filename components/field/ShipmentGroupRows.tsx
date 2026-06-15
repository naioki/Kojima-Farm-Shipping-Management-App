'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ShipmentRow, type ShipmentRowProps } from '@/components/field/ShipmentRow'

/** 出荷済みになった行を末尾へ送るまでの待ち時間（ms）。
 *  4秒：✓→🚚 の変化を見て確認でき、かつ「やること」リストが素早く片付く最適点。
 *  （短すぎると並べ替えが唐突、長すぎると完了済みが上に居座る）。 */
const SHIPPED_SINK_DELAY_MS = 4000

/**
 * 品目グループ内の出荷行を束ね、出荷済みになった行を一定時間後に末尾へ並べ替える（client）。
 * 現場が「これからやること」を常に上に見られるようにする。待ち時間は最適化した固定値。
 */
export function ShipmentGroupRows({ rows }: { rows: ShipmentRowProps[] }) {
  const byId = useMemo(() => new Map(rows.map((r) => [r.itemId, r])), [rows])
  const [order, setOrder] = useState<string[]>(() => rows.map((r) => r.itemId))

  // rows が増減（スマート追加・削除→router.refresh）したら order を同期する。
  // 既存の並び順は保ちつつ、増えた分を末尾に足し、消えた分を除く。
  useEffect(() => {
    const ids = rows.map((r) => r.itemId)
    setOrder((prev) => {
      const kept = prev.filter((id) => ids.includes(id))
      const added = ids.filter((id) => !prev.includes(id))
      if (kept.length === prev.length && added.length === 0) return prev // 変化なし
      return [...kept, ...added]
    })
  }, [rows])

  const handleShipped = useCallback((id: string) => {
    window.setTimeout(() => {
      setOrder((prev) => {
        // 既に末尾、または対象が消えていれば何もしない
        if (prev[prev.length - 1] === id || !prev.includes(id)) return prev
        return [...prev.filter((x) => x !== id), id]
      })
    }, SHIPPED_SINK_DELAY_MS)
  }, [])

  // 削除されたら即座に並びから除く（router.refresh の前でも消える）。
  const handleDeleted = useCallback((id: string) => {
    setOrder((prev) => prev.filter((x) => x !== id))
  }, [])

  return (
    <div className="space-y-2">
      {order.map((id) => {
        const r = byId.get(id)
        if (!r) return null
        return <ShipmentRow key={id} {...r} onShipped={handleShipped} onDeleted={handleDeleted} />
      })}
    </div>
  )
}
