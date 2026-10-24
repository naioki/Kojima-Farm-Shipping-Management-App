'use client'

import { useEffect, useState } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/cn'
import {
  CustomerDeliveryCard,
  type CustomerDeliveryCardProps,
} from '@/components/field/CustomerDeliveryCard'

export interface DeliveriesBoardViewProps {
  initialCards: (CustomerDeliveryCardProps & {
    earliestDepartureTime: string | null
  })[]
}

export function DeliveriesBoardView({ initialCards }: DeliveriesBoardViewProps) {
  const [cards, setCards] = useState(initialCards)
  const [filterMode, setFilterMode] = useState<'all' | 'incomplete'>('all')

  useEffect(() => {
    setCards(initialCards)
  }, [initialCards])

  const handleCompletionChange = (customerId: string, isCompleted: boolean) => {
    setCards((prev) =>
      prev.map((c) => (c.customerId === customerId ? { ...c, isCompleted } : c)),
    )
  }

  const totalCustomers = cards.length
  const completedCustomers = cards.filter((c) => c.isCompleted).length
  const remainingCustomers = totalCustomers - completedCustomers

  const visibleCards =
    filterMode === 'incomplete' ? cards.filter((c) => !c.isCompleted) : cards

  return (
    <div className="space-y-3.5">
      {/* 進捗表示（取引先集約進捗 ＆ ワンタップ未積込フィルタ） */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-earth-200 bg-earth-50 px-4 py-3 print:hidden">
        <div className="flex items-center gap-2">
          <span className="text-xs sm:text-sm font-bold text-ink-soft">
            本日の積込進捗
          </span>
          <span className="text-ink-soft font-medium text-xs sm:text-sm flex items-center">
            完了{' '}
            <span className="num text-2xl font-black tabular-nums text-earth-700 mx-1">
              {completedCustomers}
            </span>
            <span className="mx-1">/</span>
            {totalCustomers} 取引先
            {remainingCustomers > 0 ? (
              <span className="ml-2 rounded-full bg-amber-100 text-amber-800 border border-amber-300 px-2 py-0.5 text-xs font-black">
                残り {remainingCustomers}
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
        <div className="space-y-3.5">
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
