'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowUpToLine, ChevronUp, ChevronDown, SlidersHorizontal, X, GripVertical, RotateCw, FileDown } from 'lucide-react'
import { ShipmentRow, type ShipmentRowProps } from '@/components/field/ShipmentRow'
import { useFieldLang } from '@/lib/field/lang-context'
import { getThaiContainer, getThaiDepartureTime } from '@/lib/field/thai-dict'
import { isDriverDeliveryNoteCustomer, resolveDefaultIssuerPreset } from '@/lib/delivery-notes/driver-note'
import {
  HarvestPulseSummary,
  type ContainerBreakdownItem,
  type SpecBreakdownItem,
} from '@/components/field/HarvestPulseSummary'
import toast from 'react-hot-toast'
import type { FieldStatus } from '@/types/database'
import {
  comparePackItems,
  completedCaseCount,
  getPackGroupInfo,
  resolvePacksPerCase,
  type PackSortMode,
} from '@/lib/field/shipment-sort'
import { cn } from '@/lib/cn'
import { isSampleOrderText, isGenericOrInvalidContainer } from '@/lib/pipeline/schemas'
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

const EMPTY_NEXT_DAY_ITEMS: ShipmentItemData[] = []

/** カード（ShipmentRow）と同じ入数を使う */
function packsPerCaseOf(it: ShipmentItemData): number {
  return resolvePacksPerCase({
    customerName: it.customerName,
    spec: it.initialSpec,
    masterLabelSpec: it.masterLabelSpec,
    masterPacksPerCase: it.masterPacksPerCase,
  })
}

/**
 * 収穫・袋詰め（パック）専用の明細カード一覧ビュー（v5.1.10 重複完全排除版）。
 * - 【#01 解消】二重になっていた濃緑スティッキー進捗バーと HarvestPulseSummary を単一コックピットへ統合。
 * - 【#10 解消】「納入先順」ソート時に1件しかない出荷先の上へカード見出しと全く同じセクション見出しが出る重複を排除。
 * - 【#11 解消】途中数入力時の完了箱数・残り箱数の集計をカード側の計算と完全一致。
 */
