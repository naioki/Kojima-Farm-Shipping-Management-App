'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { cn } from '@/lib/cn'

export interface ProductTabItem {
  id: string
  name: string
  count: number
}

interface ProductSelectorTabsProps {
  products: ProductTabItem[]
  selectedProductId: string
  date: string
}

export function ProductSelectorTabs({
  products,
  selectedProductId,
  date,
}: ProductSelectorTabsProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const handleSelect = (productId: string) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('product', productId)
    if (date) params.set('date', date)
    router.push(`/field/shipments?${params.toString()}`)
  }

  if (products.length === 0) return null

  return (
    <div className="w-full overflow-hidden">
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
        {products.map((p) => {
          const isActive = p.id === selectedProductId
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => handleSelect(p.id)}
              className={cn(
                'inline-flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2.5 text-sm font-black transition-all active:scale-95',
                isActive
                  ? 'bg-[#1b5e20] text-white shadow-md'
                  : 'border border-line bg-white text-ink-soft hover:bg-bg-soft hover:text-ink',
              )}
            >
              <span>{p.name}</span>
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 text-xs font-bold tabular-nums',
                  isActive ? 'bg-white/20 text-white' : 'bg-bg-soft text-ink-muted',
                )}
              >
                {p.count}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
