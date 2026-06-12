'use client'

import { useState } from 'react'
import toast from 'react-hot-toast'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
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
      <Card className="space-y-3">
        {items.map((i) => (
          <div key={i.productId} className="flex items-center justify-between gap-3">
            <span className="text-sm text-ink">{i.productName}</span>
            <input
              type="number"
              min={0}
              inputMode="numeric"
              aria-label={`${i.productName} の数量`}
              className="num h-11 w-24 rounded border border-line-strong bg-bg-card px-3 text-right text-sm focus:border-trust-500 focus:outline-none focus:ring-2 focus:ring-trust-100"
              value={qty[i.productId] ?? 0}
              onChange={(e) => setQty((q) => ({ ...q, [i.productId]: Number(e.target.value) }))}
            />
          </div>
        ))}
      </Card>
      <Button size="lg" className="w-full" onClick={submit} isLoading={submitting} disabled={submitting}>
        発注する
      </Button>
    </div>
  )
}
