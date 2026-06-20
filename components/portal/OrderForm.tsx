'use client'

import { useState } from 'react'
import toast from 'react-hot-toast'
import { useRouter } from 'next/navigation'
import { Minus, Plus, Loader2 } from 'lucide-react'
import { Input } from '@/components/ui/Input'
import { Card } from '@/components/ui/Card'

export interface DefaultSetItem {
  productId: string
  productName: string
  defaultQuantity: number
}

/**
 * 「いつものセット」発注フォーム（features.md §2-3）。
 * 数量だけ調整して送信。出荷希望日（delivery_date）は必須。送信中はボタン無効＋ローディング。
 */
export function OrderForm({ items, defaultDeliveryDate }: { items: DefaultSetItem[]; defaultDeliveryDate: string }) {
  const router = useRouter()
  const [qty, setQty] = useState<Record<string, number>>(
    Object.fromEntries(items.map((i) => [i.productId, i.defaultQuantity])),
  )
  const [deliveryDate, setDeliveryDate] = useState(defaultDeliveryDate)
  const [submitting, setSubmitting] = useState(false)

  const setOne = (id: string, n: number) => setQty((q) => ({ ...q, [id]: Math.max(0, n) }))
  const total = items.reduce((acc, i) => acc + (qty[i.productId] ?? 0), 0)

  async function submit() {
    const payload = {
      delivery_date: deliveryDate,
      items: items
        .map((i) => ({ product_id: i.productId, quantity: qty[i.productId] ?? 0 }))
        .filter((i) => i.quantity > 0),
    }
    if (!payload.items.length) {
      toast.error('数量を入力してください')
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch('/api/portal/orders', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error ?? `送信失敗: ${res.status}`)
      }
      toast.success('発注を受け付けました')
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '送信に失敗しました')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-4">
      <Input
        type="date"
        label="出荷希望日"
        required
        value={deliveryDate}
        onChange={(e) => setDeliveryDate(e.target.value)}
      />
      <Card className="space-y-1">
        <p className="mb-1 text-sm font-semibold text-ink">いつものセット</p>
        {items.map((i) => {
          const n = qty[i.productId] ?? 0
          return (
            <div key={i.productId} className="flex items-center justify-between gap-3 border-b border-line/60 py-2 last:border-0">
              <span className="min-w-0 truncate text-sm text-ink">{i.productName}</span>
              <span className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  aria-label={`${i.productName} を減らす`}
                  onClick={() => setOne(i.productId, n - 1)}
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-line text-ink-soft transition-colors hover:bg-bg-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-grape-200 disabled:opacity-40"
                  disabled={n <= 0}
                >
                  <Minus className="h-4 w-4" aria-hidden />
                </button>
                <input
                  type="number"
                  min={0}
                  inputMode="numeric"
                  aria-label={`${i.productName} の数量`}
                  className="num h-9 w-14 rounded-lg border border-line bg-bg-card text-center text-base font-bold text-ink focus:border-grape-500 focus:outline-none focus:ring-2 focus:ring-grape-200"
                  value={n}
                  onChange={(e) => setOne(i.productId, Number(e.target.value))}
                />
                <button
                  type="button"
                  aria-label={`${i.productName} を増やす`}
                  onClick={() => setOne(i.productId, n + 1)}
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-grape-600 text-white transition-colors hover:bg-grape-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-grape-200"
                >
                  <Plus className="h-4 w-4" aria-hidden />
                </button>
              </span>
            </div>
          )
        })}
        <div className="flex items-center justify-between pt-2">
          <span className="text-sm text-ink-soft">合計</span>
          <span className="num text-base font-bold text-ink">{total} 点</span>
        </div>
      </Card>
      <button
        type="button"
        onClick={submit}
        disabled={submitting}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-grape-600 text-base font-bold text-white shadow-sm transition-colors hover:bg-grape-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-grape-200 disabled:opacity-60"
      >
        {submitting && <Loader2 className="h-5 w-5 animate-spin" aria-hidden />}
        {submitting ? '送信中…' : 'この内容で発注する'}
      </button>
    </div>
  )
}
