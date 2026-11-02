'use client'

import { useRef } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ChevronLeft, ChevronRight, Calendar, RotateCcw } from 'lucide-react'
import { jstTodayStr, shiftDateStr, formatJpDateShort } from '@/lib/dates'
import { cn } from '@/lib/cn'

/**
 * 出荷一覧・配送・印刷の日付コントロール（#04「本日作業」の二重表示排除 ＆ 360px幅での1行完結レイアウト）。
 * - 既に基準日（明日納品分＝本日作業分）を表示している時は冗長な「明日納品（本日作業）」ボタンを非表示にし、
 *   別の日付を見ている時だけ「本日作業分へ戻る」ワンタップボタンを表示することで横幅をスッキリ保つ。
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
  const isDefaultSelected = date === targetDate
  const label = defaultLabel ?? '本日作業分へ'
  const packWorkDate = shiftDateStr(date, -1)
  const isTodayPackWork = packWorkDate === jstTodayStr()
  const isTodayDelivery = date === jstTodayStr()

  const btn =
    'flex h-9 w-8 sm:h-10 sm:w-9 shrink-0 items-center justify-center rounded-xl border border-line bg-bg-card text-ink-soft hover:bg-bg-soft hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-trust-100 active:scale-95 transition'

  return (
    <div className="flex items-center gap-1 shrink-0">
      <Link href={hrefFor(shiftDateStr(date, -1))} aria-label="前の日" className={btn}>
        <ChevronLeft className="h-4 w-4" aria-hidden />
      </Link>

      {/* 1ボタン統合カレンダーピッカー（納品日 ＋ 前日作業日を1枠で明記し、右隣ボタンとの重複を完全解消） */}
      <div
        onClick={() => {
          try {
            dateInputRef.current?.showPicker?.()
          } catch {
            dateInputRef.current?.focus()
          }
        }}
        className={cn(
          'relative flex items-center gap-1.5 rounded-xl border px-2.5 py-1 shadow-2xs cursor-pointer transition select-none',
          isTodayPackWork
            ? 'border-emerald-600 bg-emerald-50/90 hover:bg-emerald-100/80'
            : isTodayDelivery
            ? 'border-sky-500 bg-sky-50/90 hover:bg-sky-100/80'
            : 'border-line-strong bg-bg-card hover:bg-bg-soft',
        )}
        title="タップしてカレンダーから日付を選択"
      >
        <Calendar
          className={cn(
            'h-3.5 w-3.5 shrink-0',
            isTodayPackWork ? 'text-emerald-700' : isTodayDelivery ? 'text-sky-700' : 'text-ink-soft',
          )}
          aria-hidden
        />
        <div className="flex items-center gap-1.5 leading-tight">
          <span className="num text-xs sm:text-sm font-black tabular-nums text-ink whitespace-nowrap">
            {formatJpDateShort(date)}納品
          </span>
          <span
            className={cn(
              'rounded px-1.5 py-0.5 text-[10px] font-black whitespace-nowrap',
              isTodayPackWork
                ? 'bg-emerald-700 text-white'
                : isTodayDelivery
                ? 'bg-sky-600 text-white'
                : 'bg-slate-200 text-slate-700',
            )}
          >
            {isTodayPackWork
              ? `本日(${formatJpDateShort(packWorkDate)})作業`
              : isTodayDelivery
              ? '本日納品'
              : `前日${formatJpDateShort(packWorkDate)}作業`}
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
        <ChevronRight className="h-4 w-4" aria-hidden />
      </Link>

      {/* 基準日（明日納品＝本日作業）以外を見ている時のみ「本日作業分へ戻る」ボタンを表示（重複排除） */}
      {!isDefaultSelected && (
        <Link
          href={hrefFor(targetDate)}
          className="inline-flex h-9 sm:h-10 shrink-0 items-center justify-center gap-1 rounded-xl border border-forest-600 bg-forest-700 px-2.5 text-xs font-black text-white shadow-2xs transition hover:bg-forest-800 active:scale-95"
          title="明日納品（本日パック作業）へ戻る"
        >
          <RotateCcw className="h-3 w-3" />
          <span>{label === '明日納品（本日作業）' ? '本日作業へ' : label}</span>
        </Link>
      )}
    </div>
  )
}
