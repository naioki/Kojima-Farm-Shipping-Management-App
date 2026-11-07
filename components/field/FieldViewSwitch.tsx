'use client'

import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'
import { PackageCheck, Truck, CalendarRange } from 'lucide-react'
import toast from 'react-hot-toast'
import { cn } from '@/lib/cn'

/**
 * 現場3大画面（収穫・パックボード ⇄ 便別積込・配送リスト ⇄ 週間マトリックス）の統合スイッチャー。
 * - 基準日（date）および選択中の品目（product）を維持したまま、どの画面からでも1タップで相互に行き来できる（#01, #04）。
 * - すでに開いている画面のタブを再タップした場合は、無反応にせず最新データへの再取得（router.refresh）を実行する。
 */
export function FieldViewSwitch({
  active,
  date,
  product,
}: {
  active: 'day' | 'delivery' | 'week' | 'concierge'
  date: string
  product?: string | null
}) {
  const router = useRouter()
  const pathname = usePathname()
  const prodParam = product ? `&product=${encodeURIComponent(product)}` : ''
  const base =
    'inline-flex flex-1 sm:flex-initial min-h-11 items-center justify-center gap-1.5 rounded-lg px-2.5 sm:px-3.5 py-1.5 text-xs sm:text-sm font-black transition-all active:scale-95'

  const handleSameTabClick = (targetPath: string, label: string) => {
    if (pathname === targetPath) {
      router.refresh()
      toast.success(`${label}の最新データを取得しました`, { id: 'tab-refresh-toast', duration: 1500 })
    }
  }

  return (
    <div className="grid grid-cols-3 sm:inline-flex w-full sm:w-auto rounded-xl border border-line-strong bg-bg-soft p-1 shadow-2xs gap-1">
      <Link
        href={`/field/shipments?date=${date}${prodParam}`}
        onClick={() => handleSameTabClick('/field/shipments', '収穫・パックボード')}
        aria-current={active === 'day' && pathname === '/field/shipments' ? 'page' : undefined}
        className={cn(
          base,
          active === 'day' && pathname === '/field/shipments'
            ? 'bg-forest-700 text-white shadow-xs'
            : 'text-ink-soft hover:bg-bg-card/80 hover:text-ink',
        )}
      >
        <PackageCheck className="h-4 w-4 shrink-0" aria-hidden />
        <span className="whitespace-nowrap"><span className="hidden sm:inline">収穫・</span>パック</span>
      </Link>
      <Link
        href={`/field/deliveries?date=${date}${prodParam}`}
        onClick={() => handleSameTabClick('/field/deliveries', '積込・配送リスト')}
        aria-current={active === 'delivery' ? 'page' : undefined}
        className={cn(
          base,
          active === 'delivery'
            ? 'bg-forest-700 text-white shadow-xs'
            : 'text-ink-soft hover:bg-bg-card/80 hover:text-ink',
        )}
      >
        <Truck className="h-4 w-4 shrink-0" aria-hidden />
        <span className="whitespace-nowrap">積込・配送</span>
      </Link>
      <Link
        href={`/field/matrix?week=${date}&date=${date}${prodParam}`}
        onClick={() => handleSameTabClick('/field/matrix', '週の管理')}
        aria-current={active === 'week' ? 'page' : undefined}
        className={cn(
          base,
          active === 'week'
            ? 'bg-earth-600 text-white shadow-xs'
            : 'text-ink-soft hover:bg-bg-card/80 hover:text-ink',
        )}
      >
        <CalendarRange className="h-4 w-4 shrink-0" aria-hidden />
        <span className="whitespace-nowrap">週の管理</span>
      </Link>
    </div>
  )
}
