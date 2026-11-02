'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowUpToLine, ChevronUp, ChevronDown, SlidersHorizontal, X, RotateCw, GripVertical } from 'lucide-react'
import { ShipmentRow, type ShipmentRowProps } from '@/components/field/ShipmentRow'
import { FieldLangSwitch } from '@/components/field/FieldLangSwitch'
import { useFieldLang } from '@/lib/field/lang-context'
import { getThaiContainer, getThaiDepartureTime } from '@/lib/field/thai-dict'
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
import { jstTodayStr, shiftDateStr, formatJpDateShort } from '@/lib/dates'

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
  prevCarryover?: number
  initialCarryover?: number
  isTodayTarget?: boolean
}

function isUserTypingInInput(): boolean {
  if (typeof document === 'undefined') return false
  const el = document.activeElement
  if (!el) return false
  const tag = el.tagName.toLowerCase()
  return tag === 'input' || tag === 'textarea' || tag === 'select' || (el as HTMLElement).isContentEditable
}

/**
 * 収穫・袋詰め（パック）専用の明細カード一覧ビュー。
 * - #07: NSK（24入）や小コン（30入）が混在する日でも、一律20割りで上書きせず各行の正確な箱数を合算。
 * - #11: 翌日作業予定（先行枠）バーに合計箱数・総パック数を明記。
 * - #52: 入力欄フォーカス中・並び替えモーダル展開中は30秒自動リフレッシュを一時停止してチラつきを防止。
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
  prevCarryover = 0,
  initialCarryover = 0,
  isTodayTarget = true,
}: PackingAndShippingViewsProps) {
  const router = useRouter()
  const [items, setItems] = useState<ShipmentItemData[]>(initialItems)
  const [nextItems, setNextItems] = useState<ShipmentItemData[]>(initialNextDayItems)
  const [busyReorder, setBusyReorder] = useState<boolean>(false)
  const [sortMode, setSortMode] = useState<PackSortMode>('time')
  const [filterMode, setFilterMode] = useState<'all' | 'incomplete'>('all')
  const [isReorderModalOpen, setIsReorderModalOpen] = useState<boolean>(false)
  const [isViewingNextDay, setIsViewingNextDay] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [nextDayExpanded, setNextDayExpanded] = useState(false)
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null)
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null)
  const nextSectionRef = useRef<HTMLDivElement | null>(null)
  const reorderListRef = useRef<HTMLDivElement | null>(null)

  const isTodayWork = isTodayTarget && (date === shiftDateStr(jstTodayStr(), 1) || date === jstTodayStr())
  const { isThaiMode } = useFieldLang()

  const handleRefresh = () => {
    setIsRefreshing(true)
    router.refresh()
    setTimeout(() => {
      setIsRefreshing(false)
      toast.success('最新データを取得しました', { id: 'pack-refresh' })
    }, 600)
  }

  const prevSnapshotRef = useRef<Map<string, number> | null>(null)
  useEffect(() => {
    const nextMap = new Map(initialItems.map((it) => [it.itemId, it.orderedQty]))
    if (prevSnapshotRef.current) {
      let addedCount = 0
      let changedCount = 0
      for (const it of initialItems) {
        const prevQty = prevSnapshotRef.current.get(it.itemId)
        if (prevQty === undefined) {
          addedCount++
        } else if (prevQty !== it.orderedQty) {
          changedCount++
        }
      }
      if (addedCount > 0 || changedCount > 0) {
        const parts: string[] = []
        if (addedCount > 0) parts.push(`新規 ${addedCount}件`)
        if (changedCount > 0) parts.push(`数量変更 ${changedCount}件`)
        toast(`🔔 注文データが更新されました（${parts.join('・')}）`, {
          id: 'live-order-update',
          duration: 6000,
        })
      }
    }
    prevSnapshotRef.current = nextMap
    setItems(initialItems)
  }, [initialItems])

  useEffect(() => {
    setNextItems(initialNextDayItems)
  }, [initialNextDayItems])

  // #52 スマート・ポーリング（入力中やモーダル操作中は自動更新をスキップ）
  useEffect(() => {
    const syncLatest = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      if (typeof navigator !== 'undefined' && !navigator.onLine) return
      if (isReorderModalOpen || isUserTypingInInput()) return
      router.refresh()
    }
    const intervalId = window.setInterval(syncLatest, 30_000)
    const onVisibility = () => {
      if (document.visibilityState === 'visible') syncLatest()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', syncLatest)
    return () => {
      window.clearInterval(intervalId)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', syncLatest)
    }
  }, [router, isReorderModalOpen])

  useEffect(() => {
    if (!nextSectionRef.current || nextItems.length === 0) {
      setIsViewingNextDay(false)
      return
    }
    const checkScrollPosition = () => {
      if (!nextSectionRef.current) return
      const rect = nextSectionRef.current.getBoundingClientRect()
      setIsViewingNextDay(rect.top <= 110)
    }

    window.addEventListener('scroll', checkScrollPosition, { passive: true })
    checkScrollPosition()
    return () => window.removeEventListener('scroll', checkScrollPosition)
  }, [nextItems.length])

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

  const sortedPackItems = [...items].sort((a, b) => comparePackItems(a, b, sortMode))

  // #07 各行の正確な入数（NSK=24入、小コン=30入、標準=20入等）に基づいて箱数を合算（一律20割りバグを解消）
  let totalPacks = 0
  let totalBoxes = 0
  let completedBoxes = 0
  let completedPacks = 0
  const liveContainerMap = new Map<string, number>()
  const liveSpecMap = new Map<string, { packs: number; boxes: number }>()

  for (const it of items) {
    const perCase = it.masterPacksPerCase && it.masterPacksPerCase > 0 ? it.masterPacksPerCase : 20
    const boxCount = Math.ceil(it.orderedQty / perCase)
    totalPacks += it.orderedQty
    totalBoxes += boxCount
    if (it.initialStatus === 'packed' || it.initialStatus === 'shipped') {
      completedBoxes += boxCount
      completedPacks += it.orderedQty
    } else {
      const partialPacks = Math.max(0, Math.min(it.orderedQty, it.initialShippedQty ?? 0))
      if (partialPacks > 0) {
        completedPacks += partialPacks
        completedBoxes += Math.floor(partialPacks / perCase)
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

  // #11 翌日先行枠の合計箱数・総パック数
  const nextDayTotalPacks = nextItems.reduce((acc, it) => acc + it.orderedQty, 0)
  const nextDayTotalBoxes = nextItems.reduce((acc, it) => {
    const perCase = it.masterPacksPerCase && it.masterPacksPerCase > 0 ? it.masterPacksPerCase : 20
    return acc + Math.ceil(it.orderedQty / perCase)
  }, 0)

  const liveContainerBreakdown: ContainerBreakdownItem[] =
    items.length > 0
      ? Array.from(liveContainerMap.entries()).map(([type, boxes]) => ({ type, boxes }))
      : (containerBreakdown ?? [])

  const liveSpecBreakdown: SpecBreakdownItem[] =
    items.length > 0
      ? Array.from(liveSpecMap.entries()).map(([spec, d]) => ({ spec, packs: d.packs, boxes: d.boxes }))
      : (specBreakdown ?? [])

  completedBoxes = Math.min(totalBoxes, completedBoxes)
  const remainingBoxes = Math.max(0, totalBoxes - completedBoxes)
  const _progressPct =
    totalPacks > 0 ? Math.min(100, Math.round((completedPacks / totalPacks) * 100)) : 0

  const incompleteCount = sortedPackItems.filter(
    (it) => it.initialStatus !== 'packed' && it.initialStatus !== 'shipped',
  ).length
  const visiblePackItems =
    filterMode === 'incomplete'
      ? sortedPackItems.filter((it) => it.initialStatus !== 'packed' && it.initialStatus !== 'shipped')
      : sortedPackItems

  const handleStatusChange = (itemId: string, newStatus: FieldStatus, newVersion: number) => {
    setItems((prev) =>
      prev.map((it) =>
        it.itemId === itemId ? { ...it, initialStatus: newStatus, initialVersion: newVersion } : it,
      ),
    )
  }

  const handleShippedQtyChange = (itemId: string, newQty: number | null) => {
    setItems((prev) =>
      prev.map((it) => (it.itemId === itemId ? { ...it, initialShippedQty: newQty } : it)),
    )
  }

  const handleOrderedQtyChange = (itemId: string, newOrderedQty: number) => {
    setItems((prev) =>
      prev.map((it) => (it.itemId === itemId ? { ...it, orderedQty: newOrderedQty } : it)),
    )
  }

  const handleDeleted = (itemId: string) => {
    setItems((prev) => prev.filter((it) => it.itemId !== itemId))
  }

  const handleDetailsChange = (
    itemId: string,
    newSpec: string | null,
    newContainer: string | null,
  ) => {
    setItems((prev) =>
      prev.map((it) =>
        it.itemId === itemId
          ? { ...it, initialSpec: newSpec, initialContainer: newContainer }
          : it,
      ),
    )
  }

  const handleMoveToIndex = async (fromIndex: number, toIndex: number, customToast?: string) => {
    if (busyReorder || fromIndex === toIndex) return
    if (fromIndex < 0 || fromIndex >= sortedPackItems.length) return
    if (toIndex < 0 || toIndex >= sortedPackItems.length) return

    const prevSortMap = new Map(items.map((it) => [it.itemId, it.dailyPackSortOrder]))
    const newSorted = [...sortedPackItems]
    const [moved] = newSorted.splice(fromIndex, 1)
    if (!moved) return
    newSorted.splice(toIndex, 0, moved)

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
      toast.success(
        customToast ||
          (isThaiMode ? 'เปลี่ยนลำดับเรียบร้อยแล้ว (並び順を更新しました)' : 'パック作業順を更新しました'),
        { id: 'reorder-toast' },
      )
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

  const handleMove = async (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1
    await handleMoveToIndex(index, targetIndex)
  }

  const handleMoveToTop = async (index: number) => {
    const moved = sortedPackItems[index]
    if (!moved) return
    await handleMoveToIndex(
      index,
      0,
      `🔥「${moved.destinationName || moved.customerName}」を最上段（最優先1枚目）に移動しました`,
    )
  }

  const handleResetOrder = async () => {
    if (busyReorder || items.length === 0) return
    const prevSortMap = new Map(items.map((it) => [it.itemId, it.dailyPackSortOrder]))
    const updates = items.map((it) => ({
      id: it.itemId,
      sortOrder: null as unknown as number,
    }))
    setItems((prev) => prev.map((it) => ({ ...it, dailyPackSortOrder: null })))
    setBusyReorder(true)
    try {
      await fetch('/api/order-items/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: updates }),
      })
      toast.success('自動の優先順に戻しました')
    } catch {
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
    <div className="space-y-3">
      {/* スクロール追従スリムバー（1行完結・ヘッダー重なり防止） */}
      <div
        className={cn(
          'sticky top-14 z-20 px-3 py-2 text-white shadow-md rounded-xl border transition-colors duration-200',
          isViewingNextDay
            ? 'bg-[#0f172a] border-slate-500 text-slate-100'
            : date === shiftDateStr(jstTodayStr(), 1)
            ? 'bg-[#0f2e1e] border-emerald-600/80'
            : date === jstTodayStr()
            ? 'bg-[#0c2e4e] border-sky-600/80'
            : 'bg-[#1e293b] border-slate-600',
        )}
      >
        <div className="flex items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-1.5 min-w-0">
            <span
              className={cn(
                'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-black shrink-0',
                isViewingNextDay
                  ? 'bg-slate-700 text-amber-300'
                  : date === shiftDateStr(jstTodayStr(), 1)
                  ? 'bg-emerald-400 text-emerald-950'
                  : date === jstTodayStr()
                  ? 'bg-sky-400 text-sky-950'
                  : 'bg-slate-700 text-slate-100',
              )}
            >
              {isViewingNextDay
                ? `翌々日 ${formatJpDateShort(shiftDateStr(date, 1))}`
                : `${formatJpDateShort(date)}納品`}
            </span>
            <span className="text-white font-black text-xs sm:text-sm truncate">
              {productName || '品目'}
            </span>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {isViewingNextDay ? (
              <span className="text-slate-200 font-black tabular-nums">
                翌日分 {nextDayTotalBoxes}箱
              </span>
            ) : (
              <span className="text-emerald-300 font-black tabular-nums text-xs sm:text-sm">
                {completedBoxes}/{totalBoxes}箱 <small className="text-white/80 font-bold">(残{remainingBoxes})</small>
              </span>
            )}
            <FieldLangSwitch />
            <button
              type="button"
              onClick={handleRefresh}
              disabled={isRefreshing}
              title="最新データを再取得"
              aria-label="最新データを再取得"
              className="flex items-center justify-center h-6 w-6 rounded-md bg-white/10 hover:bg-white/20 active:bg-white/30 text-white/90 border border-white/15 transition disabled:opacity-50"
            >
              <RotateCw className={cn('h-3.5 w-3.5', isRefreshing && 'animate-spin')} />
            </button>
          </div>
        </div>
      </div>

      {/* リアルタイム進捗コックピット ＆ 内訳アコーディオン */}
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
          prevCarryover={prevCarryover}
          initialCarryover={initialCarryover}
          isTodayTarget={isTodayWork}
        />
      )}

      {/* スリム統合コントロールバー */}
      <div className="flex flex-wrap items-center justify-between gap-1.5 pt-0.5">
        <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100 border border-line-soft flex-1 min-w-[230px]">
          <button
            type="button"
            onClick={() => handleSortModeChange('time')}
            className={cn(
              'flex-1 py-1.5 px-2 rounded-lg text-xs font-black transition flex items-center justify-center gap-1',
              sortMode === 'time'
                ? 'bg-white text-emerald-800 shadow-2xs ring-1 ring-emerald-600/20'
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
              'flex-1 py-1.5 px-2 rounded-lg text-xs font-black transition flex items-center justify-center gap-1',
              sortMode === 'destination'
                ? 'bg-white text-emerald-800 shadow-2xs ring-1 ring-emerald-600/20'
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
              'flex-1 py-1.5 px-2 rounded-lg text-xs font-black transition flex items-center justify-center gap-1',
              sortMode === 'container'
                ? 'bg-white text-emerald-800 shadow-2xs ring-1 ring-emerald-600/20'
                : 'text-ink-muted hover:text-ink',
            )}
          >
            <span>📦</span>
            <span>コンテナ順</span>
          </button>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <div className="inline-flex items-center rounded-xl bg-slate-100 p-1 border border-line text-xs font-bold">
            <button
              type="button"
              onClick={() => setFilterMode('all')}
              className={cn(
                'px-2 py-1 rounded-lg transition',
                filterMode === 'all'
                  ? 'bg-white text-ink shadow-2xs font-black'
                  : 'text-ink-muted hover:text-ink',
              )}
            >
              全 ({sortedPackItems.length})
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('incomplete')}
              className={cn(
                'px-2 py-1 rounded-lg transition',
                filterMode === 'incomplete'
                  ? 'bg-emerald-700 text-white shadow-2xs font-black'
                  : 'text-ink-muted hover:text-ink',
              )}
            >
              未完 ({incompleteCount})
            </button>
          </div>
          {sortedPackItems.length > 1 && (
            <button
              type="button"
              onClick={() => setIsReorderModalOpen(true)}
              className="inline-flex items-center gap-1 text-xs font-black text-emerald-900 bg-emerald-50 border border-emerald-300 hover:bg-emerald-100 px-2.5 py-2 rounded-xl shadow-2xs transition active:scale-95"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              <span>⇅ 並び替え</span>
            </button>
          )}
        </div>
      </div>

      {/* 当日出荷分のパック作業カード一覧 */}
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
        <div className="space-y-2.5">
          {visiblePackItems.map((item, idx) => {
            const fullIdx = sortedPackItems.findIndex((s) => s.itemId === item.itemId)
            const groupInfo = getPackGroupInfo(item, sortMode)
            const prevGroupInfo = idx > 0 ? getPackGroupInfo(visiblePackItems[idx - 1]!, sortMode) : null
            const isNewSection = idx === 0 || groupInfo.groupKey !== prevGroupInfo?.groupKey

            const firstIncompleteItemId = visiblePackItems.find(
              (it) => it.initialStatus !== 'packed' && it.initialStatus !== 'shipped',
            )?.itemId
            const isNextUp = item.itemId === firstIncompleteItemId

            const sectionItems = isNewSection
              ? visiblePackItems.filter((it) => getPackGroupInfo(it, sortMode).groupKey === groupInfo.groupKey)
              : []
            const sectionTotalPacks = sectionItems.reduce((acc, it) => acc + it.orderedQty, 0)
            const sectionRemBoxes = sectionItems.reduce((acc, it) => {
              if (it.initialStatus === 'packed' || it.initialStatus === 'shipped') return acc
              const perCase = it.masterPacksPerCase || 20
              return acc + Math.ceil(it.orderedQty / perCase)
            }, 0)

            return (
              <div key={item.itemId} className="space-y-1.5">
                {isNewSection && (
                  <div className="flex flex-wrap items-center justify-between gap-1.5 pt-2 pb-1 px-2.5 rounded-xl bg-slate-100/90 border border-line-soft">
                    <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                      <span className="text-xs sm:text-sm">{groupInfo.icon}</span>
                      <span className="text-xs sm:text-sm font-black text-ink">{groupInfo.title}</span>
                      {isThaiMode && sortMode === 'time' && getThaiDepartureTime(item.departureTime) && (
                        <span className="rounded bg-amber-100 text-amber-900 border border-amber-300 px-1.5 py-0.5 text-[11px] font-black print:hidden">
                          🇹🇭 {getThaiDepartureTime(item.departureTime)}
                        </span>
                      )}
                      {isThaiMode && sortMode === 'container' && getThaiContainer(item.initialContainer) && (
                        <span className="rounded bg-sky-100 text-sky-900 border border-sky-300 px-1.5 py-0.5 text-[11px] font-black print:hidden">
                          🇹🇭 {getThaiContainer(item.initialContainer)}
                        </span>
                      )}
                      {groupInfo.badge && (
                        <span className="rounded bg-sky-100 text-sky-800 px-1.5 py-0.5 text-[10px] font-bold">
                          {groupInfo.badge}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0 text-[11px] font-black">
                      {sectionRemBoxes > 0 ? (
                        <span className="rounded-md bg-white border border-line px-2 py-0.5 text-ink">
                          残り {sectionRemBoxes}箱 (計{sectionTotalPacks.toLocaleString()}P)
                        </span>
                      ) : (
                        <span className="rounded-md bg-emerald-600 text-white px-2 py-0.5">
                          ✓ 完了 (計{sectionTotalPacks.toLocaleString()}P)
                        </span>
                      )}
                    </div>
                  </div>
                )}
                <ShipmentRow
                  {...item}
                  isNextUp={isNextUp}
                  deliveryDate={date}
                  isAdmin={isAdmin}
                  onMoveToTop={
                    !busyReorder && fullIdx > 0
                      ? () => handleMoveToTop(fullIdx)
                      : undefined
                  }
                  onMoveUp={
                    !busyReorder && fullIdx > 0
                      ? () => handleMove(fullIdx, 'up')
                      : undefined
                  }
                  onMoveDown={
                    !busyReorder && fullIdx >= 0 && fullIdx < sortedPackItems.length - 1
                      ? () => handleMove(fullIdx, 'down')
                      : undefined
                  }
                  onStatusChange={handleStatusChange}
                  onShippedQtyChange={handleShippedQtyChange}
                  onOrderedQtyChange={handleOrderedQtyChange}
                  onDetailsChange={handleDetailsChange}
                  onDeleted={handleDeleted}
                />
              </div>
            )
          })}
        </div>
      )}

      {/* #11 翌日出荷予定カード一覧（合計箱数・総パック数をバー表面に明記） */}
      {nextItems.length > 0 && (
        <div ref={nextSectionRef} className="pt-3 space-y-2">
          <button
            type="button"
            onClick={() => setNextDayExpanded((prev) => !prev)}
            className="w-full flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-200/90 hover:bg-slate-300/80 px-3.5 py-2.5 text-xs font-black text-slate-800 border border-slate-300 shadow-2xs transition active:scale-[0.99]"
          >
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-base">📅</span>
              <span>翌日作業予定（先行枠：{nextItems.length}件）</span>
              <span className="rounded-md bg-slate-800 text-white px-2 py-0.5 text-[11px] font-black tabular-nums">
                計 {nextDayTotalBoxes}箱（{nextDayTotalPacks.toLocaleString()} P）
              </span>
            </div>
            <div className="flex items-center gap-1 text-[11px] text-slate-700 font-bold">
              <span>{nextDayExpanded || (incompleteCount === 0 && sortedPackItems.length > 0) ? '閉じる ▲' : '開く ▼'}</span>
            </div>
          </button>

          {(nextDayExpanded || (incompleteCount === 0 && sortedPackItems.length > 0)) && (
            <div className="space-y-2.5 pt-1">
              <p className="px-1 text-[11px] text-slate-500 font-medium">
                ※ 翌々日納品分の先行作業または確認用です。本日の目標・完成には含まれません。
              </p>
              <div className="space-y-2.5">
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
                    onOrderedQtyChange={(id, newOrdQty) => {
                      setNextItems((prev) =>
                        prev.map((it) =>
                          it.itemId === id
                            ? { ...it, orderedQty: newOrdQty }
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
        </div>
      )}

      {/* 📋 スマート並び替えモーダル */}
      {isReorderModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-xs p-0 sm:p-4">
          <div className="w-full max-w-lg rounded-t-3xl sm:rounded-2xl bg-white shadow-2xl flex flex-col max-h-[88vh] animate-in slide-in-from-bottom duration-200">
            <div className="flex items-center justify-between p-4 border-b border-line shrink-0">
              <div>
                <h3 className="text-base font-black text-ink flex items-center gap-1.5">
                  <SlidersHorizontal className="h-4 w-4 text-emerald-600" />
                  <span>パック作業順の並び替え</span>
                </h3>
                <p className="text-xs text-ink-muted mt-0.5">
                  左の「⠿」を指でドラッグして移動するか、【🔝 最上段】で一発優先指定できます。
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                {items.some((it) => it.dailyPackSortOrder != null) && (
                  <button
                    type="button"
                    disabled={busyReorder}
                    onClick={handleResetOrder}
                    className="rounded-lg border border-line bg-bg-soft hover:bg-slate-200 px-2.5 py-1 text-[11px] font-bold text-ink-soft transition"
                  >
                    自動順に戻す
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setIsReorderModalOpen(false)}
                  className="p-1.5 rounded-full text-ink-muted hover:bg-bg-soft"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div ref={reorderListRef} className="p-3 overflow-y-auto space-y-2 flex-1">
              {sortedPackItems.map((it, idx) => {
                const perCase = it.masterPacksPerCase || 20
                const boxCount = Math.ceil(it.orderedQty / perCase)
                const isDragging = draggingIdx === idx
                const isDragOver = dragOverIdx === idx && draggingIdx !== null && draggingIdx !== idx
                const isDoneItem = it.initialStatus === 'packed' || it.initialStatus === 'shipped'

                return (
                  <div
                    key={it.itemId}
                    data-reorder-idx={idx}
                    draggable={!busyReorder}
                    onDragStart={(e) => {
                      setDraggingIdx(idx)
                      setDragOverIdx(idx)
                      e.dataTransfer.effectAllowed = 'move'
                    }}
                    onDragOver={(e) => {
                      e.preventDefault()
                      if (dragOverIdx !== idx) setDragOverIdx(idx)
                    }}
                    onDrop={(e) => {
                      e.preventDefault()
                      if (draggingIdx !== null && draggingIdx !== idx) {
                        handleMoveToIndex(draggingIdx, idx)
                      }
                      setDraggingIdx(null)
                      setDragOverIdx(null)
                    }}
                    onDragEnd={() => {
                      setDraggingIdx(null)
                      setDragOverIdx(null)
                    }}
                    className={cn(
                      'rounded-xl border p-2.5 flex items-center justify-between gap-2 transition-all select-none',
                      isDragging
                        ? 'border-emerald-600 bg-emerald-50/90 shadow-lg scale-[1.02] opacity-90 z-10'
                        : isDragOver
                        ? 'border-2 border-dashed border-emerald-500 bg-emerald-50/40'
                        : idx === 0 && !isDoneItem
                        ? 'border-emerald-400 bg-emerald-50/30 shadow-2xs'
                        : isDoneItem
                        ? 'border-line bg-slate-50 opacity-65'
                        : 'border-line bg-white shadow-2xs',
                    )}
                  >
                    <div
                      className="flex items-center justify-center h-10 w-8 rounded-lg bg-slate-100 hover:bg-emerald-100 text-slate-500 hover:text-emerald-800 cursor-grab active:cursor-grabbing touch-none shrink-0"
                      title="ここを指でつかんで上下にドラッグ"
                      onPointerDown={(e) => {
                        if (busyReorder) return
                        e.currentTarget.setPointerCapture(e.pointerId)
                        setDraggingIdx(idx)
                        setDragOverIdx(idx)
                      }}
                      onPointerMove={(e) => {
                        if (draggingIdx === null) return
                        const el = document.elementFromPoint(e.clientX, e.clientY)
                        const rowEl = el?.closest('[data-reorder-idx]') as HTMLElement | null
                        if (rowEl) {
                          const over = Number(rowEl.getAttribute('data-reorder-idx'))
                          if (Number.isFinite(over) && over !== dragOverIdx) {
                            setDragOverIdx(over)
                          }
                        }
                      }}
                      onPointerUp={() => {
                        if (draggingIdx !== null && dragOverIdx !== null && draggingIdx !== dragOverIdx) {
                          handleMoveToIndex(draggingIdx, dragOverIdx)
                        }
                        setDraggingIdx(null)
                        setDragOverIdx(null)
                      }}
                      onPointerCancel={() => {
                        setDraggingIdx(null)
                        setDragOverIdx(null)
                      }}
                    >
                      <GripVertical className="h-5 w-5" />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span
                          className={cn(
                            'inline-flex items-center justify-center h-5 min-w-5 px-1 rounded text-[11px] font-black',
                            idx === 0 && !isDoneItem
                              ? 'bg-emerald-700 text-white'
                              : 'bg-slate-200 text-slate-700',
                          )}
                        >
                          {idx + 1}
                        </span>
                        <span className="font-extrabold text-sm text-ink truncate">
                          {it.destinationName && it.destinationName !== it.customerName
                            ? `${it.customerName} ▶ ${it.destinationName}`
                            : it.customerName}
                        </span>
                        {it.departureTime && (
                          <span className="rounded bg-emerald-100 text-emerald-800 px-1.5 py-0.2 text-[10px] font-bold">
                            {it.departureTime.startsWith('翌') ? `${it.departureTime}迄` : `当日${it.departureTime}迄`}
                          </span>
                        )}
                        {isDoneItem && (
                          <span className="rounded bg-emerald-600 text-white px-1.5 py-0.2 text-[10px] font-bold">
                            済
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-ink-muted flex items-center gap-2 mt-0.5">
                        <span className="font-black text-ink">{boxCount}箱 ({it.orderedQty}P)</span>
                        <span>•</span>
                        <span>{it.initialContainer || 'コンテナ'}</span>
                        <span>•</span>
                        <span className="truncate">{it.initialSpec || '標準'}</span>
                      </div>
                    </div>

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
                        className="h-8 w-8 rounded-lg border border-line bg-white hover:bg-bg-soft disabled:opacity-30 text-ink flex items-center justify-center font-bold active:scale-95"
                        title="1つ上へ"
                      >
                        <ChevronUp className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        disabled={busyReorder || idx === sortedPackItems.length - 1}
                        onClick={() => handleMove(idx, 'down')}
                        className="h-8 w-8 rounded-lg border border-line bg-white hover:bg-bg-soft disabled:opacity-30 text-ink flex items-center justify-center font-bold active:scale-95"
                        title="1つ下へ"
                      >
                        <ChevronDown className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>

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
