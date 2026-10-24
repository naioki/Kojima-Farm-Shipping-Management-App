'use client'

import { useEffect, useState } from 'react'
import { ShipmentRow, type ShipmentRowProps } from '@/components/field/ShipmentRow'
import {
  HarvestPulseSummary,
  type ContainerBreakdownItem,
  type SpecBreakdownItem,
} from '@/components/field/HarvestPulseSummary'
import toast from 'react-hot-toast'
import type { FieldStatus } from '@/types/database'
import {
  comparePackItems,
  getPackGroupInfo,
  type PackSortMode,
} from '@/lib/field/shipment-sort'
import { cn } from '@/lib/cn'

export interface ShipmentItemData extends ShipmentRowProps {
  itemId: string
  orderedQty: number
  customerId?: string
  productId?: string
  dailyPackSortOrder?: number | null
  defaultPackSortOrder?: number | null
  shippingRouteName?: string | null
  departureTime?: string | null
}

export interface PackingAndShippingViewsProps {
  items: ShipmentItemData[]
  nextDayItems?: ShipmentItemData[]
  date: string
  isAdmin: boolean
  productName?: string
  productId?: string
  containerBreakdown?: ContainerBreakdownItem[]
  specBreakdown?: SpecBreakdownItem[]
  initialCarryover?: number
}

/**
 * 収穫・袋詰め（パック）専用の明細カード一覧ビュー。
 * - リアルタイム進捗メーター（目標・完成・残り・進捗％）を連動表示。
 * - クイック完成投入（＋10箱・＋5箱・−5箱・↩️戻す）で早い便順にワンタップ充当。
 * - 3つの並び替えモード（早い便順 / 出荷先順 / コンテナ順）をワンタップ切替（localStorage記憶）。
 * - スクロール追従ミニ進捗バーにより、縦スクロール時も現在作業日と進捗を常時把握（UI誤認防止）。
 * - 翌日出荷予定カードは下部に薄グレー背景＋明瞭なバッジで視覚的分離表示。
 */
