'use client'

import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight } from 'lucide-react'

/** YYYY-MM-DD を n 日ずらす（ローカルタイムに依存しない素朴計算） */
function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00`)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

/**
 * 出荷一覧・マトリックスの日付コントロール（features.md §8）。
 * 前後ボタン＋カレンダー入力で表示日を即切り替え。URL の ?date= を更新する。
 */
export function DateNav({ date, basePath }: { date: string; basePath: string }) {
  const router = useRouter()
  const go = (d: string) => router.push(`${basePath}?date=${d}`)

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => go(shiftDate(date, -1))}
        aria-label="前の日"
        className="flex h-10 w-10 items-center justify-center rounded border border-line text-ink-soft hover:bg-bg-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-trust-100"
      >
        <ChevronLeft className="h-5 w-5" aria-hidden />
      </button>

      <input
        type="date"
        value={date}
        onChange={(e) => e.target.value && go(e.target.value)}
        aria-label="表示日"
        className="num h-10 rounded border border-line-strong bg-bg-card px-3 text-sm text-ink focus:outline-none focus:border-trust-500 focus:ring-2 focus:ring-trust-100"
      />

      <button
        type="button"
        onClick={() => go(shiftDate(date, 1))}
        aria-label="次の日"
        className="flex h-10 w-10 items-center justify-center rounded border border-line text-ink-soft hover:bg-bg-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-trust-100"
      >
        <ChevronRight className="h-5 w-5" aria-hidden />
      </button>

      <button
        type="button"
        onClick={() => go(new Date().toISOString().slice(0, 10))}
        className="h-10 rounded border border-line px-3 text-sm font-medium text-ink-soft hover:bg-bg-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-trust-100"
      >
        今日
      </button>
    </div>
  )
}
