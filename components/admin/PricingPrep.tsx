'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Wand2, AlertTriangle } from 'lucide-react'
import toast from 'react-hot-toast'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/Button'
import { ColorDot } from '@/components/ui/ColorDot'
import type { PendingPriceGroup } from '@/lib/pricing/pending'

/**
 * 請求準備：価格確定（管理者）。後決め単価をここで確定する。
 * 一括＝「価格表から解決」、個別＝行ごとに請求数量(赤点で減らす)・単価を入力して確定。
 * 確定（confirmed）でないと請求に入らない。
 */
export function PricingPrep({ groups }: { groups: PendingPriceGroup[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  // 行ごとの編集状態（billable_qty / unit_price / tax）
  const [edits, setEdits] = useState<Record<string, { billable: string; price: string; tax: '8' | '10' }>>(() => {
    const init: Record<string, { billable: string; price: string; tax: '8' | '10' }> = {}
    for (const g of groups) {
      for (const it of g.items) {
        init[it.id] = {
          billable: String(it.billableQty),
          price: it.unitPrice ? String(it.unitPrice) : '',
          tax: it.taxRate === 10 ? '10' : '8',
        }
      }
    }
    return init
  })

  const setEdit = (id: string, patch: Partial<{ billable: string; price: string; tax: '8' | '10' }>) =>
    setEdits((p) => ({ ...p, [id]: { ...p[id]!, ...patch } }))

  /** 一括：グループの明細を価格表から解決して確定。 */
  async function bulkResolve(group: PendingPriceGroup) {
    setBusy(group.orderId)
    try {
      const res = await fetch('/api/pricing/bulk', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ itemIds: group.items.map((i) => i.id), mode: 'resolve', status: 'confirmed' }),
      })
      const json = (await res.json()) as { updated?: number; skipped?: string[]; error?: string }
      if (!res.ok) throw new Error(json.error ?? `失敗 (${res.status})`)
      const skipped = json.skipped?.length ?? 0
      if (skipped > 0) toast(`${json.updated}件確定・${skipped}件は価格表に該当なし（個別入力してください）`, { icon: '⚠️' })
      else toast.success(`${json.updated}件を価格表から確定しました`)
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '一括確定に失敗しました')
    } finally {
      setBusy(null)
    }
  }

  /** 個別：1明細の請求数量・単価を確定。 */
  async function confirmItem(itemId: string) {
    const e = edits[itemId]!
    const price = parseFloat(e.price)
    const billable = parseFloat(e.billable)
    if (!(price >= 0)) {
      toast.error('単価を入れてください')
      return
    }
    setBusy(itemId)
    try {
      const res = await fetch(`/api/order-items/${itemId}/pricing`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          unit_price: price,
          tax_rate: Number(e.tax),
          billable_qty: Number.isFinite(billable) ? billable : undefined,
          status: 'confirmed',
        }),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error ?? `失敗 (${res.status})`)
      }
      toast.success('確定しました')
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '確定に失敗しました')
    } finally {
      setBusy(null)
    }
  }

  const inputCls =
    'h-10 rounded border border-line-strong bg-bg-card px-2 text-sm text-ink focus:outline-none focus:border-trust-500 focus:ring-2 focus:ring-trust-100'

  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <div key={g.orderId} className="rounded-lg border border-line bg-bg-card">
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
            <div className="flex items-center gap-2">
              <ColorDot color={g.customerColor} name={g.customerName} size="md" />
              <div>
                <p className="font-medium text-ink">{g.customerName}</p>
                <p className="text-xs text-ink-faint">納品 {g.deliveryDate ?? '未定'}・{g.channel}</p>
              </div>
            </div>
            <Button size="sm" variant="secondary" onClick={() => bulkResolve(g)} isLoading={busy === g.orderId}>
              <Wand2 className="h-3.5 w-3.5" aria-hidden />
              価格表から一括確定
            </Button>
          </div>

          <ul className="divide-y divide-line">
            {g.items.map((it) => {
              const e = edits[it.id]!
              const reduced = it.shippedQty != null && Number(e.billable) < it.orderedQty
              return (
                <li key={it.id} className="space-y-2 px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-ink">{it.productName}</span>
                    <span className="flex items-center gap-2 text-xs text-ink-faint">
                      受注 <span className="num">{it.orderedQty}</span>
                      ／出荷 <span className="num">{it.shippedQty ?? '—'}</span>
                      {it.priceStatus === 'provisional' && <span className="rounded bg-warning-bg px-1.5 py-0.5 text-warning">暫定</span>}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="space-y-0.5 text-xs text-ink-soft">
                      請求数量{reduced && <span className="ml-1 text-alert">（赤点減）</span>}
                      <input
                        type="number" inputMode="decimal" min={0}
                        className={cn(inputCls, 'num w-24 block', reduced && 'border-alert/50 bg-alert-bg/30')}
                        value={e.billable}
                        onChange={(ev) => setEdit(it.id, { billable: ev.target.value })}
                      />
                    </label>
                    <label className="space-y-0.5 text-xs text-ink-soft">
                      単価
                      <input
                        type="number" inputMode="decimal" min={0}
                        className={cn(inputCls, 'num w-28 block')}
                        placeholder="後決め"
                        value={e.price}
                        onChange={(ev) => setEdit(it.id, { price: ev.target.value })}
                      />
                    </label>
                    <label className="space-y-0.5 text-xs text-ink-soft">
                      税率
                      <select className={cn(inputCls, 'block w-20')} value={e.tax} onChange={(ev) => setEdit(it.id, { tax: ev.target.value as '8' | '10' })}>
                        <option value="8">8%</option>
                        <option value="10">10%</option>
                      </select>
                    </label>
                    <Button size="sm" onClick={() => confirmItem(it.id)} isLoading={busy === it.id}>
                      <Check className="h-3.5 w-3.5" aria-hidden />
                      確定
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      ))}

      <p className="flex items-center gap-1.5 text-xs text-ink-faint">
        <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
        確定（confirmed）した明細だけが請求に含まれます。未確定は請求から除外され、ここに残ります。
      </p>
    </div>
  )
}
