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
  unit?: string
  defaultQuantity: number
}

export interface PortalDestinationOption {
  id: string
  label: string
}

/**
 * 「いつものセット」発注フォーム（features.md §2-3）。
 * 数量だけ調整して送信。出荷希望日（delivery_date）は必須。納入先選択・備考入力にも対応。
 */
export function OrderForm({
  items,
  destinations = [],
  defaultDeliveryDate,
}: {
  items: DefaultSetItem[]
  destinations?: PortalDestinationOption[]
  defaultDeliveryDate: string
}) {
  const router = useRouter()
  const [qty, setQty] = useState<Record<string, number>>(
    Object.fromEntries(items.map((i) => [i.productId, i.defaultQuantity])),
  )
  const [deliveryDate, setDeliveryDate] = useState(defaultDeliveryDate)
  const [destinationId, setDestinationId] = useState(destinations.length === 1 ? destinations[0]!.id : '')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const setOne = (id: string, n: number) => setQty((q) => ({ ...q, [id]: Math.max(0, n) }))
  const total = items.reduce((acc, i) => acc + (qty[i.productId] ?? 0), 0)

  async function submit() {
    const payload = {
      delivery_date: deliveryDate,
      destination_id: destinationId || undefined,
      note: note.trim() || undefined,
      items: items
        .map((i) => ({ product_id: i.productId, quantity: qty[i.productId] ?? 0 }))
        .filter((i) => i.quantity > 0),
    }
    if (!payload.items.length) {
      toast.error('数量を1以上入力してください')
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

      {destinations.length > 0 && (
        <div className="space-y-1">
          <label className="block text-sm font-medium text-ink" htmlFor="portal-destination">
            お届け先（店舗・センター）
          </label>
          <select
            id="portal-destination"
            value={destinationId}
            onChange={(e) => setDestinationId(e.target.value)}
            className="h-10 w-full rounded-lg border border-line-strong bg-bg-card px-3 text-sm text-ink focus:border-grape-500 focus:outline-none focus:ring-2 focus:ring-grape-200"
          >
            <option value="">指定なし（標準）</option>
            {destinations.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
        </div>
      )}

      <Card className="space-y-1">
        <div className="mb-1 flex items-center justify-between">
          <p className="text-sm font-semibold text-ink">発注品目・数量</p>
          <button
            type="button"
            onClick={() => {
              setQty(Object.fromEntries(items.map((i) => [i.productId, i.defaultQuantity])))
              toast.success('いつもの数量をセットしました')
            }}
            className="text-xs font-medium text-grape-600 hover:underline"
          >
            いつもの数量をセット
          </button>
        </div>
        {items.map((i) => {
          const n = qty[i.productId] ?? 0
          return (
            <div
              key={i.productId}
              className="flex items-center justify-between gap-3 border-b border-line/60 py-2 last:border-0"
            >
              <span className="min-w-0 truncate text-sm text-ink">{i.productName}</span>
              <span className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  aria-label={`${i.productName} を減らす`}
                  onClick={() => setOne(i.productId, n - 1)}
                  className="flex h-12 w-12 items-center justify-center rounded-xl border border-line text-ink-soft transition-colors hover:bg-bg-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-grape-200 disabled:opacity-40 active:scale-95"
                  disabled={n <= 0}
                >
                  <Minus className="h-4 w-4" aria-hidden />
                </button>
                <input
                  type="number"
                  min={0}
                  inputMode="numeric"
                  aria-label={`${i.productName} の数量`}
                  className="num h-12 w-20 rounded-xl border border-line bg-bg-card text-center text-lg font-bold text-ink focus:border-grape-500 focus:outline-none focus:ring-2 focus:ring-grape-200"
                  value={n}
                  onChange={(e) => setOne(i.productId, Number(e.target.value))}
                />
                <span className="text-xs text-ink-soft w-6">{i.unit ?? '点'}</span>
                <button
                  type="button"
                  aria-label={`${i.productName} を増やす`}
                  onClick={() => setOne(i.productId, n + 1)}
                  className="flex h-12 w-12 items-center justify-center rounded-xl bg-grape-600 text-white transition-colors hover:bg-grape-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-grape-200 active:scale-95"
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

      <div className="space-y-1">
        <label className="block text-sm font-medium text-ink" htmlFor="portal-note">
          備考・ご連絡事項（任意）
        </label>
        <input
          id="portal-note"
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="特記事項があればご記入ください"
          className="h-10 w-full rounded-lg border border-line-strong bg-bg-card px-3 text-sm text-ink focus:border-grape-500 focus:outline-none focus:ring-2 focus:ring-grape-200"
        />
      </div>

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
