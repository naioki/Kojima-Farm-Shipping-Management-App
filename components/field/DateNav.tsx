'use client'

import { useRef } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ChevronLeft, ChevronRight, Calendar, RotateCcw } from 'lucide-react'
import { jstTodayStr, shiftDateStr, formatJpDateShort } from '@/lib/dates'
import { cn } from '@/lib/cn'

/**
 * 出荷一覧・配送・印刷の日付コントロール（v5.1.11 赤丸エリア視認性刷新版）。
 * - `本日(11/3(火))作業` の二重カッコ `((火))` を解消し、`11/4(水) 納品` ＋ `本日 11/3 作業` のスッキリしたバッジに改善。
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
  const label = defaultLabel ?? '本日作業へ'
  const packWorkDate = shiftDateStr(date, -1)
  const isTodayPackWork = packWorkDate === jstTodayStr()
  const isTodayDelivery = date === jstTodayStr()

  // 曜日カッコを除いた短い月日（例: "11/3"）を生成して二重カッコ ((火)) を防止
  const shortWorkMd = formatJpDateShort(packWorkDate).replace(/[（(][^）)]+[）)]/g, '')

  const btn =
    'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line bg-bg-card text-ink-soft hover:bg-bg-soft hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-trust-100 active:scale-95 transition shadow-2xs'

  return (
    <div className="w-full space-y-1.5">
      <div className="flex items-center gap-1.5 w-full">
        <Link href={hrefFor(shiftDateStr(date, -1))} aria-label="前の日" className={btn}>
          <ChevronLeft className="h-4 w-4 sm:h-5 sm:w-5" aria-hidden />
        </Link>

        {/* 1ボタン統合カレンダーピッカー（左右矢印の間に100%収まり右端見切れを完全防止） */}
        <div
          onClick={() => {
            try {
              dateInputRef.current?.showPicker?.()
            } catch {
              dateInputRef.current?.focus()
            }
          }}
          className={cn(
            'relative flex flex-1 min-w-0 items-center justify-center gap-1.5 sm:gap-2 rounded-xl border px-2 sm:px-3 h-10 shadow-2xs cursor-pointer transition select-none overflow-hidden',
            isTodayPackWork
              ? 'border-harvest-600 bg-harvest-50/90 hover:bg-harvest-100/80'
              : isTodayDelivery
              ? 'border-trust-500 bg-trust-50/90 hover:bg-trust-100/80'
              : 'border-line-strong bg-bg-card hover:bg-bg-soft',
          )}
          title="タップしてカレンダーから日付を選択"
        >
          <Calendar
            className={cn(
              'h-4 w-4 shrink-0',
              isTodayPackWork ? 'text-harvest-700' : isTodayDelivery ? 'text-trust-700' : 'text-ink-soft',
            )}
            aria-hidden
          />
          <div className="flex items-center gap-1.5 sm:gap-2 leading-none min-w-0">
            <span className="num text-sm sm:text-base font-black tabular-nums text-ink whitespace-nowrap">
              {formatJpDateShort(date)} 納品
            </span>
            <span
              className={cn(
                'rounded-md px-1.5 sm:px-2 py-1 text-xs font-black whitespace-nowrap shrink-0',
                isTodayPackWork
                  ? 'bg-harvest-700 text-white'
                  : isTodayDelivery
                  ? 'bg-trust-600 text-white'
                  : 'bg-line text-ink-soft',
              )}
            >
              {isTodayPackWork
                ? `本日 ${shortWorkMd} 作業`
                : isTodayDelivery
                ? '本日納品'
                : `前日 ${shortWorkMd} 作業`}
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

        {/* PC・タブレット幅（sm以上）では右横に配置 */}
        {!isDefaultSelected && (
          <Link
            href={hrefFor(targetDate)}
            className="hidden sm:inline-flex h-10 shrink-0 items-center justify-center gap-1 rounded-xl border border-forest-600 bg-forest-700 px-3 text-xs font-black text-white shadow-2xs transition hover:bg-forest-800 active:scale-95"
            title="明日納品（本日パック作業）へ戻る"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>{label === '明日納品（本日作業）' ? '本日作業へ戻る' : label}</span>
          </Link>
        )}
      </div>

      {/* スマホ幅（sm未満）で別日を見ている時は、見切れを防ぐため直下にフル幅ボタンとして表示 */}
      {!isDefaultSelected && (
        <Link
          href={hrefFor(targetDate)}
          className="flex sm:hidden h-10 w-full items-center justify-center gap-1.5 rounded-xl border border-forest-600 bg-forest-700 px-3 text-xs font-black text-white shadow-2xs transition hover:bg-forest-800 active:scale-[0.99]"
          title="明日納品（本日パック作業）へ戻る"
        >
          <RotateCcw className="h-3.5 w-3.5 shrink-0" />
          <span>{label === '明日納品（本日作業）' ? `本日作業（${formatJpDateShort(targetDate)}納品分）へ戻る` : label}</span>
        </Link>
      )}
    </div>
  )
}
