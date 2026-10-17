'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Trash2, Combine } from 'lucide-react'
import toast from 'react-hot-toast'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/Button'
import { ConfirmModal, Modal } from '@/components/ui/Modal'
import type { TaxRate } from '@/types/database'

export interface ProductRow {
  id: string
  name: string
  name_kana: string | null
  base_unit: string
  category: string | null
  default_tax_rate: TaxRate
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
 * 商品（品目）マスタの編集テーブル（新モデル）。
 * 品目＝WHAT（基準単位）。荷姿・価格は「価格・荷姿」マスタへ分離した。
 * 「統合」＝重複品目（例トマト箱）を別品目の荷姿に寄せて重複を解消する。
 * 削除は未使用のみ。使用中は履歴保護のため「有効」オフに誘導。
 */
export function ProductsTable({ products, categories = [] }: { products: ProductRow[]; categories?: string[] }) {
  const router = useRouter()
  const [rows, setRows] = useState<Record<string, ProductRow>>(() =>
    Object.fromEntries(products.map((p) => [p.id, { ...p }])),
  )
  const [ids, setIds] = useState<string[]>(() => products.map((p) => p.id))
  const [savingId, setSavingId] = useState<string | null>(null)
  const [savedId, setSavedId] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  // 統合モーダル
  const [mergeId, setMergeId] = useState<string | null>(null)
  const [mergeTarget, setMergeTarget] = useState('')
  const [mergeSellingLabel, setMergeSellingLabel] = useState('')
  const [mergeBasePer, setMergeBasePer] = useState('')
  const [merging, setMerging] = useState(false)

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
          base_unit: r.base_unit || '個',
          category: r.category?.trim() || null,
          default_tax_rate: r.default_tax_rate,
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

  function openMerge(id: string) {
    setMergeId(id)
    setMergeTarget('')
    setMergeSellingLabel(rows[id]?.base_unit ?? '')
    setMergeBasePer('')
  }

  async function doMerge() {
    if (!mergeId) return
    const base = parseFloat(mergeBasePer)
    if (!mergeTarget || !mergeSellingLabel || !(base > 0)) {
      toast.error('統合先・販売単位・換算数（正の数）は必須です')
      return
    }
    setMerging(true)
    try {
      const res = await fetch(`/api/products/${mergeId}/merge`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          target_product_id: mergeTarget,
          selling_unit_label: mergeSellingLabel,
          base_per_selling: base,
        }),
      })
      const json = (await res.json()) as { merged?: boolean; deleted?: boolean; targetName?: string; error?: string }
      if (!res.ok) throw new Error(json.error ?? `統合失敗 (${res.status})`)
      toast.success(`「${json.targetName}」の荷姿に統合しました${json.deleted ? '（重複品目は削除）' : '（重複品目は無効化）'}`)
      setMergeId(null)
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '統合に失敗しました')
    } finally {
      setMerging(false)
    }
  }

  const inp = 'h-9 rounded border border-line-strong bg-bg-card px-2 text-sm text-ink focus:outline-none focus:border-trust-500 focus:ring-2 focus:ring-trust-100'
  const confirmRow = confirmId ? rows[confirmId] : null
  const mergeRow = mergeId ? rows[mergeId] : null
  const targetOptions = ids.filter((x) => x !== mergeId).map((x) => rows[x]!)

  return (
    <div className="overflow-x-auto">
      <datalist id="products-table-category-list">
        {categories.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="text-left text-ink-soft">
            <th className="px-2 py-2 font-medium">品目名</th>
            <th className="px-2 py-2 font-medium">品目グループ</th>
            <th className="px-2 py-2 font-medium">基準単位</th>
            <th className="px-2 py-2 font-medium">税率</th>
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
                  <input
                    className={cn(inp, 'w-24')}
                    list="products-table-category-list"
                    placeholder="その他"
                    value={r.category ?? ''}
                    onChange={(e) => patch(id, { category: e.target.value })}
                    aria-label={`${r.name} の品目グループ`}
                  />
                </td>
                <td className="px-2 py-2">
                  <input className={cn(inp, 'w-16')} value={r.base_unit} onChange={(e) => patch(id, { base_unit: e.target.value })} />
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
                      onClick={() => openMerge(id)}
                      aria-label={`${r.name} を他品目の荷姿に統合`}
                      title="統合（重複品目を別品目の荷姿へ）"
                      className="flex h-9 w-9 items-center justify-center rounded border border-line text-ink-faint hover:border-trust-400 hover:bg-trust-50 hover:text-trust-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-trust-100"
                    >
                      <Combine className="h-4 w-4" aria-hidden />
                    </button>
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

      {/* 統合モーダル */}
      <Modal
        open={mergeId !== null}
        onClose={() => setMergeId(null)}
        title="品目を統合（荷姿に寄せる）"
        footer={
          <>
            <Button variant="secondary" onClick={() => setMergeId(null)} disabled={merging}>キャンセル</Button>
            <Button variant="primary" onClick={doMerge} isLoading={merging}>統合する</Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-ink-soft">
            「<span className="font-medium text-ink">{mergeRow?.name}（{mergeRow?.base_unit}）</span>」を
            別の品目の<strong className="text-ink">荷姿</strong>として登録し、この重複品目は無効化します。
            既存の注文履歴はそのまま残ります。
          </p>
          <label className="block space-y-1 text-sm">
            <span className="text-ink-soft">統合先の品目</span>
            <select className={cn(inp, 'w-full')} value={mergeTarget} onChange={(e) => setMergeTarget(e.target.value)}>
              <option value="">選択…</option>
              {targetOptions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block space-y-1 text-sm">
              <span className="text-ink-soft">販売単位名</span>
              <input className={cn(inp, 'w-full')} placeholder="箱 / ケース" value={mergeSellingLabel} onChange={(e) => setMergeSellingLabel(e.target.value)} />
            </label>
            <label className="block space-y-1 text-sm">
              <span className="text-ink-soft">1単位＝基準単位いくつ</span>
              <input type="number" inputMode="decimal" min={0} className={cn(inp, 'num w-full')} placeholder="例: 20" value={mergeBasePer} onChange={(e) => setMergeBasePer(e.target.value)} />
            </label>
          </div>
          <p className="text-xs text-ink-faint">
            例：トマトの「箱」を統合先＝トマト、販売単位＝箱、1箱＝20個 とすると、トマトに「箱」荷姿が追加されます。
          </p>
        </div>
      </Modal>
    </div>
  )
}
