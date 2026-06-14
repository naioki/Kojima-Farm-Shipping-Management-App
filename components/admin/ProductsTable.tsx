'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/Button'
import { ConfirmModal } from '@/components/ui/Modal'
import type { TaxRate } from '@/types/database'

export interface ProductRow {
  id: string
  name: string
  name_kana: string | null
  unit: string
  default_tax_rate: TaxRate
  container_capacity: number | null
  default_unit_price: number | null
  stock_qty: number
  is_active: boolean
}

const numOrNull = (s: string): number | null => {
  const t = s.trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

/**
 * 商品マスタの編集テーブル（編集＋在庫＋削除）。
 * 各行で品目名・単位・税率・コンテナ容量・既定単価・在庫数・有効を編集して保存（PATCH）。
 * 削除（DELETE）は未使用の品目のみ。使用中（注文・取引ルール・収穫見込み）は履歴保護のため
 * 不可で、「有効」オフ（非表示化）に誘導する。
 */
export function ProductsTable({ products }: { products: ProductRow[] }) {
  const router = useRouter()
  const [rows, setRows] = useState<Record<string, ProductRow>>(() =>
    Object.fromEntries(products.map((p) => [p.id, { ...p }])),
  )
  const [ids, setIds] = useState<string[]>(() => products.map((p) => p.id))
  const [savingId, setSavingId] = useState<string | null>(null)
  const [savedId, setSavedId] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  function patch(id: string, fields: Partial<ProductRow>) {
    setRows((prev) => ({ ...prev, [id]: { ...prev[id]!, ...fields } }))
    setSavedId(null)
  }

  async function save(id: string) {
    const r = rows[id]!
    if (r.name.trim() === '') {
      toast.error('品目名は必須です')
      return
    }
    setSavingId(id)
    try {
      const res = await fetch(`/api/products/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: r.name,
          name_kana: r.name_kana || null,
          unit: r.unit || '個',
          default_tax_rate: r.default_tax_rate,
          container_capacity: r.container_capacity,
          default_unit_price: r.default_unit_price,
          stock_qty: r.stock_qty,
          is_active: r.is_active,
        }),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error ?? `保存に失敗 (${res.status})`)
      }
      setSavedId(id)
      toast.success('保存しました')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存に失敗しました')
    } finally {
      setSavingId(null)
    }
  }

  async function remove(id: string) {
    setDeleting(true)
    try {
      const res = await fetch(`/api/products/${id}`, { method: 'DELETE' })
      if (res.status === 409) {
        const j = (await res.json().catch(() => ({}))) as { message?: string }
        toast.error(j.message ?? '使用中のため削除できません。「有効」をオフにしてください。', { duration: 6000 })
        return
      }
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error ?? `削除に失敗 (${res.status})`)
      }
      setIds((prev) => prev.filter((x) => x !== id))
      toast.success('品目を削除しました')
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '削除に失敗しました')
    } finally {
      setDeleting(false)
      setConfirmId(null)
    }
  }

  const inp = 'h-9 rounded border border-line-strong bg-bg-card px-2 text-sm text-ink focus:outline-none focus:border-trust-500 focus:ring-2 focus:ring-trust-100'
  const confirmRow = confirmId ? rows[confirmId] : null

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="text-left text-ink-soft">
            <th className="px-2 py-2 font-medium">品目名</th>
            <th className="px-2 py-2 font-medium">単位</th>
            <th className="px-2 py-2 font-medium">税率</th>
            <th className="px-2 py-2 font-medium">容量</th>
            <th className="px-2 py-2 font-medium">既定単価</th>
            <th className="px-2 py-2 font-medium">在庫</th>
            <th className="px-2 py-2 font-medium">有効</th>
            <th className="px-2 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {ids.map((id) => {
            const r = rows[id]!
            return (
              <tr key={id} className="border-t border-line">
                <td className="px-2 py-2">
                  <input className={cn(inp, 'w-32')} value={r.name} onChange={(e) => patch(id, { name: e.target.value })} />
                </td>
                <td className="px-2 py-2">
                  <input className={cn(inp, 'w-14')} value={r.unit} onChange={(e) => patch(id, { unit: e.target.value })} />
                </td>
                <td className="px-2 py-2">
                  <select
                    className={cn(inp, 'w-16')}
                    value={String(r.default_tax_rate)}
                    onChange={(e) => patch(id, { default_tax_rate: Number(e.target.value) as TaxRate })}
                  >
                    <option value="8">8%</option>
                    <option value="10">10%</option>
                  </select>
                </td>
                <td className="px-2 py-2">
                  <input
                    className={cn(inp, 'num w-20 tabular-nums')}
                    inputMode="numeric"
                    value={r.container_capacity ?? ''}
                    onChange={(e) => patch(id, { container_capacity: numOrNull(e.target.value) })}
                  />
                </td>
                <td className="px-2 py-2">
                  <input
                    className={cn(inp, 'num w-24 tabular-nums')}
                    inputMode="numeric"
                    value={r.default_unit_price ?? ''}
                    onChange={(e) => patch(id, { default_unit_price: numOrNull(e.target.value) })}
                  />
                </td>
                <td className="px-2 py-2">
                  <input
                    className={cn(inp, 'num w-20 tabular-nums')}
                    inputMode="numeric"
                    value={r.stock_qty}
                    onChange={(e) => patch(id, { stock_qty: numOrNull(e.target.value) ?? 0 })}
                  />
                </td>
                <td className="px-2 py-2 text-center">
                  <input
                    type="checkbox"
                    className="h-5 w-5 accent-earth-600"
                    checked={r.is_active}
                    onChange={(e) => patch(id, { is_active: e.target.checked })}
                    aria-label={`${r.name} を有効にする`}
                  />
                </td>
                <td className="px-2 py-2">
                  <div className="flex items-center gap-1.5">
                    <Button variant="secondary" size="sm" onClick={() => save(id)} isLoading={savingId === id}>
                      {savedId === id ? <Check className="h-4 w-4 text-harvest-600" aria-hidden /> : null}
                      保存
                    </Button>
                    <button
                      type="button"
                      onClick={() => setConfirmId(id)}
                      aria-label={`${r.name} を削除`}
                      title="削除（未使用の品目のみ）"
                      className="flex h-9 w-9 items-center justify-center rounded border border-line text-ink-faint hover:border-alert hover:bg-alert/5 hover:text-alert focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-alert/20"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </button>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <ConfirmModal
        open={confirmId !== null}
        onClose={() => setConfirmId(null)}
        onConfirm={() => confirmId && remove(confirmId)}
        title="品目を削除しますか？"
        message={`「${confirmRow?.name ?? ''}」を削除します。注文・取引ルール・収穫見込みで使われている品目は削除できません（その場合は「有効」をオフにして非表示にしてください）。`}
        confirmLabel="削除する"
        isLoading={deleting}
      />
    </div>
  )
}
