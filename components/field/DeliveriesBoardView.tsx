'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, RotateCw, Clock, Building2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { cn } from '@/lib/cn'
import { jstTodayStr, shiftDateStr, formatJpDateShort } from '@/lib/dates'
import { useFieldLang } from '@/lib/field/lang-context'
import { parseDeparturePriority, cleanShippingRouteName } from '@/lib/field/shipment-sort'
import { getThaiDepartureTime } from '@/lib/field/thai-dict'
import {
  CustomerDeliveryCard,
  type CustomerDeliveryCardProps,
} from '@/components/field/CustomerDeliveryCard'

export interface DeliveriesBoardViewProps {
  date?: string
  initialCards: (CustomerDeliveryCardProps & {
    earliestDepartureTime: string | null
  })[]
}

function isUserTypingInInput(): boolean {
  if (typeof document === 'undefined') return false
  const el = document.activeElement
  if (!el) return false
  const tag = el.tagName.toLowerCase()
  return tag === 'input' || tag === 'textarea' || tag === 'select' || (el as HTMLElement).isContentEditable
}

/**
 * 便別積込・配送リストのメインボード（v5.1.10 重複完全排除版）。
 * - 【#05 解消】MobileNav側に言語切替を統合し、スティッキー進捗バーの横幅圧迫を解消。
 * - 【#15 解消】「便・時間順（route）」モードでは、グループ見出しに出発時間が表示されているため、
 *   各カードに `hideParentTimeChip={true}` を渡して同じ「当日18:00迄」がカードごとに繰り返される重複を排除。
 */
