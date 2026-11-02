import Link from 'next/link'
import { PackageCheck, Truck, CalendarRange } from 'lucide-react'
import { cn } from '@/lib/cn'

/**
 * 現場3大画面（収穫・パックボード ⇄ 便別積込・配送リスト ⇄ 週間マトリックス）の統合スイッチャー。
 * 基準日（date）を維持したまま、どの画面からでも1タップで相互に行き来できる。
 */
export function FieldViewSwitch({
  active,
  date,
}: {
  active: 'day' | 'delivery' | 'week'
  date: string
}) {
  const base =
    'inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs sm:text-sm font-black transition-all active:scale-95'
  return (
    <div className="inline-flex rounded-xl border border-line-strong bg-bg-soft p-1 shadow-2xs">
      <Link
        href={`/field/shipments?date=${date}`}
        aria-current={active === 'day' ? 'page' : undefined}
        className={cn(
          base,
          active === 'day'
            ? 'bg-forest-700 text-white shadow-xs'
            : 'text-ink-soft hover:bg-white/80 hover:text-ink',
        )}
      >
        <PackageCheck className="h-4 w-4 shrink-0" aria-hidden />
        <span>パック</span>
      </Link>
      <Link
        href={`/field/deliveries?date=${date}`}
        aria-current={active === 'delivery' ? 'page' : undefined}
        className={cn(
          base,
          active === 'delivery'
            ? 'bg-forest-700 text-white shadow-xs'
            : 'text-ink-soft hover:bg-white/80 hover:text-ink',
        )}
      >
        <Truck className="h-4 w-4 shrink-0" aria-hidden />
        <span>積込・配送</span>
      </Link>
      <Link
        href={`/field/matrix?week=${date}`}
        aria-current={active === 'week' ? 'page' : undefined}
        className={cn(
          base,
          active === 'week'
            ? 'bg-earth-600 text-white shadow-xs'
            : 'text-ink-soft hover:bg-white/80 hover:text-ink',
        )}
      >
        <CalendarRange className="h-4 w-4 shrink-0" aria-hidden />
        <span>週間表</span>
      </Link>
    </div>
  )
}
