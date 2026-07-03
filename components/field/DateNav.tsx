'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { jstTodayStr, shiftDateStr } from '@/lib/dates'

/**
 * 出荷一覧・マトリックスの日付コントロール（features.md §8）。
 * 前後・今日は <Link>（クエリのみの router.push は Next 14 でサーバー再描画されない場合があるため）。
 * カレンダー入力だけは push + refresh で確実に再取得する。
 */
export function DateNav({ date, basePath }: { date: string; basePath: string }) {
  const router = useRouter()
  const hrefFor = (d: string) => `${basePath}?date=${d}`

  const btn =
    'flex h-10 w-10 items-center justify-center rounded border border-line text-ink-soft hover:bg-bg-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-trust-100'

  return (
    <div className="flex items-center gap-2">
      <Link href={hrefFor(shiftDateStr(date, -1))} aria-label="前の日" className={btn}>
        <ChevronLeft className="h-5 w-5" aria-hidden />
      </Link>

      <input
        type="date"
        value={date}
        onChange={(e) => {
          if (!e.target.value) return
          router.push(hrefFor(e.target.value))
          router.refresh()
        }}
        aria-label="表示日"
        className="num h-10 rounded border border-line-strong bg-bg-card px-3 text-sm text-ink focus:outline-none focus:border-trust-500 focus:ring-2 focus:ring-trust-100"
      />

      <Link href={hrefFor(shiftDateStr(date, 1))} aria-label="次の日" className={btn}>
        <ChevronRight className="h-5 w-5" aria-hidden />
      </Link>

      <Link
        href={hrefFor(jstTodayStr())}
        className="h-10 rounded border border-line px-3 text-sm font-medium leading-10 text-ink-soft hover:bg-bg-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-trust-100"
      >
        今日
      </Link>
    </div>
  )
}
