'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, Truck } from 'lucide-react'
import { cn } from '@/lib/cn'
import { ShipmentRow, type ShipmentRowProps } from '@/components/field/ShipmentRow'
import { rowStatusKey, sortIdsByStatus, type RowStatusKey } from '@/lib/field/shipment-sort'

/**
 * 品目グループ内の出荷行を束ねる（client・Issue#5）。
 *  - 並び: 未着手 → 中断（作業中） → 梱包完了 → 出荷済み（各行の確定通知で並べ替え）
 *  - 行側の「元に戻す」猶予（約5秒）が過ぎてから onStatusSettled が来るので、
 *    タップ直後にカードが飛んで行かない（誤タップ対策とセット）
 *  - 出荷済みは折りたたみに収納（当日分のみ。画面が完了済みで埋まらないようにする）
 */
export function ShipmentGroupRows({ rows }: { rows: ShipmentRowProps[] }) {
  const byId = useMemo(() => new Map(rows.map((r) => [r.itemId, r])), [rows])

  const initialStatusOf = useCallback(
    (r: ShipmentRowProps): RowStatusKey =>
      rowStatusKey(
        r.initialStatus,
        r.initialShippedQty != null && r.initialShippedQty < r.orderedQty ? r.initialShippedQty : null,
        r.orderedQty,
      ),
    [],
  )

  const [statusById, setStatusById] = useState<Map<string, RowStatusKey>>(
    () => new Map(rows.map((r) => [r.itemId, initialStatusOf(r)])),
  )
  const [order, setOrder] = useState<string[]>(() =>
    sortIdsByStatus(
      rows.map((r) => r.itemId),
      new Map(rows.map((r) => [r.itemId, initialStatusOf(r)])),
    ),
  )
  // 直近に並べ替えで動いた行（到着位置で軽く出現アニメーションを付ける）
  const [justMovedId, setJustMovedId] = useState<string | null>(null)
  const [showShipped, setShowShipped] = useState(false)

  // rows が増減（スマート追加・削除→router.refresh）したら order を同期する。
  // 既存の並び順は保ちつつ、増えた分をステータス順で差し込み、消えた分を除く。
  useEffect(() => {
    const ids = rows.map((r) => r.itemId)
    setStatusById((prev) => {
      const next = new Map(prev)
      for (const r of rows) if (!next.has(r.itemId)) next.set(r.itemId, initialStatusOf(r))
      for (const id of [...next.keys()]) if (!ids.includes(id)) next.delete(id)
      return next
    })
    setOrder((prev) => {
      const kept = prev.filter((id) => ids.includes(id))
      const added = ids.filter((id) => !prev.includes(id))
      if (kept.length === prev.length && added.length === 0) return prev // 変化なし
      return [...kept, ...added]
    })
  }, [rows, initialStatusOf])

  // 行のステータス確定（Undo猶予経過 or 戻す操作）→ 並べ替え
  const handleSettled = useCallback((id: string, status: RowStatusKey) => {
    setStatusById((prev) => {
      const next = new Map(prev)
      next.set(id, status)
      setOrder((ord) => sortIdsByStatus(ord, next))
      return next
    })
    setJustMovedId(id)
    window.setTimeout(() => setJustMovedId((cur) => (cur === id ? null : cur)), 600)
  }, [])

  // 削除されたら即座に並びから除く（router.refresh の前でも消える）。
  const handleDeleted = useCallback((id: string) => {
    setOrder((prev) => prev.filter((x) => x !== id))
  }, [])

  const activeIds = order.filter((id) => statusById.get(id) !== 'shipped')
  const shippedIds = order.filter((id) => statusById.get(id) === 'shipped')

  const renderRow = (id: string) => {
    const r = byId.get(id)
    if (!r) return null
    return (
      <div key={id} className={cn(justMovedId === id && 'animate-slide-up motion-reduce:animate-none')}>
        <ShipmentRow {...r} onStatusSettled={handleSettled} onDeleted={handleDeleted} />
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {activeIds.map(renderRow)}

      {/* 出荷済みは折りたたみへ（当日の完了分。既定は畳んで「やること」に集中させる） */}
      {shippedIds.length > 0 && (
        <div className="pt-1">
          <button
            type="button"
            onClick={() => setShowShipped((v) => !v)}
            aria-expanded={showShipped}
            className="flex h-11 w-full items-center justify-center gap-1.5 rounded border border-dashed border-line text-sm font-medium text-ink-soft hover:bg-bg-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-trust-100"
          >
            <Truck className="h-4 w-4" aria-hidden />
            出荷済み {shippedIds.length}件
            <ChevronDown className={cn('h-4 w-4 transition-transform', showShipped && 'rotate-180')} aria-hidden />
          </button>
          {showShipped && <div className="mt-2 space-y-2">{shippedIds.map(renderRow)}</div>}
        </div>
      )}
    </div>
  )
}
