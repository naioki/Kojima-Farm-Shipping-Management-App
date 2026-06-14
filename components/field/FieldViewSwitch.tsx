import Link from 'next/link'
import { CalendarDays, CalendarRange } from 'lucide-react'
import { cn } from '@/lib/cn'

/**
 * 出荷一覧（日次） ⇄ 週間マトリックス（週次）の表示切替。
 * 同じ出荷予定を「その日の作業リスト」と「1週間の俯瞰表」で行き来できるようにする。
 * date は基準日：日→その日、週→その日を含む7日（matrix の week 起点）。
 */
export function FieldViewSwitch({ active, date }: { active: 'day' | 'week'; date: string }) {
  const base = 'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium'
  return (
    <div className="inline-flex rounded-lg border border-line-strong p-0.5">
      <Link
        href={`/field/shipments?date=${date}`}
        aria-current={active === 'day' ? 'page' : undefined}
        className={cn(base, active === 'day' ? 'bg-earth-600 text-white' : 'text-ink-soft hover:bg-bg-soft')}
      >
        <CalendarDays className="h-4 w-4" aria-hidden />
        日
      </Link>
      <Link
        href={`/field/matrix?week=${date}`}
        aria-current={active === 'week' ? 'page' : undefined}
        className={cn(base, active === 'week' ? 'bg-earth-600 text-white' : 'text-ink-soft hover:bg-bg-soft')}
      >
        <CalendarRange className="h-4 w-4" aria-hidden />
        週
      </Link>
    </div>
  )
}
