import Link from 'next/link'
import { PackageCheck, Truck, CalendarRange } from 'lucide-react'
import { cn } from '@/lib/cn'

/**
 * 現場3大画面（収穫・パックボード ⇄ 便別積込・配送リスト ⇄ 週間マトリックス）の統合スイッチャー。
 * 基準日（date）および選択中の品目（product）を維持したまま、どの画面からでも1タップで相互に行き来できる（#01, #04）。
 */
export function FieldViewSwitch({
  active,
  date,
  product,
}: {
  active: 'day' | 'delivery' | 'week'
  date: string
  product?: string | null
}) {
  const prodParam = product ? `&product=${encodeURIComponent(product)}` : ''
  const base =
    'inline-flex flex-1 sm:flex-initial min-h-[42px] items-center justify-center gap-1.5 rounded-lg px-2.5 sm:px-3.5 py-1.5 text-xs sm:text-sm font-black transition-all active:scale-95'
  return (
    <div className="grid grid-cols-3 sm:inline-flex w-full sm:w-auto rounded-xl border border-line-strong bg-bg-soft p-1 shadow-2xs gap-1">
      <Link
        href={`/field/shipments?date=${date}${prodParam}`}
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
        href={`/field/deliveries?date=${date}${prodParam}`}
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
        href={`/field/matrix?week=${date}&date=${date}${prodParam}`}
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
