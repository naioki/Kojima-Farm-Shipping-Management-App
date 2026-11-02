'use client'

import { useRef } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react'
import { jstTodayStr, shiftDateStr, formatJpDateShort } from '@/lib/dates'
import { cn } from '@/lib/cn'

/**
 * 出荷一覧・配送・印刷の日付コントロール（#02「納品日」と「前日パック作業日」の並列明記 ＆ #03 日付二重表示の解消）。
 * モバイル（360px〜）でもスッキリ1タップでカレンダーが開き、選択中の品目パラメータ（?product=）も維持する。
 */
export function DateNav({
  date,
  basePath,
  defaultDate,
  defaultLabel,
  product,
}: {
  date: string
  basePath: string
  defaultDate?: string
  defaultLabel?: string
  product?: string | null
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const dateInputRef = useRef<HTMLInputElement>(null)
  const effectiveProduct = product ?? searchParams?.get('product') ?? null

  const hrefFor = (d: string) => {
    const params = new URLSearchParams()
    params.set('date', d)
    if (effectiveProduct) params.set('product', effectiveProduct)
    return `${basePath}?${params.toString()}`
  }

  const targetDate = defaultDate ?? shiftDateStr(jstTodayStr(), 1)
  const isSelected = date === targetDate
  const label = defaultLabel ?? '明日納品（本日作業）'
  const packWorkDate = shiftDateStr(date, -1)
  const isTodayPackWork = packWorkDate === jstTodayStr()

  const btn =
    'flex h-10 w-9 sm:w-10 shrink-0 items-center justify-center rounded-xl border border-line bg-bg-card text-ink-soft hover:bg-bg-soft hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-trust-100 active:scale-95 transition'

  return (
    <div className="flex items-center gap-1 sm:gap-1.5 shrink-0 flex-wrap">
      <Link href={hrefFor(shiftDateStr(date, -1))} aria-label="前の日" className={btn}>
        <ChevronLeft className="h-4 w-4 sm:h-5 sm:w-5" aria-hidden />
      </Link>

      {/* 1ボタン統合カレンダーピッカー（納品日 ＋ 前日パック作業日を明記、二重表示を解消） */}
      <div
        onClick={() => {
          try {
            dateInputRef.current?.showPicker?.()
          } catch {
            dateInputRef.current?.focus()
          }
        }}
        className={cn(
          'relative flex items-center gap-1.5 rounded-xl border px-2.5 py-1 sm:px-3 sm:py-1.5 shadow-2xs cursor-pointer transition select-none',
          isTodayPackWork
            ? 'border-emerald-500 bg-emerald-50/70 hover:bg-emerald-100/70'
            : 'border-line-strong bg-bg-card hover:bg-bg-soft',
        )}
        title="タップして日付を選択"
      >
        <Calendar className={cn('h-4 w-4 shrink-0', isTodayPackWork ? 'text-emerald-700' : 'text-ink-soft')} aria-hidden />
        <div className="flex flex-col leading-tight">
          <div className="flex items-center gap-1">
            <span className="num text-xs sm:text-sm font-black tabular-nums text-ink whitespace-nowrap">
              {formatJpDateShort(date)} 納品分
            </span>
            {isTodayPackWork && (
              <span className="rounded bg-emerald-600 text-white px-1.5 py-0.2 text-[10px] font-black whitespace-nowrap">
                本日作業
              </span>
            )}
          </div>
          <span className="text-[10px] font-bold text-ink-soft whitespace-nowrap">
            前日 {formatJpDateShort(packWorkDate)} パック作業
          </span>
        </div>
        <input
          ref={dateInputRef}
          type="date"
          value={date}
          onChange={(e) => {
            if (!e.target.value) return
            router.push(hrefFor(e.target.value))
            router.refresh()
          }}
          aria-label="表示日を選択"
          className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
        />
      </div>

      <Link href={hrefFor(shiftDateStr(date, 1))} aria-label="次の日" className={btn}>
        <ChevronRight className="h-4 w-4 sm:h-5 sm:w-5" aria-hidden />
      </Link>

      <Link
        href={hrefFor(targetDate)}
        className={cn(
          'flex h-10 shrink-0 items-center justify-center rounded-xl border px-2.5 sm:px-3 text-xs font-black transition active:scale-95',
          isSelected
            ? 'border-forest-500 bg-forest-700 text-white shadow-xs'
            : 'border-line bg-bg-card text-ink-soft hover:bg-bg-soft hover:text-ink',
        )}
      >
        {label}
      </Link>
    </div>
  )
}
