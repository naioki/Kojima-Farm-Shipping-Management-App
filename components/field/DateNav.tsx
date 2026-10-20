'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { jstTodayStr, shiftDateStr, formatJpDateShort } from '@/lib/dates'

import { cn } from '@/lib/cn'

/**
 * 出荷一覧・マトリックスの日付コントロール（features.md §8）。
 * モバイル（360px〜）でも「今日」ボタンがはみ出さないレスポンシブ設計。
 */
export function DateNav({ date, basePath }: { date: string; basePath: string }) {
  const router = useRouter()
  const hrefFor = (d: string) => `${basePath}?date=${d}`
  const isToday = date === jstTodayStr()

  const btn =
    'flex h-9 w-9 sm:h-10 sm:w-10 shrink-0 items-center justify-center rounded-lg border border-line bg-bg-card text-ink-soft hover:bg-bg-soft hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-trust-100 active:scale-95 transition'

  return (
    <div className="flex items-center gap-1 sm:gap-2 shrink-0">
      <Link href={hrefFor(shiftDateStr(date, -1))} aria-label="前の日" className={btn}>
        <ChevronLeft className="h-4 w-4 sm:h-5 sm:w-5" aria-hidden />
      </Link>

      {/* 日本標準の「月/日(曜)」とカレンダー入力をすっきり横並び */}
      <label className="flex items-center gap-1 sm:gap-1.5 rounded-lg border border-line-strong bg-bg-card px-2 py-1 sm:px-2.5 sm:py-1.5 shadow-xs">
        <span className="num text-sm sm:text-base font-black tabular-nums text-ink whitespace-nowrap">
          {formatJpDateShort(date)}
        </span>
        <input
          type="date"
          value={date}
          onChange={(e) => {
            if (!e.target.value) return
            router.push(hrefFor(e.target.value))
            router.refresh()
          }}
          aria-label="表示日"
          className="num h-6 w-24 sm:w-32 rounded border-0 bg-transparent p-0 text-xs sm:text-sm text-ink-soft focus:outline-none cursor-pointer font-bold"
        />
      </label>

      <Link href={hrefFor(shiftDateStr(date, 1))} aria-label="次の日" className={btn}>
        <ChevronRight className="h-4 w-4 sm:h-5 sm:w-5" aria-hidden />
      </Link>

      <Link
        href={hrefFor(jstTodayStr())}
        className={cn(
          'flex h-9 sm:h-10 shrink-0 items-center justify-center rounded-lg border px-2.5 sm:px-3 text-xs sm:text-sm font-bold transition active:scale-95',
          isToday
            ? 'border-forest-400 bg-forest-50 text-forest-800 shadow-xs'
            : 'border-line bg-bg-card text-ink-soft hover:bg-bg-soft hover:text-ink',
        )}
      >
        今日
      </Link>
    </div>
  )
}
