'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { cn } from '@/lib/cn'

export interface ProductTabItem {
  id: string
  name: string
  count: number
  incompleteCount?: number
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

  const otherIncompleteTabs = products.filter(
    (p) => p.id !== selectedProductId && (p.incompleteCount ?? 0) > 0,
  )

  return (
    <div className="w-full space-y-2 overflow-hidden">
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
        {products.map((p) => {
          const isActive = p.id === selectedProductId
          const incomplete = p.incompleteCount ?? 0
          const isAllDone = p.count > 0 && incomplete === 0

          return (
            <button
              key={p.id}
              type="button"
              onClick={() => handleSelect(p.id)}
              className={cn(
                'inline-flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2 text-sm font-black transition-all active:scale-95',
                isActive
                  ? 'bg-[#1b5e20] text-white shadow-md ring-2 ring-emerald-700/30'
                  : incomplete > 0
                  ? 'border-2 border-amber-400 bg-amber-50 text-amber-950 hover:bg-amber-100 shadow-2xs'
                  : 'border border-line bg-white text-ink-soft hover:bg-bg-soft hover:text-ink',
              )}
            >
              <span>{p.name}</span>
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 text-xs font-black tabular-nums',
                  isActive
                    ? incomplete > 0
                      ? 'bg-amber-300 text-amber-950'
                      : 'bg-white/20 text-white'
                    : isAllDone
                    ? 'bg-emerald-100 text-emerald-800'
                    : incomplete > 0
                    ? 'bg-amber-500 text-white'
                    : 'bg-bg-soft text-ink-muted',
                )}
              >
                {isAllDone
                  ? `✓ ${p.count}完`
                  : incomplete > 0
                  ? `残${incomplete}/${p.count}`
                  : p.count}
              </span>
            </button>
          )
        })}
      </div>

      {/* 他品目に未完了がある場合の横断作り忘れ防止バナー */}
      {otherIncompleteTabs.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-black text-amber-950 shadow-2xs">
          <div className="flex items-center gap-1.5">
            <span>🚨</span>
            <span>
              他品目にも未完了のパック作業があります：
              {otherIncompleteTabs.map((t) => `${t.name}（残り${t.incompleteCount}件）`).join('・')}
            </span>
          </div>
          <button
            type="button"
            onClick={() => handleSelect(otherIncompleteTabs[0]!.id)}
            className="rounded-lg bg-amber-600 px-2.5 py-1 text-white hover:bg-amber-700 transition shrink-0"
          >
            {otherIncompleteTabs[0]!.name}を開く →
          </button>
        </div>
      )}
    </div>
  )
}
