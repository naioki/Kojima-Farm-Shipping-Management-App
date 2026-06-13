'use client'

import { useState } from 'react'
import { Check } from 'lucide-react'
import toast from 'react-hot-toast'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/Button'
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
 * 商品マスタの編集テーブル（編集＋在庫）。
 * 各行で品目名・単位・税率・コンテナ容量・既定単価・在庫数・有効を編集して保存（PATCH）。
 */
export function ProductsTable({ products }: { products: ProductRow[] }) {
  const [rows, setRows] = useState<Record<string, ProductRow>>(() =>
    Object.fromEntries(products.map((p) => [p.id, { ...p }])),
  )
  const [savingId, setSavingId] = useState<string | null>(null)
  const [savedId, setSavedId] = useState<string | null>(null)

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

  const inp = 'h-9 rounded border border-line-strong bg-bg-card px-2 text-sm text-ink focus:outline-none focus:border-trust-500 focus:ring-2 focus:ring-trust-100'

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
          {products.map((p) => {
            const r = rows[p.id]!
            return (
              <tr key={p.id} className="border-t border-line">
                <td className="px-2 py-2">
                  <input className={cn(inp, 'w-32')} value={r.name} onChange={(e) => patch(p.id, { name: e.target.value })} />
                </td>
                <td className="px-2 py-2">
                  <input className={cn(inp, 'w-14')} value={r.unit} onChange={(e) => patch(p.id, { unit: e.target.value })} />
                </td>
                <td className="px-2 py-2">
                  <select
                    className={cn(inp, 'w-16')}
                    value={String(r.default_tax_rate)}
                    onChange={(e) => patch(p.id, { default_tax_rate: Number(e.target.value) as TaxRate })}
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
                    onChange={(e) => patch(p.id, { container_capacity: numOrNull(e.target.value) })}
                  />
                </td>
                <td className="px-2 py-2">
                  <input
                    className={cn(inp, 'num w-24 tabular-nums')}
                    inputMode="numeric"
                    value={r.default_unit_price ?? ''}
                    onChange={(e) => patch(p.id, { default_unit_price: numOrNull(e.target.value) })}
                  />
                </td>
                <td className="px-2 py-2">
                  <input
                    className={cn(inp, 'num w-20 tabular-nums')}
                    inputMode="numeric"
                    value={r.stock_qty}
                    onChange={(e) => patch(p.id, { stock_qty: numOrNull(e.target.value) ?? 0 })}
                  />
                </td>
                <td className="px-2 py-2 text-center">
                  <input
                    type="checkbox"
                    className="h-5 w-5 accent-earth-600"
                    checked={r.is_active}
                    onChange={(e) => patch(p.id, { is_active: e.target.checked })}
                    aria-label={`${p.name} を有効にする`}
                  />
                </td>
                <td className="px-2 py-2">
                  <Button variant="secondary" size="sm" onClick={() => save(p.id)} isLoading={savingId === p.id}>
                    {savedId === p.id ? <Check className="h-4 w-4 text-harvest-600" aria-hidden /> : null}
                    保存
                  </Button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