export function PackingAndShippingViews({
  items: initialItems,
  nextDayItems: initialNextDayItems = EMPTY_NEXT_DAY_ITEMS,
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

  // スマート・ポーリング（入力中やモーダル操作中は自動更新をスキップ）
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

  // 上部進捗コックピット（目標箱数・完成箱数・残り箱数）は取引先別の個別入数にかかわらず一律「総パック数 ÷ 20」で算出
  // コンテナ別・規格別の内訳は各行の実入数（NSK=24入、オレンジファーム=25入、やなぎさわ=10入、標準=20入等）で算出
  let totalPacks = 0
  let completedPacks = 0
  const liveContainerMap = new Map<string, number>()
  const liveSpecMap = new Map<string, { packs: number; boxes: number }>()

  for (const it of items) {
    const perCase = packsPerCaseOf(it)
    const isSample = isSampleOrderText(it.destinationName, it.initialLineNote, it.initialFieldNote, it.initialSpec)
    const isSmallSample = isSample && it.orderedQty < perCase
    const boxCount = isSmallSample ? 0 : Math.ceil(it.orderedQty / perCase)
    totalPacks += it.orderedQty
    if (it.initialStatus === 'packed' || it.initialStatus === 'shipped') {
      completedPacks += it.orderedQty
    } else {
      const partialPacks = Math.max(0, Math.min(it.orderedQty, it.initialShippedQty ?? 0))
      if (partialPacks > 0) {
        completedPacks += partialPacks
      }
    }

    if (!isSmallSample && boxCount > 0) {
      const cType =
        it.initialContainer && !isGenericOrInvalidContainer(it.initialContainer)
          ? it.initialContainer
          : '青コン'
      liveContainerMap.set(cType, (liveContainerMap.get(cType) ?? 0) + boxCount)
    }

    const sKey = it.initialSpec || it.masterLabelSpec || '標準規格'
    const curSpec = liveSpecMap.get(sKey) ?? { packs: 0, boxes: 0 }
    curSpec.packs += it.orderedQty
    curSpec.boxes += boxCount
    liveSpecMap.set(sKey, curSpec)
  }

  // 完成箱数は「満杯になった箱」だけ数える（切り捨て）。カードの途中経過「1箱+5P完了」と同じ規則。
  // 残り箱数 = 目標 − 完成 =「まだ満杯になっていない箱」の数（青梗菜のニコイチ20入で一律）
  const totalBoxes = totalPacks > 0 ? Math.ceil(totalPacks / 20) : 0
  const completedBoxes = completedCaseCount(completedPacks, totalPacks, 20)
  const remainingBoxesTotal = Math.max(0, totalBoxes - completedBoxes)

  const nextDayTotalPacks = nextItems.reduce((acc, it) => acc + it.orderedQty, 0)
  const nextDayTotalBoxes = nextDayTotalPacks > 0 ? Math.ceil(nextDayTotalPacks / 20) : 0

  const liveContainerBreakdown: ContainerBreakdownItem[] =
    items.length > 0
      ? Array.from(liveContainerMap.entries()).map(([type, boxes]) => ({ type, boxes }))
      : (containerBreakdown ?? [])

  const liveSpecBreakdown: SpecBreakdownItem[] =
    items.length > 0
      ? Array.from(liveSpecMap.entries()).map(([spec, d]) => ({ spec, packs: d.packs, boxes: d.boxes }))
      : (specBreakdown ?? [])

  const incompleteCount = sortedPackItems.filter(
    (it) => it.initialStatus !== 'packed' && it.initialStatus !== 'shipped',
  ).length
  const visiblePackItems =
    filterMode === 'incomplete'
      ? sortedPackItems.filter((it) => it.initialStatus !== 'packed' && it.initialStatus !== 'shipped')
      : sortedPackItems

  // 運転手渡し納品書（勘兵衛・オレンジファーム等）の対象取引先一覧を抽出
  const driverNoteCustomers = (() => {
    const map = new Map<string, string>()
    for (const it of items) {
      if (it.customerId && isDriverDeliveryNoteCustomer(it.customerName)) {
        map.set(it.customerId, it.customerName)
      }
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }))
  })()
  const driverBatchPdfHref =
    driverNoteCustomers.length > 0
      ? `/api/delivery-notes/pdf?customers=${driverNoteCustomers.map((c) => c.id).join(',')}&date=${date}&amount=none&layout=2up`
      : null

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
    newHasCard?: boolean,
  ) => {
    setItems((prev) =>
      prev.map((it) =>
        it.itemId === itemId
          ? {
              ...it,
              initialSpec: newSpec,
              initialContainer: newContainer,
              ...(newHasCard !== undefined ? { initialHasCard: newHasCard } : {}),
            }
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
    <div className="space-y-2.5">
      {/* 2カラム中央揃え進捗コックピット ＆ 詳細内訳アコーディオン */}
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

      {/* 100%全幅バランス設計のソート＆フィルターバー（右側の不自然な余白・段落ちを完全解消） */}
      <div className="space-y-1.5 pt-0.5">
        {/* 上段：3等分フルワイドのソート切替タブ */}
        <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-line/80 border border-line w-full">
          <button
            type="button"
            onClick={() => handleSortModeChange('time')}
            className={cn(
              'min-h-10 px-2 rounded-lg text-xs font-black transition flex items-center justify-center gap-1',
              sortMode === 'time'
                ? 'bg-bg-card text-ink shadow-2xs ring-1 ring-harvest-600/20'
                : 'text-ink-soft hover:text-ink',
            )}
          >
            <span aria-hidden>⏰</span>
            <span>早い便順</span>
          </button>
          <button
            type="button"
            onClick={() => handleSortModeChange('destination')}
            className={cn(
              'min-h-10 px-2 rounded-lg text-xs font-black transition flex items-center justify-center gap-1',
              sortMode === 'destination'
                ? 'bg-bg-card text-ink shadow-2xs ring-1 ring-harvest-600/20'
                : 'text-ink-soft hover:text-ink',
            )}
          >
            <span aria-hidden>🏢</span>
            <span>納入先順</span>
          </button>
          <button
            type="button"
            onClick={() => handleSortModeChange('container')}
            className={cn(
              'min-h-10 px-2 rounded-lg text-xs font-black transition flex items-center justify-center gap-1',
              sortMode === 'container'
                ? 'bg-bg-card text-ink shadow-2xs ring-1 ring-harvest-600/20'
                : 'text-ink-soft hover:text-ink',
            )}
          >
            <span aria-hidden>📦</span>
            <span>コンテナ順</span>
          </button>
        </div>

        {/* 下段：左に「全件 / 未完」セグメント、右に「並び替え ＋ 最新更新」を両端揃えで整然と配置 */}
        <div className="flex items-center justify-between gap-2 w-full">
          <div className="inline-flex items-center rounded-xl bg-line/80 p-1 border border-line text-xs font-bold">
            <button
              type="button"
              onClick={() => setFilterMode('all')}
              className={cn(
                'min-h-10 px-3 rounded-lg transition tabular-nums',
                filterMode === 'all'
                  ? 'bg-bg-card text-ink shadow-2xs font-black'
                  : 'text-ink-muted hover:text-ink',
              )}
            >
              全 ({sortedPackItems.length})
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('incomplete')}
              className={cn(
                'min-h-10 px-3 rounded-lg transition tabular-nums',
                filterMode === 'incomplete'
                  ? 'bg-harvest-700 text-white shadow-2xs font-black'
                  : 'text-ink-muted hover:text-ink',
              )}
            >
              未完 ({incompleteCount})
            </button>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {driverBatchPdfHref && (
              <a
                href={driverBatchPdfHref}
                target="_blank"
                rel="noopener"
                title={`運転手渡し納品書（${driverNoteCustomers.map((c) => c.name).join('・')}）をA4上下2連PDFで開きます`}
                className="inline-flex items-center justify-center gap-1 h-10 px-2.5 text-xs font-black text-forest-900 bg-harvest-50 border border-harvest-400 hover:bg-harvest-100 rounded-xl shadow-2xs transition active:scale-95"
              >
                <FileDown className="h-3.5 w-3.5 text-harvest-700 shrink-0" />
                <span>納品書({driverNoteCustomers.length})</span>
              </a>
            )}
            {sortedPackItems.length > 1 && (
              <button
                type="button"
                onClick={() => setIsReorderModalOpen(true)}
                title="カードの順番を指で並べ替える（上のタブは自動の並び順）"
                className="inline-flex items-center justify-center gap-1.5 h-10 px-3 text-xs font-black text-forest-900 bg-harvest-50 border border-harvest-400 hover:bg-harvest-100 rounded-xl shadow-2xs transition active:scale-95"
              >
                <SlidersHorizontal className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span>手で並べる</span>
              </button>
            )}
            <button
              type="button"
              onClick={handleRefresh}
              disabled={isRefreshing}
              title="最新データを再取得"
              aria-label="最新データを再取得"
              className="inline-flex items-center justify-center gap-1 h-10 min-w-10 px-2.5 rounded-xl border border-line bg-bg-card hover:bg-bg-soft text-xs font-bold text-ink-soft transition active:scale-95 disabled:opacity-50"
            >
              <RotateCw className={cn('h-3.5 w-3.5', isRefreshing && 'animate-spin')} />
              <span className="hidden sm:inline">更新</span>
            </button>
          </div>
        </div>
      </div>

      {/* 全パック完了時（残り0箱）の控えめな1行納品書案内バー */}
      {totalBoxes > 0 && remainingBoxesTotal === 0 && driverBatchPdfHref && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-harvest-400 bg-harvest-50/90 px-3.5 py-2 text-xs font-bold text-forest-900 shadow-2xs">
          <span>
            🎉 全パック完了！運転手渡し用の納品書（{driverNoteCustomers.map((c) => c.name).join('・')}）を印刷できます
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            <a
              href={driverBatchPdfHref}
              target="_blank"
              rel="noopener"
              className="inline-flex h-10 items-center gap-1 rounded-lg bg-harvest-700 px-3 text-xs font-black text-white hover:bg-forest-800 shadow-2xs"
            >
              <FileDown className="h-3.5 w-3.5" />
              <span>まとめてA4印刷</span>
            </a>
            {driverNoteCustomers.map((c) => {
              const preset = resolveDefaultIssuerPreset(c.name)
              return (
                <a
                  key={c.id}
                  href={`/api/delivery-notes/pdf?customer=${c.id}&date=${date}&amount=none&issuer=${preset}&layout=2up`}
                  target="_blank"
                  rel="noopener"
                  className="inline-flex h-10 items-center rounded-lg border border-harvest-400 bg-bg-card px-3 text-xs font-bold text-forest-900 hover:bg-harvest-100"
                >
                  {c.name}のみ
                </a>
              )
            })}
          </div>
        </div>
      )}

      {/* 当日出荷分のパック作業カード一覧 */}
      {visiblePackItems.length === 0 && filterMode === 'incomplete' && sortedPackItems.length > 0 ? (
        <div className="rounded-2xl border border-harvest-400 bg-harvest-50/70 p-6 text-center space-y-2">
          <p className="text-base font-black text-forest-900">
            🎉 この品目のパック作業はすべて完了しています！
          </p>
          <button
            type="button"
            onClick={() => setFilterMode('all')}
            className="inline-flex min-h-10 items-center rounded-lg bg-bg-card border border-harvest-400 px-3 text-xs font-bold text-forest-800 hover:bg-harvest-100 transition"
          >
            完了済みのカードを表示する
          </button>
        </div>
      ) : (
        <div className="space-y-2.5">
          {visiblePackItems.map((item, idx) => {
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
            // 【#10 解消】「納入先順」で1カードしかないグループでは、カード自身の見出しと100%重複するセクションヘッダーを表示しない
            const shouldShowSectionHeader =
              isNewSection && !(sortMode === 'destination' && sectionItems.length <= 1)

            // 見出しの「残」は箱もPも“残り”で揃える（箱=まだ満杯になっていない箱、P=未完了のパック数）
            const sectionTotalPacks = sectionItems.reduce((acc, it) => acc + it.orderedQty, 0)
            let sectionRemBoxes = 0
            let sectionRemPacks = 0
            for (const it of sectionItems) {
              if (it.initialStatus === 'packed' || it.initialStatus === 'shipped') continue
              const perCase = packsPerCaseOf(it)
              const done = Math.max(0, Math.min(it.orderedQty, it.initialShippedQty ?? 0))
              sectionRemPacks += it.orderedQty - done
              sectionRemBoxes += Math.ceil(it.orderedQty / perCase) - completedCaseCount(done, it.orderedQty, perCase)
            }

            return (
              <div key={item.itemId} className="space-y-1.5">
                {shouldShowSectionHeader && (
                  <div className="flex items-center justify-between gap-2 py-1.5 px-3 rounded-xl bg-earth-100/90 border border-earth-300 border-l-4 border-l-forest-700 shadow-2xs">
                    <div className="flex items-center gap-x-1.5 gap-y-0.5 min-w-0 flex-wrap">
                      <span className="min-w-0 text-xs sm:text-sm font-black text-ink">
                        <span aria-hidden className="mr-1">{groupInfo.icon}</span>
                        {groupInfo.title}
                      </span>
                      {isThaiMode && sortMode === 'time' && getThaiDepartureTime(item.departureTime) && (
                        <span className="whitespace-nowrap rounded bg-warning-bg text-ink border border-warning px-1.5 py-0.5 text-xs font-black print:hidden">
                          🇹🇭 {getThaiDepartureTime(item.departureTime)}
                        </span>
                      )}
                      {isThaiMode && sortMode === 'container' && getThaiContainer(item.initialContainer) && (
                        <span className="whitespace-nowrap rounded bg-trust-100 text-trust-700 border border-trust-400 px-1.5 py-0.5 text-xs font-black print:hidden">
                          🇹🇭 {getThaiContainer(item.initialContainer)}
                        </span>
                      )}
                      {groupInfo.badge && (
                        <span className="whitespace-nowrap rounded bg-trust-100 text-trust-700 px-1.5 py-0.5 text-xs font-bold">
                          {groupInfo.badge}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0 text-xs font-black">
                      {sectionRemPacks > 0 ? (
                        <span
                          className="whitespace-nowrap rounded-md bg-bg-card border border-line px-2 py-0.5 text-ink tabular-nums"
                          title={`この便の合計 ${sectionTotalPacks.toLocaleString()}P`}
                        >
                          残り {sectionRemBoxes}箱（{sectionRemPacks.toLocaleString()}P）
                        </span>
                      ) : (
                        <span className="whitespace-nowrap rounded-md bg-harvest-600 text-white px-2 py-0.5 tabular-nums">
                          ✓ 完了（{sectionTotalPacks.toLocaleString()}P）
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

      {/* 翌日出荷予定カード一覧（合計箱数・総パック数をバー表面に明記） */}
      {nextItems.length > 0 && (
        <div ref={nextSectionRef} className="pt-2 space-y-2">
          <button
            type="button"
            onClick={() => setNextDayExpanded((prev) => !prev)}
            className="w-full flex flex-wrap items-center justify-between gap-2 rounded-xl bg-line/90 hover:bg-line-strong/80 px-3.5 py-2.5 text-xs font-black text-ink border border-line-strong shadow-2xs transition active:scale-[0.99]"
          >
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-base">📅</span>
              <span>翌日作業予定（先行枠：{nextItems.length}件）</span>
              <span className="whitespace-nowrap rounded-md bg-night text-white px-2 py-0.5 text-xs font-black tabular-nums">
                計 {nextDayTotalBoxes}箱（{nextDayTotalPacks.toLocaleString()} P）
              </span>
            </div>
            <div className="flex items-center gap-1 text-xs text-ink-soft font-bold">
              <span>{nextDayExpanded || (incompleteCount === 0 && sortedPackItems.length > 0) ? '閉じる ▲' : '開く ▼'}</span>
            </div>
          </button>

          {(nextDayExpanded || (incompleteCount === 0 && sortedPackItems.length > 0)) && (
            <div className="space-y-2.5 pt-1">
              <p className="px-1 text-xs text-ink-faint font-medium">
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
                    onDetailsChange={(id, newSpec, newCont, newCard) => {
                      setNextItems((prev) =>
                        prev.map((it) =>
                          it.itemId === id
                            ? {
                                ...it,
                                initialSpec: newSpec,
                                initialContainer: newCont,
                                ...(newCard !== undefined ? { initialHasCard: newCard } : {}),
                              }
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
          <div className="w-full max-w-lg rounded-t-3xl sm:rounded-2xl bg-bg-card shadow-2xl flex flex-col max-h-[88vh] animate-in slide-in-from-bottom duration-200">
            <div className="flex items-center justify-between p-4 border-b border-line shrink-0">
              <div>
                <h3 className="text-base font-black text-ink flex items-center gap-1.5">
                  <SlidersHorizontal className="h-4 w-4 text-harvest-600" />
                  <span>パック作業順を手で並べる</span>
                </h3>
                <p className="text-xs text-ink-muted mt-0.5">
                  左の「⠿」を指でドラッグして移動するか、【🔝 最上段】で一発優先指定できます。
                </p>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap justify-end">
                {incompleteCount > 0 && incompleteCount < sortedPackItems.length && (
                  <button
                    type="button"
                    disabled={busyReorder}
                    onClick={async () => {
                      const incompletes = sortedPackItems.filter(
                        (it) => it.initialStatus !== 'packed' && it.initialStatus !== 'shipped',
                      )
                      const dones = sortedPackItems.filter(
                        (it) => it.initialStatus === 'packed' || it.initialStatus === 'shipped',
                      )
                      const reordered = [...incompletes, ...dones]
                      const updates = reordered.map((it, idx) => ({
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
                        await fetch('/api/order-items/reorder', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ items: updates }),
                        })
                        toast.success('未完了のカードをすべて上段に集めました')
                      } finally {
                        setBusyReorder(false)
                      }
                    }}
                    className="min-h-10 rounded-lg border border-harvest-400 bg-harvest-50 hover:bg-harvest-100 px-3 text-xs font-black text-forest-900 transition"
                  >
                    未完了を上に集める
                  </button>
                )}
                {items.some((it) => it.dailyPackSortOrder != null) && (
                  <button
                    type="button"
                    disabled={busyReorder}
                    onClick={handleResetOrder}
                    className="min-h-10 rounded-lg border border-line bg-bg-soft hover:bg-line px-3 text-xs font-bold text-ink-soft transition"
                  >
                    自動順に戻す
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setIsReorderModalOpen(false)}
                  className="h-10 w-10 flex items-center justify-center rounded-full text-ink-muted hover:bg-bg-soft"
                  aria-label="閉じる"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div ref={reorderListRef} className="p-3 overflow-y-auto space-y-2 flex-1">
              {sortedPackItems.map((it, idx) => {
                const perCase = packsPerCaseOf(it)
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
                        ? 'border-harvest-600 bg-harvest-50/90 shadow-lg scale-[1.02] opacity-90 z-10'
                        : isDragOver
                        ? 'border-2 border-dashed border-harvest-500 bg-harvest-50/40'
                        : idx === 0 && !isDoneItem
                        ? 'border-harvest-400 bg-harvest-50/30 shadow-2xs'
                        : isDoneItem
                        ? 'border-line bg-bg-soft opacity-65'
                        : 'border-line bg-bg-card shadow-2xs',
                    )}
                  >
                    <div
                      className="flex items-center justify-center min-h-[44px] h-11 w-10 rounded-xl bg-bg-soft hover:bg-harvest-100 text-ink-soft hover:text-forest-800 cursor-grab active:cursor-grabbing touch-none shrink-0"
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
                            'inline-flex items-center justify-center h-5 min-w-5 px-1 rounded text-xs font-black',
                            idx === 0 && !isDoneItem
                              ? 'bg-harvest-700 text-white'
                              : 'bg-line text-ink-soft',
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
                          <span className="whitespace-nowrap rounded bg-harvest-100 text-forest-800 px-1.5 py-0.5 text-xs font-bold">
                            {it.departureTime.startsWith('翌') ? `${it.departureTime}迄` : `当日${it.departureTime}迄`}
                          </span>
                        )}
                        {isDoneItem && (
                          <span className="whitespace-nowrap rounded bg-harvest-600 text-white px-1.5 py-0.5 text-xs font-bold">
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
                        className="h-10 min-w-10 px-2 rounded-lg bg-harvest-600 hover:bg-harvest-700 disabled:opacity-30 text-white text-xs font-black flex items-center justify-center gap-1 shadow-2xs active:scale-95"
                        title="一番上（最優先）へ移動"
                      >
                        <ArrowUpToLine className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">最上段</span>
                      </button>
                      <button
                        type="button"
                        disabled={busyReorder || idx === 0}
                        onClick={() => handleMove(idx, 'up')}
                        className="h-10 w-10 rounded-lg border border-line bg-bg-card hover:bg-bg-soft disabled:opacity-30 text-ink flex items-center justify-center font-bold active:scale-95"
                        title="1つ上へ"
                      >
                        <ChevronUp className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        disabled={busyReorder || idx === sortedPackItems.length - 1}
                        onClick={() => handleMove(idx, 'down')}
                        className="h-10 w-10 rounded-lg border border-line bg-bg-card hover:bg-bg-soft disabled:opacity-30 text-ink flex items-center justify-center font-bold active:scale-95"
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
