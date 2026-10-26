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

  // サーバー側や親コンポーネント（日付変更・品目タブ切り替え・自動ポーリング）から届く最新の明細リストを同期
  // 新規注文の追加や数量変更を検知した場合は、現場スタッフが見落とさないようトースト通知を出す
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

  // タブレット放置によるFAX追加・数量変更の見落としを防ぐため、30秒ごとの自動バックグラウンド同期 ＋ 画面復帰時即時リフレッシュ
  useEffect(() => {
    const syncLatest = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      if (typeof navigator !== 'undefined' && !navigator.onLine) return
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
  }, [router])

  // 翌日エリアへのスクロール連動（翌日枠が画面上部に達したらヘッダー色・表記を切り替える）
  useEffect(() => {
    if (!nextSectionRef.current || nextItems.length === 0) {
      setIsViewingNextDay(false)
      return
    }
    const checkScrollPosition = () => {
      if (!nextSectionRef.current) return
      const rect = nextSectionRef.current.getBoundingClientRect()
      // 上部固定バー(約56px)直下に翌日見出しが到達したか
      setIsViewingNextDay(rect.top <= 110)
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

  // 【小島農園固有ルール】
  // 青梗菜のパック進捗箱数は一律「総パック数 ÷ 20」で算出する。
  // （内部理由: 収穫コンテナに40パック入り、それをニコイチ＝20パック/箱で入れる現場運用に基づく。UI上には内部理由は非表示）
  const isBokChoy =
    !productName ||
    productName.includes('青梗菜') ||
    productName.includes('チンゲン') ||
    productName.includes('ちんげん')

  if (isBokChoy && totalPacks > 0) {
    totalBoxes = Math.ceil(totalPacks / 20)
    completedBoxes =
      completedPacks >= totalPacks
        ? totalBoxes
        : Math.floor(completedPacks / 20)
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

  // 規格・荷姿即時連動
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

  // パック作業順の汎用 이동関数（fromIndex -> toIndex、全スタッフ利用可能）
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

  // 上下1段移動
  const handleMove = async (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1
    await handleMoveToIndex(index, targetIndex)
  }

  // 最上段（最優先）へ一発移動
  const handleMoveToTop = async (index: number) => {
    const moved = sortedPackItems[index]
    if (!moved) return
    await handleMoveToIndex(
      index,
      0,
      `🔥「${moved.destinationName || moved.customerName}」を最上段（最優先1枚目）に移動しました`,
    )
  }

  // 初期順（時刻順・自動ソート）にリセット
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
      toast.success('自動の優先順（16:00 NSK ➜ 18:00 和郷園 ➜ 翌午前 農総研）に戻しました')
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
    <div className="space-y-3.5">
      {/* スクロール追従スティッキーヘッダー（画面最上部に常時固定・日付/作業区分とリアルタイム進捗を統合表示） */}
      <div
        className={cn(
          'sticky top-14 z-20 -mx-1 px-3 py-2 text-white backdrop-blur shadow-md rounded-b-xl border-b transition-colors duration-200',
          isViewingNextDay
            ? 'bg-[#0f172a]/95 border-slate-500 shadow-lg text-slate-100'
            : date === shiftDateStr(jstTodayStr(), 1)
            ? 'bg-[#0f2e1e]/95 border-emerald-600/80 shadow-md'
            : date === jstTodayStr()
            ? 'bg-[#0c2e4e]/95 border-sky-600/80 shadow-md'
            : 'bg-[#1e293b]/95 border-slate-600',
        )}
      >
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
          {/* 左側: 日付・曜日・作業対象バッジ + 品目名 */}
          <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-black shadow-2xs shrink-0',
                isViewingNextDay
                  ? 'bg-slate-700 text-amber-300 border border-slate-500'
                  : date === shiftDateStr(jstTodayStr(), 1)
                  ? 'bg-emerald-400 text-emerald-950'
                  : date === jstTodayStr()
                  ? 'bg-sky-400 text-sky-950'
                  : 'bg-slate-700 text-slate-100 border border-slate-500',
              )}
            >
              <span>
                {isViewingNextDay
                  ? '📅'
                  : date === shiftDateStr(jstTodayStr(), 1)
                  ? '🥬'
                  : date === jstTodayStr()
                  ? '🚚'
                  : '📅'}
              </span>
              <span>
                {isViewingNextDay
                  ? `翌々日 ${formatJpDateShort(shiftDateStr(date, 1))} 出荷分（翌日先行枠）`
                  : date === shiftDateStr(jstTodayStr(), 1)
                  ? `明日 ${formatJpDateShort(date)} 出荷分（本日パック作業）`
                  : date === jstTodayStr()
                  ? `本日 ${formatJpDateShort(date)} 出荷分（当日便）`
                  : `${formatJpDateShort(date)} 出荷分`}
              </span>
            </span>
            <span className="text-white font-black text-xs sm:text-sm truncate">
              {productName || '品目'}
            </span>
          </div>

          {/* 右側: リアルタイム進捗（完成/目標・残りP/箱数） ＆ ワンタップ更新 */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 ml-auto">
            {isViewingNextDay ? (
              <span className="text-slate-200 font-black tabular-nums">
                翌日分: 全 {nextItems.length} 件（計{' '}
                {nextItems.reduce((acc, it) => acc + it.orderedQty, 0).toLocaleString()} P）
              </span>
            ) : (
              <>
                <span className="text-emerald-300 font-black tabular-nums text-xs sm:text-sm">
                  {completedPacks.toLocaleString()}/{totalPacks.toLocaleString()} P
                </span>
                <span className="text-[11px] text-slate-300 font-bold tabular-nums">
                  ({progressPct}%)
                </span>
                <span
                  className="hidden xs:inline-block rounded-md bg-white/15 border border-white/20 px-2 py-0.5 text-[11px] text-white font-black tabular-nums"
                  title={`残り約${remainingBoxes}箱`}
                >
                  あと {remainingPacks.toLocaleString()}P (約{remainingBoxes}箱)
                </span>
              </>
            )}
            <FieldLangSwitch />
            <button
              type="button"
              onClick={handleRefresh}
              disabled={isRefreshing}
              title="最新データを再取得"
              aria-label="最新データを再取得"
              className="flex items-center gap-1 rounded-md bg-white/10 hover:bg-white/20 active:bg-white/30 px-1.5 py-0.5 text-xs text-white/90 border border-white/15 transition disabled:opacity-50"
            >
              <RotateCw className={cn('h-3.5 w-3.5', isRefreshing && 'animate-spin')} />
              <span className="hidden sm:inline text-[11px] font-bold">更新</span>
            </button>
          </div>
        </div>
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
          prevCarryover={prevCarryover}
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
              {sortMode === 'time'
                ? `⏰ 早い便順${isThaiMode ? ' (เวลาออก)' : ''}`
                : sortMode === 'destination'
                ? `🏢 出荷先順${isThaiMode ? ' (ลูกค้า)' : ''}`
                : `📦 コンテナ順${isThaiMode ? ' (ประเภทลัง)' : ''}`}
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
                {isThaiMode ? 'すべて(ทั้งหมด)' : 'すべて'} ({sortedPackItems.length})
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
                {isThaiMode ? '未完了(ยังไม่เสร็จ)' : '未完了'} ({incompleteCount})
              </button>
            </div>
            {sortedPackItems.length > 1 && (
              <button
                type="button"
                onClick={() => setIsReorderModalOpen(true)}
                className="inline-flex items-center gap-1 text-xs font-bold text-emerald-900 bg-emerald-50 border border-emerald-300 hover:bg-emerald-100 px-2.5 py-1 rounded-lg shadow-2xs transition active:scale-95"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                <span>{isThaiMode ? 'จัดลำดับ (並び替え)' : '並び替え'}</span>
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

            // 未完了の先頭1枚目かどうか（NEXT UPスポットライト用）
            const firstIncompleteItemId = visiblePackItems.find(
              (it) => it.initialStatus !== 'packed' && it.initialStatus !== 'shipped',
            )?.itemId
            const isNextUp = item.itemId === firstIncompleteItemId

            // このセクションの残り箱数・総パック数を集計
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
              <div key={item.itemId} className="space-y-2">
                {isNewSection && (
                  <div className="flex flex-wrap items-center justify-between gap-1.5 pt-2.5 pb-1.5 px-2.5 rounded-xl bg-slate-100/90 border border-line-soft shadow-2xs">
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
                      {groupInfo.subtitle && (
                        <span className="text-[11px] font-bold text-ink-muted">
                          {groupInfo.subtitle}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0 text-[11px] font-black">
                      {sectionRemBoxes > 0 ? (
                        <span className="rounded-md bg-white border border-line px-2 py-0.5 text-ink">
                          {isThaiMode
                            ? `เหลือ ${sectionRemBoxes} ลัง (${sectionTotalPacks.toLocaleString()}ถุง)`
                            : `残り ${sectionRemBoxes}箱 (計${sectionTotalPacks.toLocaleString()}P)`}
                        </span>
                      ) : (
                        <span className="rounded-md bg-emerald-600 text-white px-2 py-0.5">
                          {isThaiMode ? '✓ ครบแล้ว (完了)' : `✓ 全${sectionTotalPacks.toLocaleString()}P 完了`}
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
                  onDetailsChange={handleDetailsChange}
                  onDeleted={handleDeleted}
                />
              </div>
            )
          })}
        </div>
      )}

      {/* 翌日出荷予定カード一覧（普段は折りたたんで誤タップを防止、当日分が全て完了したときのみ自動展開） */}
      {nextItems.length > 0 && (
        <div ref={nextSectionRef} className="pt-4 space-y-2.5">
          <button
            type="button"
            onClick={() => setNextDayExpanded((prev) => !prev)}
            className="w-full flex items-center justify-between rounded-xl bg-slate-200/90 hover:bg-slate-300/80 px-3.5 py-2.5 text-xs font-black text-slate-800 border border-slate-300 shadow-xs transition active:scale-[0.99]"
          >
            <div className="flex items-center gap-1.5">
              <span className="text-base">📅</span>
              <span>
                {isThaiMode
                  ? `รายการล่วงหน้าของวันถัดไป (翌日先行作業予定・全 ${nextItems.length} 件)`
                  : `翌日作業予定（先行作業・確認用：全 ${nextItems.length} 件）`}
              </span>
            </div>
            <div className="flex items-center gap-1 text-[11px] text-slate-700 font-bold">
              <span>{nextDayExpanded || (incompleteCount === 0 && sortedPackItems.length > 0) ? '閉じる ▲' : '開く ▼'}</span>
            </div>
          </button>

          {(nextDayExpanded || (incompleteCount === 0 && sortedPackItems.length > 0)) && (
            <div className="space-y-3 pt-1">
              <p className="px-1 text-[11px] text-slate-500 font-medium">
                ※ 翌々日納品分の先行作業または確認用です。本日の目標・完成には含まれません。
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
        </div>
      )}

      {/* 📋 スマート並び替え・直感ドラッグ＆ドロップ＆最優先指定モーダル */}
      {isReorderModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-xs p-0 sm:p-4">
          <div className="w-full max-w-lg rounded-t-3xl sm:rounded-2xl bg-white shadow-2xl flex flex-col max-h-[88vh] animate-in slide-in-from-bottom duration-200">
            {/* モーダルヘッダー */}
            <div className="flex items-center justify-between p-4 border-b border-line shrink-0">
              <div>
                <h3 className="text-base font-black text-ink flex items-center gap-1.5">
                  <SlidersHorizontal className="h-4 w-4 text-emerald-600" />
                  <span>{isThaiMode ? 'จัดลำดับการแพ็ค (パック作業順の並び替え)' : 'パック作業順の並び替え'}</span>
                </h3>
                <p className="text-xs text-ink-muted mt-0.5">
                  {isThaiMode
                    ? 'ลากที่ไอคอน ⠿ เพื่อย้ายตำแหน่ง หรือกด 【🔝 ด่วน】 เพื่อย้ายไปบนสุด'
                    : '左の「⠿」を指でドラッグして移動するか、【🔝 最上段】で一発優先指定できます。'}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                {items.some((it) => it.dailyPackSortOrder != null) && (
                  <button
                    type="button"
                    disabled={busyReorder}
                    onClick={handleResetOrder}
                    className="rounded-lg border border-line bg-bg-soft hover:bg-slate-200 px-2.5 py-1 text-[11px] font-bold text-ink-soft transition"
                    title="自動の便順に戻す"
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

            {/* モーダルリスト（スマホタッチドラッグ＆PCマウスドラッグ両対応） */}
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
                    {/* 左端：スマホ・タブレット指ドラッグ専用グリップハンドル（touch-none でスクロール干渉を完全防止） */}
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

                    {/* 中央：出荷先・時刻・数量情報 */}
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
                        <span className="font-black text-ink">{it.orderedQty}P ({boxCount}箱)</span>
                        <span>•</span>
                        <span>{it.initialContainer || 'コンテナ'}</span>
                        <span>•</span>
                        <span className="truncate">{it.initialSpec || '標準'}</span>
                      </div>
                    </div>

                    {/* 右端：ワンタップ操作ボタングループ */}
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        disabled={busyReorder || idx === 0}
                        onClick={() => handleMoveToTop(idx)}
                        className="h-8 px-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-30 text-white text-xs font-black flex items-center gap-1 shadow-2xs active:scale-95"
                        title="一番上（最優先）へ移動"
                      >
                        <ArrowUpToLine className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">{isThaiMode ? 'ด่วน' : '最上段'}</span>
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

            {/* モーダルフッター */}
            <div className="p-3 border-t border-line shrink-0 bg-bg-soft/50">
              <button
                type="button"
                onClick={() => setIsReorderModalOpen(false)}
                className="w-full py-2.5 rounded-xl bg-forest-700 hover:bg-forest-800 text-white font-bold text-sm shadow-xs active:scale-[0.99]"
              >
                {isThaiMode ? 'เสร็จสิ้น (並び替えを完了する)' : '並び替えを完了する'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
