'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Trash2, Package } from 'lucide-react'
import toast from 'react-hot-toast'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/Button'

interface Option { id: string; name: string }
export interface PackConfigRow {
  id: string
  product_id: string
  customer_id: string | null
  label: string
  selling_unit_label: string
  base_per_selling: number
  needs_manual_confirm: boolean
}

/**
 * 荷姿マスタ管理（管理者）。1商品×取引先につき複数形態を登録できる。
 * base_per_selling（販売単位1あたりの基準単位数）が換算の真実。
 */
export function PackConfigManager({
  products,
  customers,
  rows,
}: {
  products: Option[]
  customers: Option[]
  rows: PackConfigRow[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    product_id: '',
    customer_id: '',
    label: '',
    selling_unit_label: '',
    base_per_selling: '',
    needs_manual_confirm: false,
  })

  const productName = new Map(products.map((p) => [p.id, p.name]))
  const customerName = new Map(customers.map((c) => [c.id, c.name]))

  async function add() {
    const base = parseFloat(form.base_per_selling)
    if (!form.product_id || !form.label || !form.selling_unit_label || !(base > 0)) {
      toast.error('商品・名称・販売単位・換算数（正の数）は必須です')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/pack-configs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          product_id: form.product_id,
          customer_id: form.customer_id || undefined,
          label: form.label,
          selling_unit_label: form.selling_unit_label,
          base_per_selling: base,
          needs_manual_confirm: form.needs_manual_confirm,
        }),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error ?? `登録失敗 (${res.status})`)
      }
      toast.success('荷姿を登録しました')
      setForm({ product_id: '', customer_id: '', label: '', selling_unit_label: '', base_per_selling: '', needs_manual_confirm: false })
      setOpen(false)
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '登録に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: string) {
    if (!confirm('この荷姿を無効化しますか？')) return
    const res = await fetch(`/api/pack-configs/${id}`, { method: 'DELETE' })
    if (res.ok) {
      toast.success('無効化しました')
      router.refresh()
    } else {
      toast.error('無効化に失敗しました')
    }
  }

  const inputCls =
    'h-10 w-full rounded border border-line-strong bg-bg-card px-3 text-sm text-ink focus:outline-none focus:border-trust-500 focus:ring-2 focus:ring-trust-100'

  return (
    <div className="space-y-3">
      {rows.length === 0 ? (
        <p className="text-sm text-ink-soft">荷姿はまだありません。</p>
      ) : (
        <ul className="divide-y divide-line rounded border border-line">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-sm font-medium text-ink">
                  <Package className="h-3.5 w-3.5 text-earth-500" aria-hidden />
                  {productName.get(r.product_id) ?? '?'}
                  <span className="text-ink-soft">— {r.label}</span>
                </p>
                <p className="num text-xs text-ink-faint">
                  1{r.selling_unit_label} = {r.base_per_selling} 基準単位
                  {r.customer_id && ` ・ ${customerName.get(r.customer_id) ?? '取引先'}専用`}
                  {r.needs_manual_confirm && ' ・要人手確認'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => remove(r.id)}
                aria-label="無効化"
                className="p-1 text-ink-faint hover:text-alert"
              >
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
              <option value="">共通（取引先専用にしない）</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <input className={inputCls} placeholder="表示名 * 例: スタンドパック3個入り12袋" value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} />
            <input className={inputCls} placeholder="販売単位名 * 例: ケース" value={form.selling_unit_label} onChange={(e) => setForm((f) => ({ ...f, selling_unit_label: e.target.value }))} />
            <input type="number" inputMode="decimal" min={0} className={cn(inputCls, 'num')} placeholder="1販売単位=基準単位いくつ * 例: 36" value={form.base_per_selling} onChange={(e) => setForm((f) => ({ ...f, base_per_selling: e.target.value }))} />
            <label className="flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" checked={form.needs_manual_confirm} onChange={(e) => setForm((f) => ({ ...f, needs_manual_confirm: e.target.checked }))} className="h-4 w-4 accent-earth-600" />
              要人手確認（組合指定等）
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
          荷姿を追加
        </button>
      )}
    </div>
  )
}
