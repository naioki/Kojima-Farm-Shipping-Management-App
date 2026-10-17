'use client'

import Link from 'next/link'
import { cn } from '@/lib/cn'
import type { InboxFilter, InboxCounts } from '@/lib/orders/inbox'

/** 受注ボックスのフィルタチップ。URLクエリ ?filter= で状態を保持し、各チップに件数を表示する。 */
const CHIPS: { key: InboxFilter; label: string }[] = [
  { key: 'all', label: 'すべて' },
  { key: 'parsing', label: '解析待ち' },
  { key: 'review', label: '要確認' },
  { key: 'pending', label: '承認待ち' },
  { key: 'approved', label: '今日承認済み' },
]

export function InboxFilterChips({ active, counts }: { active: InboxFilter; counts: InboxCounts }) {
  return (
    <div className="flex flex-wrap gap-2" role="tablist" aria-label="受注ボックスの絞り込み">
      {CHIPS.map((chip) => {
        const isActive = chip.key === active
        const count = counts[chip.key]
        return (
          <Link
            key={chip.key}
            href={chip.key === 'all' ? '/admin/inbox' : `/admin/inbox?filter=${chip.key}`}
            role="tab"
            aria-selected={isActive}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-trust-100',
              isActive
                ? 'border-earth-500 bg-earth-500 text-white'
                : 'border-line-strong bg-bg-card text-ink-soft hover:bg-bg-soft',
            )}
          >
            {chip.label}
            <span
              className={cn(
                'num rounded-full px-1.5 text-xs tabular-nums',
                isActive ? 'bg-white/25 text-white' : 'bg-bg-soft text-ink-faint',
              )}
            >
              {count}
            </span>
          </Link>
        )
      })}
    </div>
  )
}
