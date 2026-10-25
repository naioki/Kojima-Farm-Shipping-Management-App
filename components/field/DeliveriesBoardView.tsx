'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, RotateCw } from 'lucide-react'
import toast from 'react-hot-toast'
import { cn } from '@/lib/cn'
import { jstTodayStr, shiftDateStr, formatJpDateShort } from '@/lib/dates'
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

export function DeliveriesBoardView({ date, initialCards }: DeliveriesBoardViewProps) {
  const router = useRouter()
  const [cards, setCards] = useState(initialCards)
  const [filterMode, setFilterMode] = useState<'all' | 'incomplete'>('all')
  const [isRefreshing, setIsRefreshing] = useState(false)

  useEffect(() => {
    setCards(initialCards)
  }, [initialCards])

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
  const completedContainers = cards
    .filter((c) => c.isCompleted)
    .reduce((acc, c) => acc + c.grandTotalContainers, 0)
  const remainingContainers = Math.max(0, totalContainers - completedContainers)
  const progressPct =
    totalCustomers > 0 ? Math.min(100, Math.round((completedCustomers / totalCustomers) * 100)) : 0

  const effectiveDate = date || initialCards[0]?.deliveryDate || jstTodayStr()
  const isToday = effectiveDate === jstTodayStr()
  const isTomorrow = effectiveDate === shiftDateStr(jstTodayStr(), 1)

  const visibleCards =
    filterMode === 'incomplete' ? cards.filter((c) => !c.isCompleted) : cards

  return (
    <div className="space-y-3.5">
      {/* スクロール追従スティッキーヘッダー（パック画面と完全統一された日付・積込進捗・ワンタップ更新バー） */}
      <div
        className={cn(
          'sticky top-14 z-20 -mx-1 px-3 py-2 text-white backdrop-blur shadow-md rounded-b-xl border-b transition-colors duration-200 print:hidden',
          isToday
            ? 'bg-[#0c2e4e]/95 border-sky-600/80'
            : isTomorrow
            ? 'bg-[#0f2e1e]/95 border-emerald-600/80'
            : 'bg-[#1e293b]/95 border-slate-600',
        )}
      >
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
          {/* 左側: 日付・作業区分バッジ */}
          <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-black shadow-2xs shrink-0',
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
                  ? `本日 ${formatJpDateShort(effectiveDate)} 積込・配送分`
                  : isTomorrow
                  ? `明日 ${formatJpDateShort(effectiveDate)} 積込・配送分`
                  : `${formatJpDateShort(effectiveDate)} 積込・配送分`}
              </span>
            </span>
          </div>

          {/* 右側: リアルタイム積込進捗 ＆ ワンタップ更新 */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 ml-auto">
            <span className="text-emerald-300 font-black tabular-nums text-xs sm:text-sm">
              {completedCustomers}/{totalCustomers} 社済
            </span>
            <span className="text-[11px] text-slate-300 font-bold tabular-nums">
              ({progressPct}%)
            </span>
            <span
              className="hidden xs:inline-block rounded-md bg-white/15 border border-white/20 px-2 py-0.5 text-[11px] text-white font-black tabular-nums"
              title={`残り積込 ${remainingContainers}箱`}
            >
              {remainingCustomers > 0
                ? `あと ${remainingCustomers}社 (計${remainingContainers}箱)`
                : `全${totalContainers}箱 積込完了`}
            </span>
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

      {/* 進捗サマリー ＆ ワンタップ未積込フィルタ */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-earth-200 bg-earth-50 px-3.5 py-2.5 print:hidden">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-bold text-ink-soft">積込進捗:</span>
          <span className="text-ink font-bold text-xs sm:text-sm flex items-center">
            <span className="num text-xl font-black tabular-nums text-earth-700 mr-0.5">
              {completedCustomers}
            </span>
            <span className="mx-0.5 text-ink-muted">/</span>
            <span>{totalCustomers} 取引先</span>
            <span className="ml-1.5 text-xs text-ink-soft font-semibold">
              （計 {totalContainers} 箱）
            </span>
            {remainingCustomers > 0 ? (
              <span className="ml-2 rounded-full bg-amber-100 text-amber-800 border border-amber-300 px-2 py-0.5 text-xs font-black">
                残り {remainingCustomers}社 ({remainingContainers}箱)
              </span>
            ) : (
              <span className="ml-2 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300 px-2 py-0.5 text-xs font-black inline-flex items-center gap-0.5">
                <CheckCircle2 className="h-3.5 w-3.5" /> 全積込完了
              </span>
            )}
          </span>
        </div>

        {/* ワンタップ絞り込みスイッチ（すべて / 未積込のみ） */}
        <div className="inline-flex items-center rounded-lg bg-white/80 p-0.5 border border-earth-200 text-xs font-bold shadow-2xs">
          <button
            type="button"
            onClick={() => setFilterMode('all')}
            className={cn(
              'px-2.5 py-1 rounded-md transition',
              filterMode === 'all'
                ? 'bg-forest-700 text-white shadow-2xs'
                : 'text-ink-soft hover:text-ink',
            )}
          >
            すべて ({totalCustomers})
          </button>
          <button
            type="button"
            onClick={() => setFilterMode('incomplete')}
            className={cn(
              'px-2.5 py-1 rounded-md transition',
              filterMode === 'incomplete'
                ? 'bg-amber-600 text-white shadow-2xs'
                : 'text-ink-soft hover:text-ink',
            )}
          >
            未積込のみ ({remainingCustomers})
          </button>
        </div>
      </div>

      {/* 取引先ワンボックス集約カード一覧 */}
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
      ) : (
        <div className="space-y-3">
          {visibleCards.map((c) => (
            <CustomerDeliveryCard
              key={c.customerId}
              {...c}
              onCompletionChange={handleCompletionChange}
            />
          ))}
        </div>
      )}
    </div>
  )
}
