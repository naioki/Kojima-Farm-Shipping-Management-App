'use client'

import { useEffect, useState, useRef } from 'react'
import { ArrowUpToLine, ChevronUp, ChevronDown, SlidersHorizontal, X } from 'lucide-react'
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
import { jstTodayStr, shiftDateStr } from '@/lib/dates'

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
  isTodayTarget?: boolean
}

/**
 * 収穫・袋詰め（パック）専用の明細カード一覧ビュー。
 * - リアルタイム進捗メーター（目標・完成・残り・進捗％）を連動表示。
 * - 3つの並び替えモード（早い便順 / 出荷先順 / コンテナ順）をワンタップ切替（localStorage記憶）。
 * - スクロール追従ミニ進捗バーにより、縦スクロール時も現在作業日と進捗を常時把握。
 * - 翌日出荷予定カードは下部に薄グレー背景＋チャコール総パック数で視覚的分離表示。
 * - 翌日枠へスクロールすると、上部追従バーの色・内容がチャコール（翌日先行表示中）へ即座に連動。
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
  isTodayTarget = true,
}: PackingAndShippingViewsProps) {
  const [items, setItems] = useState<ShipmentItemData[]>(initialItems)
  const [nextItems, setNextItems] = useState<ShipmentItemData[]>(initialNextDayItems)
  const [busyReorder, setBusyReorder] = useState<boolean>(false)
  const [sortMode, setSortMode] = useState<PackSortMode>('time')
  const [filterMode, setFilterMode] = useState<'all' | 'incomplete'>('all')
  const [isReorderModalOpen, setIsReorderModalOpen] = useState<boolean>(false)
  const [isViewingNextDay, setIsViewingNextDay] = useState(false)
  const nextSectionRef = useRef<HTMLDivElement | null>(null)

  const isTodayWork = isTodayTarget && (date === shiftDateStr(jstTodayStr(), 1) || date === jstTodayStr())

  // サーバー側や親コンポーネント（日付変更・品目タブ切り替え）から届く最新の明細リストを同期
  useEffect(() => {
    setItems(initialItems)
  }, [initialItems])

  useEffect(() => {
    setNextItems(initialNextDayItems)
  }, [initialNextDayItems])

  // 翌日エリアへのスクロール連動（翌日枠が画面上部に達したらヘッダー色・表記を切り替える）
  useEffect(() => {
    if (!nextSectionRef.current || nextItems.length === 0) {
      setIsViewingNextDay(false)
      return
    }
    const checkScrollPosition = () => {
      if (!nextSectionRef.current) return
      const rect = nextSectionRef.current.getBoundingClientRect()
      // 上部固定バー(約50px)直下に翌日見出しが到達したか
      setIsViewingNextDay(rect.top <= 90)
    }

    window.addEventListener('scroll', checkScrollPosition, { passive: true })
    checkScrollPosition()
    return () => window.removeEventListener('scroll', checkScrollPosition)
  }, [nextItems.length])

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

  // リアルタイム進捗計算（アイテム状態 ＋ 途中数に直結）＆ コンテナ・規格内訳のライブ集計
  let totalPacks = 0
  let totalBoxes = 0
  let completedBoxes = 0
  let completedPacks = 0
  const liveContainerMap = new Map<string, number>()
  const liveSpecMap = new Map<string, { packs: number; boxes: number }>()

  for (const it of items) {
    const perCase = it.masterPacksPerCase || 20
    const boxCount = Math.ceil(it.orderedQty / perCase)
    totalPacks += it.orderedQty
    totalBoxes += boxCount
    if (it.initialStatus === 'packed' || it.initialStatus === 'shipped') {
      completedBoxes += boxCount
      completedPacks += it.orderedQty
    } else {
      // 途中数（できた数）が入力されている場合は、端数も完成実績として即時算入
      const partialPacks = Math.max(0, Math.min(it.orderedQty, it.initialShippedQty ?? 0))
      if (partialPacks > 0) {
        completedPacks += partialPacks
        completedBoxes += Math.round(partialPacks / perCase)
      }
    }

    const cType = it.initialContainer || '通常コンテナ'
    liveContainerMap.set(cType, (liveContainerMap.get(cType) ?? 0) + boxCount)

    const sKey = it.initialSpec || it.masterLabelSpec || '標準規格'
    const curSpec = liveSpecMap.get(sKey) ?? { packs: 0, boxes: 0 }
    curSpec.packs += it.orderedQty
    curSpec.boxes += boxCount
    liveSpecMap.set(sKey, curSpec)
  }

  const liveContainerBreakdown: ContainerBreakdownItem[] =
    items.length > 0
      ? Array.from(liveContainerMap.entries()).map(([type, boxes]) => ({ type, boxes }))
      : (containerBreakdown ?? [])

  const liveSpecBreakdown: SpecBreakdownItem[] =
    items.length > 0
      ? Array.from(liveSpecMap.entries()).map(([spec, d]) => ({ spec, packs: d.packs, boxes: d.boxes }))
      : (specBreakdown ?? [])

  completedBoxes = Math.min(totalBoxes, completedBoxes)
  const remainingPacks = Math.max(0, totalPacks - completedPacks)
  const remainingBoxes = Math.max(0, totalBoxes - completedBoxes)
  const progressPct =
    totalPacks > 0 ? Math.min(100, Math.round((completedPacks / totalPacks) * 100)) : 0

  const incompleteCount = sortedPackItems.filter(
    (it) => it.initialStatus !== 'packed' && it.initialStatus !== 'shipped',
  ).length
  const visiblePackItems =
    filterMode === 'incomplete'
      ? sortedPackItems.filter((it) => it.initialStatus !== 'packed' && it.initialStatus !== 'shipped')
      : sortedPackItems

  // ステータス即時連動（カードタップ時に即座に親Stateを更新）
  const handleStatusChange = (itemId: string, newStatus: FieldStatus, newVersion: number) => {
    setItems((prev) =>
      prev.map((it) =>
        it.itemId === itemId ? { ...it, initialStatus: newStatus, initialVersion: newVersion } : it,
      ),
    )
  }

  // 途中数即時連動（できた数入力時に即座に上のメーターへ反映）
  const handleShippedQtyChange = (itemId: string, newQty: number | null) => {
    setItems((prev) =>
      prev.map((it) => (it.itemId === itemId ? { ...it, initialShippedQty: newQty } : it)),
    )
  }

  // 削除即時連動（カード削除時に即座にリストと進捗メーターから除外）
  const handleDeleted = (itemId: string) => {
    setItems((prev) => prev.filter((it) => it.itemId !== itemId))
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

  // 最上段（最優先）へ一発移動
  const handleMoveToTop = async (index: number) => {
    if (!isAdmin || busyReorder || index === 0) return
    const prevSortMap = new Map(items.map((it) => [it.itemId, it.dailyPackSortOrder]))
    const newSorted = [...sortedPackItems]
    const [moved] = newSorted.splice(index, 1)
    if (!moved) return
    newSorted.unshift(moved)

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
      toast.success(`「${moved.destinationName || moved.customerName}」を最上段（最優先）に移動しました`)
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
      {/* スクロール追従ミニ進捗バー（画面最上部に常時固定・翌日エリアに入ると自動でチャコール＆翌日表記へ切り替え） */}
      <div
        className={cn(
          'sticky top-0 z-20 -mx-1 px-3 py-2 text-white backdrop-blur shadow-md flex items-center justify-between text-xs font-bold rounded-b-xl border-b transition-colors duration-200',
          isViewingNextDay
            ? 'bg-[#0f172a]/95 border-slate-600 shadow-lg text-slate-100'
            : isTodayWork
            ? 'bg-slate-900/90 border-slate-700'
            : 'bg-[#1e293b]/95 border-slate-600',
        )}
      >
        {isViewingNextDay ? (
          <>
            <div className="flex items-center gap-1.5 truncate">
              <span className="text-amber-400">📅</span>
              <span className="text-white font-black">{productName || '品目'}</span>
              <span className="rounded bg-slate-700 border border-slate-500 px-2 py-0.5 text-[10px] text-slate-100 font-black shadow-xs">
                翌日先行分を表示中
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-slate-300 font-bold">
                翌日分: 全 {nextItems.length} 件
              </span>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-1.5 truncate">
              <span className="text-emerald-400">🥬</span>
              <span className="text-white font-black">{productName || '品目'}</span>
              <span className="text-slate-300">
                ({date === shiftDateStr(jstTodayStr(), 1) ? '明日出荷・本日パック' : `${date}出荷`})
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-emerald-300 font-black tabular-nums">
                {completedPacks}/{totalPacks} P
              </span>
              <span className="text-[11px] text-slate-300 font-medium">({progressPct}%)</span>
              <span
                className="rounded bg-emerald-600/90 px-1.5 py-0.5 text-[10px] text-white font-bold"
                title={`残り約${remainingBoxes}箱`}
              >
                あと {remainingPacks}P (約{remainingBoxes}箱)
              </span>
            </div>
          </>
        )}
      </div>

      {/* リアルタイム進捗メーター ＆ 内訳アコーディオン */}
      {productName && productId && (
        <HarvestPulseSummary
          productName={productName}
          productId={productId}
          date={date}
          totalPacks={totalPacks}
          totalBoxes={totalBoxes}
          completedBoxes={completedBoxes}
          completedPacks={completedPacks}
          containerBreakdown={liveContainerBreakdown}
          specBreakdown={liveSpecBreakdown}
          initialCarryover={initialCarryover}
          isTodayTarget={isTodayWork}
        />
      )}

      {/* 作業順ヘッダー案内 ＆ 3モード切替ボタングループ */}
      <div className="space-y-2 pt-1">
        <div className="flex flex-wrap items-center justify-between gap-2 px-1">
          <span className="text-sm font-bold text-ink flex items-center gap-1.5">
            <span>📋 作業順</span>
            <span className="text-xs text-emerald-800 bg-emerald-100 font-extrabold px-2 py-0.5 rounded-md">
              {sortMode === 'time' ? '⏰ 早い便順' : sortMode === 'destination' ? '🏢 出荷先順' : '📦 コンテナ順'}
            </span>
          </span>
          <div className="flex items-center gap-1.5">
            {/* ワンタップ絞り込み（すべて / 未完了のみ） */}
            <div className="inline-flex items-center rounded-lg bg-slate-100 p-0.5 border border-line text-xs font-bold">
              <button
                type="button"
                onClick={() => setFilterMode('all')}
                className={cn(
                  'px-2 py-1 rounded-md transition',
                  filterMode === 'all'
                    ? 'bg-white text-ink shadow-2xs'
                    : 'text-ink-muted hover:text-ink',
                )}
              >
                すべて ({sortedPackItems.length})
              </button>
              <button
                type="button"
                onClick={() => setFilterMode('incomplete')}
                className={cn(
                  'px-2 py-1 rounded-md transition',
                  filterMode === 'incomplete'
                    ? 'bg-emerald-700 text-white shadow-2xs'
                    : 'text-ink-muted hover:text-ink',
                )}
              >
                未完了 ({incompleteCount})
              </button>
            </div>
            {isAdmin && (
              <button
                type="button"
                onClick={() => setIsReorderModalOpen(true)}
                className="inline-flex items-center gap-1 text-xs font-bold text-emerald-900 bg-emerald-50 border border-emerald-300 hover:bg-emerald-100 px-2 py-1 rounded-lg shadow-2xs transition active:scale-95"
              >
                <SlidersHorizontal className="h-3 w-3" />
                <span>並び替え</span>
              </button>
            )}
          </div>
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
      {visiblePackItems.length === 0 && filterMode === 'incomplete' && sortedPackItems.length > 0 ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-6 text-center space-y-2">
          <p className="text-base font-black text-emerald-900">
            🎉 この品目のパック作業はすべて完了しています！
          </p>
          <button
            type="button"
            onClick={() => setFilterMode('all')}
            className="inline-flex items-center rounded-lg bg-white border border-emerald-300 px-3 py-1.5 text-xs font-bold text-emerald-800 hover:bg-emerald-100 transition"
          >
            完了済みのカードを表示する
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {visiblePackItems.map((item, idx) => {
            const fullIdx = sortedPackItems.findIndex((s) => s.itemId === item.itemId)
            const groupInfo = getPackGroupInfo(item, sortMode)
            const prevGroupInfo = idx > 0 ? getPackGroupInfo(visiblePackItems[idx - 1]!, sortMode) : null
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
                  onMoveUp={
                    isAdmin && !busyReorder && fullIdx > 0
                      ? () => handleMove(fullIdx, 'up')
                      : undefined
                  }
                  onMoveDown={
                    isAdmin && !busyReorder && fullIdx >= 0 && fullIdx < sortedPackItems.length - 1
                      ? () => handleMove(fullIdx, 'down')
                      : undefined
                  }
                  onStatusChange={handleStatusChange}
                  onShippedQtyChange={handleShippedQtyChange}
                  onDeleted={handleDeleted}
                />
              </div>
            )
          })}
        </div>
      )}

      {/* 翌日出荷予定カード一覧（先行作業・閲覧用、薄グレー背景＋チャコール色で視覚的分離） */}
      {nextItems.length > 0 && (
        <div ref={nextSectionRef} className="pt-5 space-y-3">
          <div className="flex items-center justify-between rounded-xl bg-slate-200/90 px-3.5 py-2.5 text-xs font-black text-slate-700 border border-slate-300 shadow-xs">
            <div className="flex items-center gap-1.5">
              <span className="text-base">📅</span>
              <span>翌日作業予定（先行作業・確認用）</span>
            </div>
            <span className="text-[11px] text-slate-600 font-bold">全 {nextItems.length} 件</span>
          </div>
          <p className="px-1 text-[11px] text-slate-500 font-medium">
            ※ 翌日出荷分の先行作業または確認用です。本日の目標・完成には含まれません。
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
                onShippedQtyChange={(id, newQty) => {
                  setNextItems((prev) =>
                    prev.map((it) =>
                      it.itemId === id
                        ? { ...it, initialShippedQty: newQty }
                        : it,
                    ),
                  )
                }}
                onDeleted={(id) => {
                  setNextItems((prev) => prev.filter((it) => it.itemId !== id))
                }}
              />
            ))}
          </div>
        </div>
      )}

      {/* 📋 スマート並び替え・最優先指定モーダル */}
      {isReorderModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-xs p-0 sm:p-4">
          <div className="w-full max-w-lg rounded-t-3xl sm:rounded-2xl bg-white shadow-2xl flex flex-col max-h-[85vh] animate-in slide-in-from-bottom duration-200">
            {/* モーダルヘッダー */}
            <div className="flex items-center justify-between p-4 border-b border-line shrink-0">
              <div>
                <h3 className="text-base font-black text-ink flex items-center gap-1.5">
                  <SlidersHorizontal className="h-4 w-4 text-emerald-600" />
                  <span>パック作業順の並び替え</span>
                </h3>
                <p className="text-xs text-ink-muted mt-0.5">
                  急ぎの出荷カードを【🔝 最上段】で一発ピン留めできます。
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsReorderModalOpen(false)}
                className="p-1.5 rounded-full text-ink-muted hover:bg-bg-soft"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* モーダルリスト */}
            <div className="p-3 overflow-y-auto space-y-2 flex-1 divide-y divide-line/60">
              {sortedPackItems.map((it, idx) => {
                const perCase = it.masterPacksPerCase || 20
                const boxCount = Math.ceil(it.orderedQty / perCase)
                return (
                  <div key={it.itemId} className="pt-2 first:pt-0 flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="font-extrabold text-sm text-ink truncate">
                          {idx + 1}. {it.destinationName || it.customerName}
                        </span>
                        {it.departureTime && (
                          <span className="rounded bg-emerald-100 text-emerald-800 px-1.5 py-0.2 text-[10px] font-bold">
                            {it.departureTime}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-ink-muted flex items-center gap-2 mt-0.5">
                        <span>{it.customerName}</span>
                        <span>•</span>
                        <span className="font-bold text-ink">{it.orderedQty}P ({boxCount}箱)</span>
                        <span>•</span>
                        <span>{it.initialSpec || '標準'}</span>
                      </div>
                    </div>

                    {/* 操作ボタングループ */}
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        disabled={busyReorder || idx === 0}
                        onClick={() => handleMoveToTop(idx)}
                        className="h-8 px-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-30 text-white text-xs font-black flex items-center gap-1 shadow-2xs active:scale-95"
                        title="一番上（最優先）へ移動"
                      >
                        <ArrowUpToLine className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">最上段</span>
                      </button>
                      <button
                        type="button"
                        disabled={busyReorder || idx === 0}
                        onClick={() => handleMove(idx, 'up')}
                        className="h-8 w-8 rounded-lg border border-line bg-white hover:bg-bg-soft disabled:opacity-30 text-ink flex items-center justify-center font-bold"
                        title="1つ上へ"
                      >
                        <ChevronUp className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        disabled={busyReorder || idx === sortedPackItems.length - 1}
                        onClick={() => handleMove(idx, 'down')}
                        className="h-8 w-8 rounded-lg border border-line bg-white hover:bg-bg-soft disabled:opacity-30 text-ink flex items-center justify-center font-bold"
                        title="1つ下へ"
                      >
                        <ChevronDown className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* モーダルフッター */}
            <div className="p-3 border-t border-line shrink-0 bg-bg-soft/50">
              <button
                type="button"
                onClick={() => setIsReorderModalOpen(false)}
                className="w-full py-2.5 rounded-xl bg-forest-700 hover:bg-forest-800 text-white font-bold text-sm shadow-xs active:scale-[0.99]"
              >
                並び替えを完了する
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