export function DeliveriesBoardView({ date, initialCards }: DeliveriesBoardViewProps) {
  const router = useRouter()
  const { isThaiMode } = useFieldLang()
  const [cards, setCards] = useState(initialCards)
  const [filterMode, setFilterMode] = useState<'all' | 'incomplete'>('all')
  const [groupMode, setGroupMode] = useState<'route' | 'customer'>('route')
  const [isRefreshing, setIsRefreshing] = useState(false)
  const prevSignatureRef = useRef<string>('')

  useEffect(() => {
    setCards(initialCards)
    const sig = initialCards
      .map((c) => {
        const destSig = c.destinations
          .map(
            (d) =>
              `${d.destinationId}:${d.totalQty}:${d.items.map((i) => `${i.id}:${i.fieldStatus}:${i.quantity}`).join(',')}`,
          )
          .join('|')
        return `${c.customerId}:${c.totalQty}:${destSig}`
      })
      .join(';')
    if (prevSignatureRef.current && prevSignatureRef.current !== sig) {
      toast('🔔 最新のパック状況・注文データが反映されました', {
        id: 'delivery-board-auto-sync',
        duration: 3000,
      })
    }
    prevSignatureRef.current = sig
  }, [initialCards])

  // スマート・ポーリング（入力中は自動更新を一時停止、focusとvisibilitychangeの重複発火をデバウンス）
  useEffect(() => {
    let lastRefreshAt = 0
    const syncLatest = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        if (isUserTypingInInput()) return
        const now = Date.now()
        if (now - lastRefreshAt < 2500) return
        lastRefreshAt = now
        router.refresh()
      }
    }
    const timer = setInterval(syncLatest, 30_000)
    window.addEventListener('focus', syncLatest)
    document.addEventListener('visibilitychange', syncLatest)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', syncLatest)
      document.removeEventListener('visibilitychange', syncLatest)
    }
  }, [router])

  const handleRefresh = () => {
    setIsRefreshing(true)
    router.refresh()
    setTimeout(() => {
      setIsRefreshing(false)
      toast.success('最新の配送リストを取得しました', { id: 'delivery-refresh' })
    }, 600)
  }

  const handleCompletionChange = (customerId: string, isCompleted: boolean) => {
    setCards((prev) =>
      prev.map((c) => (c.customerId === customerId ? { ...c, isCompleted } : c)),
    )
  }

  const totalCustomers = cards.length
  const completedCustomers = cards.filter((c) => c.isCompleted).length
  const remainingCustomers = totalCustomers - completedCustomers

  const totalContainers = cards.reduce((acc, c) => acc + c.grandTotalContainers, 0)
  const completedContainers = cards.reduce((acc, c) => {
    if (c.isCompleted) return acc + c.grandTotalContainers
    const destDoneBoxes = c.destinations
      .filter((d) => d.status === 'loaded' || d.status === 'delivered')
      .reduce((sum, d) => sum + d.totalBoxes, 0)
    return acc + Math.min(c.grandTotalContainers, destDoneBoxes)
  }, 0)
  const remainingContainers = Math.max(0, totalContainers - completedContainers)
  const progressPct =
    totalContainers > 0 ? Math.min(100, Math.round((completedContainers / totalContainers) * 100)) : 0

  const effectiveDate = date || initialCards[0]?.deliveryDate || jstTodayStr()
  const isToday = effectiveDate === jstTodayStr()
  const isTomorrow = effectiveDate === shiftDateStr(jstTodayStr(), 1)

  const visibleCards =
    filterMode === 'incomplete' ? cards.filter((c) => !c.isCompleted) : cards

  const routeGroups = (() => {
    const map = new Map<
      string,
      {
        key: string
        title: string
        departureTime: string | null
        isUnassigned: boolean
        cards: (CustomerDeliveryCardProps & { earliestDepartureTime: string | null; sliceKey?: string })[]
      }
    >()

    for (const c of visibleCards) {
      const destByRoute = new Map<
        string,
        {
          depTime: string | null
          routeTitle: string
          isUnassigned: boolean
          groupKey: string
          dests: typeof c.destinations
        }
      >()

      for (const d of c.destinations) {
        const depTime = d.departureTime || c.earliestDepartureTime || null
        const rawRoute = d.shippingRouteName || c.routeSummaries?.[0]?.title || null
        const cleanRoute = cleanShippingRouteName(rawRoute)
        const isUnassigned = !depTime && (!cleanRoute || cleanRoute === '一般配送・時間未指定')

        const groupTitle = isUnassigned
          ? '時間指定なし（一般便）'
          : depTime && cleanRoute
          ? depTime.startsWith('翌')
            ? `${depTime}迄 ・ ${cleanRoute}`
            : `当日 ${depTime}迄 ・ ${cleanRoute}`
          : depTime
          ? depTime.startsWith('翌')
            ? `${depTime}迄に出荷`
            : `当日 ${depTime}迄に出荷`
          : cleanRoute || '時間指定なし（一般便）'

        const groupKey = isUnassigned ? '__unassigned__' : `${depTime ?? '99:99'}:${groupTitle}`

        let bucket = destByRoute.get(groupKey)
        if (!bucket) {
          bucket = {
            depTime,
            routeTitle: groupTitle,
            isUnassigned,
            groupKey,
            dests: [],
          }
          destByRoute.set(groupKey, bucket)
        }
        bucket.dests.push(d)
      }

      for (const bucket of destByRoute.values()) {
        if (filterMode === 'incomplete' && bucket.dests.every((d) => d.status === 'loaded' || d.status === 'delivered')) {
          continue
        }
        const sliceCases = bucket.dests.reduce((acc, d) => acc + d.cases, 0)
        const sliceFractionBoxes = bucket.dests.reduce((acc, d) => acc + d.fractionBoxes, 0)
        const sliceFractionPacks = bucket.dests.reduce((acc, d) => acc + d.loose, 0)
        const sliceContainers = Math.max(
          sliceCases,
          bucket.dests.reduce((acc, d) => acc + d.totalBoxes, 0),
        )
        const sliceQty = bucket.dests.reduce((acc, d) => acc + d.totalQty, 0)
        const sliceCompleted =
          bucket.dests.length > 0 &&
          bucket.dests.every((d) => d.status === 'loaded' || d.status === 'delivered')

        const slicedCard: CustomerDeliveryCardProps & { earliestDepartureTime: string | null; sliceKey?: string } = {
          ...c,
          sliceKey: `${c.customerId}:${bucket.groupKey}`,
          totalCases: sliceCases,
          totalFractionBoxes: sliceFractionBoxes,
          totalFractionPacks: sliceFractionPacks,
          grandTotalContainers: sliceContainers,
          totalQty: sliceQty,
          isCompleted: sliceCompleted,
          destinations: bucket.dests,
          earliestDepartureTime: bucket.depTime,
        }

        let grp = map.get(bucket.groupKey)
        if (!grp) {
          grp = {
            key: bucket.groupKey,
            title: bucket.routeTitle,
            departureTime: bucket.depTime,
            isUnassigned: bucket.isUnassigned,
            cards: [],
          }
          map.set(bucket.groupKey, grp)
        }
        grp.cards.push(slicedCard)
      }
    }

    const list = Array.from(map.values())
    list.sort((a, b) => {
      if (a.isUnassigned !== b.isUnassigned) return a.isUnassigned ? 1 : -1
      const prioA = parseDeparturePriority(a.departureTime)
      const prioB = parseDeparturePriority(b.departureTime)
      if (prioA !== prioB) return prioA - prioB
      return a.title.localeCompare(b.title, 'ja')
    })
    return list
  })()

  return (
    <div className="space-y-3">
      {/* 印刷時専用タイトルヘッダー */}
      <div className="hidden print:flex items-center justify-between border-b-2 border-black pb-2 mb-3">
        <div>
          <h2 className="text-lg font-black text-black">
            🚚 小島農園 便別積込・配送リスト（{formatJpDateShort(effectiveDate)} 納品分）
          </h2>
          <p className="text-xs font-bold text-slate-700">
            全 {totalCustomers} 取引先 ／ 総積込数 {totalContainers} 箱
          </p>
        </div>
        <div className="text-xs font-bold text-slate-700">
          積込済: {completedCustomers} / {totalCustomers} 社（{completedContainers}/{totalContainers}箱）
        </div>
      </div>

      {/* 1行スリム・スティッキー積込コックピットバー */}
      <div
        className={cn(
          'sticky top-13 z-20 px-3 py-2 text-white shadow-md rounded-xl border transition-colors duration-200 print:hidden',
          isToday
            ? 'bg-[#0c2e4e] border-sky-600'
            : isTomorrow
            ? 'bg-[#0f2e1e] border-emerald-600'
            : 'bg-[#1e293b] border-slate-600',
        )}
      >
        <div className="flex items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-black shrink-0',
                isToday
                  ? 'bg-sky-400 text-sky-950'
                  : isTomorrow
                  ? 'bg-emerald-400 text-emerald-950'
                  : 'bg-slate-700 text-slate-100 border border-slate-500',
              )}
            >
              <span>🚚</span>
              <span>
                {isToday
                  ? `本日 ${formatJpDateShort(effectiveDate)}納品`
                  : isTomorrow
                  ? `明日 ${formatJpDateShort(effectiveDate)}納品`
                  : `${formatJpDateShort(effectiveDate)}納品`}
              </span>
            </span>

            <span className="text-emerald-300 font-black tabular-nums text-xs sm:text-sm truncate">
              {completedContainers}/{totalContainers}箱済 ({progressPct}%)
            </span>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <span
              className="rounded-md bg-white/15 border border-white/20 px-2 py-0.5 text-[11px] text-white font-black tabular-nums"
              title={`残り積込 ${remainingContainers}箱`}
            >
              {remainingContainers > 0 ? (
                `残 ${remainingContainers}箱 (${remainingCustomers}社)`
              ) : (
                <span className="inline-flex items-center gap-1 text-emerald-200">
                  <CheckCircle2 className="h-3 w-3" /> 完了
                </span>
              )}
            </span>
            <button
              type="button"
              onClick={handleRefresh}
              disabled={isRefreshing}
              title="最新データを再取得"
              aria-label="最新データを再取得"
              className="flex items-center gap-1 rounded-md bg-white/10 hover:bg-white/20 active:bg-white/30 px-2 py-1 text-xs text-white/90 border border-white/15 transition disabled:opacity-50"
            >
              <RotateCw className={cn('h-3.5 w-3.5', isRefreshing && 'animate-spin')} />
              <span className="hidden sm:inline text-[11px] font-bold">更新</span>
            </button>
          </div>
        </div>
      </div>

      {/* 表示順（便・時間順 / 取引先順） ＆ ワンタップ未積込フィルタ */}
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <div className="inline-flex items-center rounded-xl bg-slate-100 p-1 border border-line text-xs font-bold">
          <button
            type="button"
            onClick={() => setGroupMode('route')}
            className={cn(
              'inline-flex items-center gap-1 px-3 py-1.5 rounded-lg transition',
              groupMode === 'route'
                ? 'bg-white text-emerald-800 shadow-2xs font-black ring-1 ring-emerald-600/20'
                : 'text-ink-muted hover:text-ink',
            )}
          >
            <Clock className="h-3.5 w-3.5" />
            <span>便・時間順{isThaiMode ? ' (เวลา)' : ''}</span>
          </button>
          <button
            type="button"
            onClick={() => setGroupMode('customer')}
            className={cn(
              'inline-flex items-center gap-1 px-3 py-1.5 rounded-lg transition',
              groupMode === 'customer'
                ? 'bg-white text-emerald-800 shadow-2xs font-black ring-1 ring-emerald-600/20'
                : 'text-ink-muted hover:text-ink',
            )}
          >
            <Building2 className="h-3.5 w-3.5" />
            <span>取引先順{isThaiMode ? ' (ลูกค้า)' : ''}</span>
          </button>
        </div>

        <div className="inline-flex items-center rounded-xl bg-slate-100 p-1 border border-line text-xs font-bold">
          <button
            type="button"
            onClick={() => setFilterMode('all')}
            className={cn(
              'px-3 py-1.5 rounded-lg transition',
              filterMode === 'all'
                ? 'bg-white text-ink shadow-2xs font-black'
                : 'text-ink-muted hover:text-ink',
            )}
          >
            {isThaiMode ? 'すべて(ทั้งหมด)' : '全件'} ({totalCustomers})
          </button>
          <button
            type="button"
            onClick={() => setFilterMode('incomplete')}
            className={cn(
              'px-3 py-1.5 rounded-lg transition',
              filterMode === 'incomplete'
                ? 'bg-emerald-700 text-white shadow-2xs font-black'
                : 'text-ink-muted hover:text-ink',
            )}
          >
            {isThaiMode ? '未積込(ยังไม่ขึ้น)' : '未積込のみ'} ({remainingCustomers})
          </button>
        </div>
      </div>

      {/* 取引先カード一覧 */}
      {visibleCards.length === 0 && filterMode === 'incomplete' ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-6 text-center space-y-2">
          <p className="text-base font-black text-emerald-900">
            🎉 すべての取引先の積込チェックが完了しています！
          </p>
          <button
            type="button"
            onClick={() => setFilterMode('all')}
            className="inline-flex items-center rounded-lg bg-white border border-emerald-300 px-3 py-1.5 text-xs font-bold text-emerald-800 hover:bg-emerald-100 transition"
          >
            完了済みのカードを表示する
          </button>
        </div>
      ) : groupMode === 'route' ? (
        <div className="space-y-4">
          {routeGroups.map((grp) => {
            const grpTotalBoxes = grp.cards.reduce((acc, c) => acc + c.grandTotalContainers, 0)
            const grpRemBoxes = grp.cards
              .filter((c) => !c.isCompleted)
              .reduce((acc, c) => acc + c.grandTotalContainers, 0)
            const grpAllDone = grp.cards.every((c) => c.isCompleted)
            return (
              <div key={grp.key} className="space-y-2">
                <div
                  className={cn(
                    'flex items-center justify-between gap-2 rounded-xl px-3.5 py-2 border shadow-2xs',
                    grpAllDone
                      ? 'border-slate-300 bg-slate-100 text-slate-600'
                      : grp.isUnassigned
                      ? 'border-slate-300 bg-slate-100 text-slate-800'
                      : 'border-earth-300 bg-earth-100/90 text-earth-950',
                  )}
                >
                  <div className="flex items-center gap-1.5 font-black text-sm min-w-0">
                    <span className="shrink-0">
                      {grp.isUnassigned ? '📦' : grp.departureTime?.startsWith('翌') ? '🌅' : '⏰'}
                    </span>
                    <span className="truncate">{grp.title}</span>
                    {isThaiMode && grp.departureTime && getThaiDepartureTime(grp.departureTime) && (
                      <span className="text-xs font-bold text-earth-700 print:hidden shrink-0">
                        ({getThaiDepartureTime(grp.departureTime)})
                      </span>
                    )}
                    <span className="text-xs font-bold opacity-75 shrink-0">
                      ({grp.cards.length}社)
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs font-black shrink-0">
                    {grpAllDone ? (
                      <span className="rounded-md bg-emerald-600 text-white px-2 py-0.5">
                        ✓ 全{grpTotalBoxes}箱済
                      </span>
                    ) : (
                      <span className="rounded-md bg-white/90 border border-earth-300 px-2 py-0.5 text-earth-900 tabular-nums">
                        残 {grpRemBoxes} / {grpTotalBoxes}箱
                      </span>
                    )}
                  </div>
                </div>

                <div className="space-y-2.5">
                  {grp.cards.map((c) => (
                    <CustomerDeliveryCard
                      key={c.sliceKey ?? c.customerId}
                      {...c}
                      hideParentTimeChip={true}
                      onCompletionChange={handleCompletionChange}
                    />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="space-y-2.5">
          {visibleCards.map((c) => (
            <CustomerDeliveryCard
              key={c.customerId}
              {...c}
              hideParentTimeChip={false}
              onCompletionChange={handleCompletionChange}
            />
          ))}
        </div>
      )}
    </div>
  )
}
