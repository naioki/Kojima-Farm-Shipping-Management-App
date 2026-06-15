'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Trash2, Tag } from 'lucide-react'
import toast from 'react-hot-toast'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/Button'

interface Option { id: string; name: string }
export interface PriceRuleListRow {
  id: string
  product_id: string
  customer_id: string | null
  channel: string | null
  price_unit: 'base' | 'pack'
  unit_price: number
  tax_rate: number
  effective_from: string
  effective_to: string | null
}

const todayStr = () => new Date().toISOString().slice(0, 10)

/**
 * 価格表管理（管理者）。期間×取引先×チャネルの単価。最新の effective_from が優先される。
 * 過去の請求は order_items に凍結済みなので、ここを変えても遡及しない。
 */
export function PriceRuleManager({
  products,
  customers,
  rows,
}: {
  products: Option[]
  customers: Option[]
  rows: PriceRuleListRow[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    product_id: '',
    customer_id: '',
    channel: '',
    price_unit: 'base' as 'base' | 'pack',
    unit_price: '',
    tax_rate: '8' as '8' | '10',
    effective_from: todayStr(),
    effective_to: '',
  })

  const productName = new Map(products.map((p) => [p.id, p.name]))
  const customerName = new Map(customers.map((c) => [c.id, c.name]))

  async function add() {
    const price = parseFloat(form.unit_price)
    if (!form.product_id || !(price >= 0) || !form.effective_from) {
      toast.error('商品・単価・適用開始日は必須です')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/price-rules', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          product_id: form.product_id,
          customer_id: form.customer_id || undefined,
          channel: form.channel || undefined,
          price_unit: form.price_unit,
          unit_price: price,
          tax_rate: Number(form.tax_rate),
          effective_from: form.effective_from,
          effective_to: form.effective_to || undefined,
        }),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error ?? `登録失敗 (${res.status})`)
      }
      toast.success('価格を登録しました')
      setForm((f) => ({ ...f, unit_price: '', effective_to: '' }))
      setOpen(false)
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '登録に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: string) {
    if (!confirm('この価格ルールを削除しますか？（過去の請求には影響しません）')) return
    const res = await fetch(`/api/price-rules/${id}`, { method: 'DELETE' })
    if (res.ok) {
      toast.success('削除しました')
      router.refresh()
    } else {
      toast.error('削除に失敗しました')
    }
  }

  const inputCls =
    'h-10 w-full rounded border border-line-strong bg-bg-card px-3 text-sm text-ink focus:outline-none focus:border-trust-500 focus:ring-2 focus:ring-trust-100'

  return (
    <div className="space-y-3">
      {rows.length === 0 ? (
        <p className="text-sm text-ink-soft">価格ルールはまだありません。</p>
      ) : (
        <ul className="divide-y divide-line rounded border border-line">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-sm font-medium text-ink">
                  <Tag className="h-3.5 w-3.5 text-earth-500" aria-hidden />
                  {productName.get(r.product_id) ?? '?'}
                  <span className="num font-bold text-earth-700">¥{r.unit_price.toLocaleString()}</span>
                  <span className="text-xs text-ink-faint">/{r.price_unit === 'base' ? '基準単位' : '販売単位'}・{r.tax_rate}%</span>
                </p>
                <p className="num text-xs text-ink-faint">
                  {r.customer_id ? (customerName.get(r.customer_id) ?? '取引先') : '定価（共通）'}
                  {r.channel && ` ・${r.channel}`}
                  {' ・'}
                  {r.effective_from}〜{r.effective_to ?? ''}
                </p>
              </div>
              <button type="button" onClick={() => remove(r.id)} aria-label="削除" className="p-1 text-ink-faint hover:text-alert">
                <Trash2 className="h-4 w-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}

      {open ? (
        <div className="space-y-2 rounded-lg border border-line bg-bg-soft p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <select value={form.product_id} onChange={(e) => setForm((f) => ({ ...f, product_id: e.target.value }))} className={inputCls} aria-label="商品">
              <option value="">商品を選択 *</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <select value={form.customer_id} onChange={(e) => setForm((f) => ({ ...f, customer_id: e.target.value }))} className={inputCls} aria-label="取引先">
              <option value="">定価（取引先共通）</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <input type="number" inputMode="decimal" min={0} className={cn(inputCls, 'num')} placeholder="単価 *" value={form.unit_price} onChange={(e) => setForm((f) => ({ ...f, unit_price: e.target.value }))} />
            <select value={form.price_unit} onChange={(e) => setForm((f) => ({ ...f, price_unit: e.target.value as 'base' | 'pack' }))} className={inputCls} aria-label="価格単位">
              <option value="base">基準単位あたり</option>
              <option value="pack">販売単位あたり</option>
            </select>
            <select value={form.tax_rate} onChange={(e) => setForm((f) => ({ ...f, tax_rate: e.target.value as '8' | '10' }))} className={inputCls} aria-label="税率">
              <option value="8">税率 8%（農産物）</option>
              <option value="10">税率 10%（資材等）</option>
            </select>
            <select value={form.channel} onChange={(e) => setForm((f) => ({ ...f, channel: e.target.value }))} className={inputCls} aria-label="チャネル">
              <option value="">全チャネル</option>
              <option value="fax">FAX</option>
              <option value="email">メール</option>
              <option value="portal">ポータル</option>
              <option value="manual">手動</option>
            </select>
            <label className="space-y-1 text-xs text-ink-soft">
              適用開始日 *
              <input type="date" className={inputCls} value={form.effective_from} onChange={(e) => setForm((f) => ({ ...f, effective_from: e.target.value }))} />
            </label>
            <label className="space-y-1 text-xs text-ink-soft">
              終了日（任意・廃止用）
              <input type="date" className={inputCls} value={form.effective_to} onChange={(e) => setForm((f) => ({ ...f, effective_to: e.target.value }))} />
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className="px-2 text-sm text-ink-faint hover:text-ink-soft">キャンセル</button>
            <Button size="sm" onClick={add} isLoading={saving}>登録</Button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-line py-2 text-sm text-ink-soft hover:border-earth-400 hover:text-ink">
          <Plus className="h-4 w-4" aria-hidden />
          価格を追加
        </button>
      )}
    </div>
  )
}