export function PackingAndShippingViews({
  items: initialItems,
  nextDayItems: initialNextDayItems = [],
  date,
  isAdmin,
  productName,
  productId,
  containerBreakdown,
  specBreakdown,
  initialCarryover = 0,
}: PackingAndShippingViewsProps) {
  const [items, setItems] = useState<ShipmentItemData[]>(initialItems)
  const [nextItems, setNextItems] = useState<ShipmentItemData[]>(initialNextDayItems)
  const [busyReorder, setBusyReorder] = useState<boolean>(false)
  const [sortMode, setSortMode] = useState<PackSortMode>('time')
  const [isBusyQuickBatch, setIsBusyQuickBatch] = useState<boolean>(false)
  const [undoStack, setUndoStack] = useState<
    Array<Array<{ itemId: string; prevStatus: FieldStatus; prevVersion: number }>>
  >([])

  // サーバー側や親コンポーネント（日付変更・品目タブ切り替え）から届く最新の明細リストを同期
  useEffect(() => {
    setItems(initialItems)
  }, [initialItems])

  useEffect(() => {
    setNextItems(initialNextDayItems)
  }, [initialNextDayItems])

  // クライアント側で localStorage から記憶したソートモードを復元
  useEffect(() => {
    try {
      const saved = localStorage.getItem('kojima_pack_board_sort_mode') as PackSortMode | null
      if (saved === 'time' || saved === 'destination' || saved === 'container') {
        setSortMode(saved)
      }
    } catch {}
  }, [])

  const handleSortModeChange = (mode: PackSortMode) => {
    setSortMode(mode)
    try {
      localStorage.setItem('kojima_pack_board_sort_mode', mode)
    } catch {}
  }

  // 選択されたモードによるソート
  const sortedPackItems = [...items].sort((a, b) => comparePackItems(a, b, sortMode))

  // リアルタイム進捗計算（アイテム状態に直結）
  let totalPacks = 0
  let totalBoxes = 0
  let completedBoxes = 0
  let completedPacks = 0

  for (const it of items) {
    const perCase = it.masterPacksPerCase || 20
    const boxCount = Math.ceil(it.orderedQty / perCase)
    totalPacks += it.orderedQty
    totalBoxes += boxCount
    if (it.initialStatus === 'packed' || it.initialStatus === 'shipped') {
      completedBoxes += boxCount
      completedPacks += it.orderedQty
    }
  }

  const remainingBoxes = Math.max(0, totalBoxes - completedBoxes)
  const progressPct =
    totalBoxes > 0 ? Math.min(100, Math.round((completedBoxes / totalBoxes) * 100)) : 0

  // ステータス即時連動（カードタップ時に即座に親Stateを更新）
  const handleStatusChange = (itemId: string, newStatus: FieldStatus, newVersion: number) => {
    setItems((prev) =>
      prev.map((it) =>
        it.itemId === itemId ? { ...it, initialStatus: newStatus, initialVersion: newVersion } : it,
      ),
    )
  }

  // クイック完成投入（早い便順の未着手カードから自動で完了充当）
  const handleQuickBatch = async (deltaBoxes: number) => {
    if (isBusyQuickBatch) return

    if (deltaBoxes > 0) {
      // 未完了（not_started / interrupted）のカードをソート順の先頭から抽出
      const uncompleted = sortedPackItems.filter(
        (it) => it.initialStatus !== 'packed' && it.initialStatus !== 'shipped',
      )
      if (uncompleted.length === 0) {
        toast('すべてのカードが既にパック完了しています')
        return
      }

      const toUpdate: ShipmentItemData[] = []
      let accBoxes = 0
      for (const it of uncompleted) {
        toUpdate.push(it)
        const perCase = it.masterPacksPerCase || 20
        accBoxes += Math.ceil(it.orderedQty / perCase)
        if (accBoxes >= deltaBoxes) break
      }

      const undoSnapshot = toUpdate.map((it) => ({
        itemId: it.itemId,
        prevStatus: it.initialStatus,
        prevVersion: it.initialVersion,
      }))
      setUndoStack((prev) => [...prev, undoSnapshot])

      // 楽観的UI即時更新
      const updateIds = new Set(toUpdate.map((u) => u.itemId))
      setItems((prev) =>
        prev.map((it) =>
          updateIds.has(it.itemId) ? { ...it, initialStatus: 'packed' as FieldStatus } : it,
        ),
      )

      setIsBusyQuickBatch(true)
      try {
        await Promise.all(
          toUpdate.map((it) =>
            fetch(`/api/order-items/${it.itemId}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ field_status: 'packed', version: it.initialVersion }),
            }),
          ),
        )
        toast.success(`＋${accBoxes}箱（${toUpdate.length}件）をパック完了にしました`)
      } catch {
        toast.error('一部の記録保存に失敗しました')
      } finally {
        setIsBusyQuickBatch(false)
      }
    } else {
      // deltaBoxes < 0: 完了済みのカードをソート順の末尾から未着手に戻す
      const completed = [...sortedPackItems]
        .reverse()
        .filter((it) => it.initialStatus === 'packed')
      if (completed.length === 0) {
        toast('戻せるパック済みカードがありません')
        return
      }

      const toRevert: ShipmentItemData[] = []
      let accBoxes = 0
      const targetBoxes = Math.abs(deltaBoxes)
      for (const it of completed) {
        toRevert.push(it)
        const perCase = it.masterPacksPerCase || 20
        accBoxes += Math.ceil(it.orderedQty / perCase)
        if (accBoxes >= targetBoxes) break
      }

      const undoSnapshot = toRevert.map((it) => ({
        itemId: it.itemId,
        prevStatus: it.initialStatus,
        prevVersion: it.initialVersion,
      }))
      setUndoStack((prev) => [...prev, undoSnapshot])

      // 楽観的UI即時更新
      const revertIds = new Set(toRevert.map((u) => u.itemId))
      setItems((prev) =>
        prev.map((it) =>
          revertIds.has(it.itemId) ? { ...it, initialStatus: 'not_started' as FieldStatus } : it,
        ),
      )

      setIsBusyQuickBatch(true)
      try {
        await Promise.all(
          toRevert.map((it) =>
            fetch(`/api/order-items/${it.itemId}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ field_status: 'not_started', version: it.initialVersion }),
            }),
          ),
        )
        toast(`−${accBoxes}箱（${toRevert.length}件）を未着手に戻しました`)
      } catch {
        toast.error('一部の記録保存に失敗しました')
      } finally {
        setIsBusyQuickBatch(false)
      }
    }
  }

  // 直前のクイック変更を取り消す（Undo）
  const handleUndoQuickBatch = async () => {
    if (isBusyQuickBatch || undoStack.length === 0) return
    const lastAction = undoStack[undoStack.length - 1]!
    setUndoStack((prev) => prev.slice(0, -1))

    const restoreMap = new Map(lastAction.map((a) => [a.itemId, a.prevStatus]))
    setItems((prev) =>
      prev.map((it) =>
        restoreMap.has(it.itemId) ? { ...it, initialStatus: restoreMap.get(it.itemId)! } : it,
      ),
    )

    setIsBusyQuickBatch(true)
    try {
      await Promise.all(
        lastAction.map((a) =>
          fetch(`/api/order-items/${a.itemId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ field_status: a.prevStatus, version: a.prevVersion }),
          }),
        ),
      )
      toast('直前のクイック変更を取り消しました')
    } catch {
      toast.error('一部の取り消し保存に失敗しました')
    } finally {
      setIsBusyQuickBatch(false)
    }
  }

  // 管理者による上下移動（パック作業順）
  const handleMove = async (index: number, direction: 'up' | 'down') => {
    if (!isAdmin || busyReorder) return
    const targetIndex = direction === 'up' ? index - 1 : index + 1
    if (targetIndex < 0 || targetIndex >= sortedPackItems.length) return

    const prevSortMap = new Map(items.map((it) => [it.itemId, it.dailyPackSortOrder]))
    const newSorted = [...sortedPackItems]
    const temp = newSorted[index]!
    newSorted[index] = newSorted[targetIndex]!
    newSorted[targetIndex] = temp

    const updates = newSorted.map((it, idx) => ({
      id: it.itemId,
      sortOrder: (idx + 1) * 10,
    }))

    const updatedMap = new Map(updates.map((u) => [u.id, u.sortOrder]))
    setItems((prev) =>
      prev.map((it) => ({
        ...it,
        dailyPackSortOrder: updatedMap.get(it.itemId) ?? it.dailyPackSortOrder,
      })),
    )

    setBusyReorder(true)
    try {
      const res = await fetch('/api/order-items/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: updates }),
      })
      if (!res.ok) throw new Error('並び順の保存に失敗しました')
      toast.success('パック作業順を更新しました')
    } catch {
      toast.error('並び替えに失敗しました')
      setItems((prev) =>
        prev.map((it) => ({
          ...it,
          dailyPackSortOrder: prevSortMap.get(it.itemId) ?? it.dailyPackSortOrder,
        })),
      )
    } finally {
      setBusyReorder(false)
    }
  }

  return (
    <div className="space-y-3.5">
      {/* スクロール追従ミニ進捗バー（画面最上部に常時固定してUI誤認を完全防止） */}
      <div className="sticky top-0 z-20 -mx-1 px-3 py-2 bg-slate-900/90 text-white backdrop-blur shadow-md flex items-center justify-between text-xs font-bold rounded-b-xl border-b border-slate-700">
        <div className="flex items-center gap-1.5 truncate">
          <span className="text-emerald-400">🔨</span>
          <span className="text-white font-black">{productName || '品目'}</span>
          <span className="text-slate-300">({date} 出荷分)</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-emerald-300 font-black">
            {completedBoxes}/{totalBoxes} 箱
          </span>
          <span className="text-[11px] text-slate-300 font-medium">({progressPct}%)</span>
          <span className="rounded bg-emerald-600/90 px-1.5 py-0.5 text-[10px] text-white font-bold">
            あと {remainingBoxes}箱
          </span>
        </div>
      </div>

      {/* リアルタイム進捗メーター ＆ クイック完成投入 ＆ 内訳アコーディオン */}
      {productName && productId && (
        <HarvestPulseSummary
          productName={productName}
          productId={productId}
          date={date}
          totalPacks={totalPacks}
          totalBoxes={totalBoxes}
          completedBoxes={completedBoxes}
          completedPacks={completedPacks}
          containerBreakdown={containerBreakdown ?? []}
          specBreakdown={specBreakdown ?? []}
          initialCarryover={initialCarryover}
          onQuickBatch={handleQuickBatch}
          onUndoQuickBatch={handleUndoQuickBatch}
          canUndoQuickBatch={undoStack.length > 0}
          isBusyQuickBatch={isBusyQuickBatch}
        />
      )}

      {/* 作業順ヘッダー案内 ＆ 3モード切替ボタングループ */}
      <div className="space-y-2 pt-1">
        <div className="flex items-center justify-between px-1">
          <span className="text-sm font-bold text-ink">
            📋 作業順（{isAdmin ? '▲▼で並び替え可能' : '上から順番にパック'}）
          </span>
          <span className="text-sm font-bold text-ink-soft">全 {sortedPackItems.length} 件</span>
        </div>

        {/* 現場用ワンタップ切替スイッチ */}
        <div className="flex items-center gap-1.5 p-1 rounded-xl bg-slate-100 border border-line-soft">
          <button
            type="button"
            onClick={() => handleSortModeChange('time')}
            className={cn(
              'flex-1 py-1.5 px-2 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1',
              sortMode === 'time'
                ? 'bg-white text-emerald-800 shadow-xs ring-1 ring-emerald-600/20'
                : 'text-ink-muted hover:text-ink',
            )}
          >
            <span>⏰</span>
            <span>早い便順</span>
          </button>
          <button
            type="button"
            onClick={() => handleSortModeChange('destination')}
            className={cn(
              'flex-1 py-1.5 px-2 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1',
              sortMode === 'destination'
                ? 'bg-white text-emerald-800 shadow-xs ring-1 ring-emerald-600/20'
                : 'text-ink-muted hover:text-ink',
            )}
          >
            <span>🏢</span>
            <span>出荷先順</span>
          </button>
          <button
            type="button"
            onClick={() => handleSortModeChange('container')}
            className={cn(
              'flex-1 py-1.5 px-2 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1',
              sortMode === 'container'
                ? 'bg-white text-emerald-800 shadow-xs ring-1 ring-emerald-600/20'
                : 'text-ink-muted hover:text-ink',
            )}
          >
            <span>📦</span>
            <span>コンテナ順</span>
          </button>
        </div>
      </div>

      {/* 当日出荷分のパック作業カード一覧（グループ境界ヘッダー付き） */}
      <div className="space-y-3">
        {sortedPackItems.map((item, idx) => {
          const groupInfo = getPackGroupInfo(item, sortMode)
          const prevGroupInfo = idx > 0 ? getPackGroupInfo(sortedPackItems[idx - 1]!, sortMode) : null
          const isNewSection = idx === 0 || groupInfo.groupKey !== prevGroupInfo?.groupKey

          return (
            <div key={item.itemId} className="space-y-2">
              {isNewSection && (
                <div className="flex flex-wrap items-center justify-between gap-1.5 pt-2.5 pb-1 px-1 border-b-2 border-line-soft">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-xs">{groupInfo.icon}</span>
                    <span className="text-xs font-black text-ink">{groupInfo.title}</span>
                    {groupInfo.badge && (
                      <span className="rounded bg-sky-100 text-sky-800 px-1.5 py-0.2 text-[10px] font-bold">
                        {groupInfo.badge}
                      </span>
                    )}
                    {groupInfo.subtitle && (
                      <span className="text-[11px] font-bold text-ink-muted">
                        {groupInfo.subtitle}
                      </span>
                    )}
                  </div>
                  {sortMode === 'time' && (
                    <div className="flex items-center gap-1 text-[11px] font-bold text-ink-muted">
                      <span>納品先別まとめ</span>
                    </div>
                  )}
                  {sortMode === 'destination' && (
                    <div className="flex items-center gap-1 shrink-0 text-[11px] font-bold text-ink-muted">
                      <span>{item.initialContainer || 'コンテナ'}</span>
                      {item.masterPacksPerCase && <span>({item.masterPacksPerCase}入)</span>}
                    </div>
                  )}
                  {sortMode === 'container' && (
                    <div className="flex items-center gap-1 shrink-0 text-[11px] font-bold text-ink-muted">
                      <span>納品先順</span>
                    </div>
                  )}
                </div>
              )}
              <ShipmentRow
                {...item}
                deliveryDate={date}
                isAdmin={isAdmin}
                onMoveUp={isAdmin && !busyReorder && idx > 0 ? () => handleMove(idx, 'up') : undefined}
                onMoveDown={
                  isAdmin && !busyReorder && idx < sortedPackItems.length - 1
                    ? () => handleMove(idx, 'down')
                    : undefined
                }
                onStatusChange={handleStatusChange}
              />
            </div>
          )
        })}
      </div>

      {/* 翌日出荷予定カード一覧（先行作業・閲覧用、薄グレー背景で視覚的分離） */}
      {nextItems.length > 0 && (
        <div className="pt-5 space-y-3">
          <div className="flex items-center justify-between rounded-xl bg-slate-200/90 px-3.5 py-2.5 text-xs font-black text-slate-700 border border-slate-300 shadow-xs">
            <div className="flex items-center gap-1.5">
              <span className="text-base">📅</span>
              <span>翌日出荷予定（先行作業・閲覧用）</span>
            </div>
            <span className="text-[11px] text-slate-600 font-bold">全 {nextItems.length} 件</span>
          </div>
          <p className="px-1 text-[11px] text-slate-500 font-medium">
            ※ 翌日分の先行パック作業または確認用です。本日の進捗（目標・完成）には含まれません。
          </p>
          <div className="space-y-3">
            {nextItems.map((item) => (
              <ShipmentRow
                key={`next-${item.itemId}`}
                {...item}
                isNextDay={true}
                deliveryDate={item.deliveryDate}
                isAdmin={isAdmin}
                onStatusChange={(id, newStatus, newVer) => {
                  setNextItems((prev) =>
                    prev.map((it) =>
                      it.itemId === id
                        ? { ...it, initialStatus: newStatus, initialVersion: newVer }
                        : it,
                    ),
                  )
                }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
