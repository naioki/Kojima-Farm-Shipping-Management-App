'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Trash2, Combine, RotateCcw, Save } from 'lucide-react'
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
 * 商品（品目）マスタの編集テーブル。
 * - 品目追加後の props 更新にも自動同期。
 * - スマホ・PCどちらでも「保存」「削除」ボタンが画面外に隠れないレスポンシブ設計。
 * - 削除ボタンは未使用なら物理削除、過去注文履歴があれば自動で非表示（アーカイブ）化し、エラーで止まらない。
 */
export function ProductsTable({ products, categories = [] }: { products: ProductRow[]; categories?: string[] }) {
  const router = useRouter()
  const [rows, setRows] = useState<Record<string, ProductRow>>(() =>
    Object.fromEntries(products.map((p) => [p.id, { ...p }])),
  )
  const [ids, setIds] = useState<string[]>(() => products.map((p) => p.id))
  const [dirtyIds, setDirtyIds] = useState<Set<string>>(new Set())
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

  // 親からの products 更新（新規品目追加など）を同期
  useEffect(() => {
    setRows(Object.fromEntries(products.map((p) => [p.id, { ...p }])))
    setIds(products.map((p) => p.id))
  }, [products])

  function patch(id: string, fields: Partial<ProductRow>) {
    setRows((prev) => ({ ...prev, [id]: { ...prev[id]!, ...fields } }))
    setDirtyIds((prev) => {
      const next = new Set(prev)
      next.add(id)
      return next
    })
    setSavedId(null)
  }

  async function save(id: string, overrideRow?: ProductRow) {
    const r = overrideRow ?? rows[id]
    if (!r) return
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
          name: r.name.trim(),
          name_kana: r.name_kana || null,
          base_unit: r.base_unit.trim() || '個',
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
      setDirtyIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
      setSavedId(id)
      toast.success(`「${r.name}」を保存しました`)
      router.refresh()
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
      const j = (await res.json().catch(() => ({}))) as {
        deleted?: boolean
        mode?: 'physical' | 'archived'
        message?: string
        error?: string
      }
      if (!res.ok) {
        throw new Error(j.message ?? j.error ?? `削除に失敗 (${res.status})`)
      }
      if (j.mode === 'archived') {
        setRows((prev) => (prev[id] ? { ...prev, [id]: { ...prev[id]!, is_active: false } } : prev))
        toast.success(j.message ?? '品目一覧から削除（非表示化）しました')
      } else {
        setIds((prev) => prev.filter((x) => x !== id))
        toast.success('品目を完全に削除しました')
      }
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
      toast.success(`「${json.targetName}」の荷姿に統合しました${json.deleted ? '（重複品目は削除）' : '（重複品目は非表示化）'}`)
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

  const activeIds = ids.filter((id) => rows[id]?.is_active !== false)
  const inactiveIds = ids.filter((id) => rows[id]?.is_active === false)
  const targetOptions = activeIds.filter((x) => x !== mergeId).map((x) => rows[x]!)

  function renderProductRow(id: string) {
    const r = rows[id]
    if (!r) return null
    const isDirty = dirtyIds.has(id)

    return (
      <div
        key={id}
        className={cn(
          'flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2.5 transition-colors',
          isDirty ? 'border-emerald-500 bg-emerald-50/30' : 'border-line bg-white',
        )}
      >
        <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[240px]">
          <label className="flex flex-col gap-0.5">
            <span className="text-[11px] font-bold text-ink-soft">品目名</span>
            <input
              className={cn(inp, 'w-36 font-bold')}
              value={r.name}
              onChange={(e) => patch(id, { name: e.target.value })}
            />
          </label>

          <label className="flex flex-col gap-0.5">
            <span className="text-[11px] font-bold text-ink-soft">グループ</span>
            <input
              className={cn(inp, 'w-24')}
              list="products-table-category-list"
              placeholder="その他"
              value={r.category ?? ''}
              onChange={(e) => patch(id, { category: e.target.value })}
              aria-label={`${r.name} の品目グループ`}
            />
          </label>

          <label className="flex flex-col gap-0.5">
            <span className="text-[11px] font-bold text-ink-soft">単位</span>
            <input
              className={cn(inp, 'w-16 text-center')}
              value={r.base_unit}
              onChange={(e) => patch(id, { base_unit: e.target.value })}
            />
          </label>

          <label className="flex flex-col gap-0.5">
            <span className="text-[11px] font-bold text-ink-soft">税率</span>
            <select
              className={cn(inp, 'w-16')}
              value={String(r.default_tax_rate)}
              onChange={(e) => {
                const nextRate = Number(e.target.value) as TaxRate
                const nextRow = { ...r, default_tax_rate: nextRate }
                patch(id, { default_tax_rate: nextRate })
                void save(id, nextRow)
              }}
            >
              <option value="8">8%</option>
              <option value="10">10%</option>
            </select>
          </label>

          <label className="flex flex-col gap-0.5">
            <span className="text-[11px] font-bold text-ink-soft">在庫数</span>
            <input
              className={cn(inp, 'num w-20 tabular-nums text-right')}
              inputMode="numeric"
              value={r.stock_qty}
              onChange={(e) => patch(id, { stock_qty: numOrNull(e.target.value) ?? 0 })}
            />
          </label>
        </div>

        {/* 操作ボタン群（常に右側に明示表示・スマホでも折り返して確実に押せる） */}
        <div className="flex items-center gap-1.5 ml-auto pt-2 sm:pt-0">
          <Button
            variant={isDirty ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => save(id)}
            isLoading={savingId === id}
            className="gap-1 font-bold"
          >
            {savedId === id && !isDirty ? (
              <Check className="h-4 w-4 text-harvest-600" aria-hidden />
            ) : (
              <Save className="h-3.5 w-3.5" aria-hidden />
            )}
            <span>{isDirty ? '変更を保存' : '保存'}</span>
          </Button>

          <button
            type="button"
            onClick={() => openMerge(id)}
            aria-label={`${r.name} を他品目の荷姿に統合`}
            title="統合（重複品目を別品目の荷姿へ）"
            className="flex h-9 items-center gap-1 rounded border border-line bg-white px-2.5 text-xs font-medium text-ink-soft hover:border-trust-400 hover:bg-trust-50 hover:text-trust-600 focus-visible:outline-none"
          >
            <Combine className="h-3.5 w-3.5" aria-hidden />
            <span className="hidden sm:inline">統合</span>
          </button>

          <button
            type="button"
            onClick={() => setConfirmId(id)}
            aria-label={`${r.name} を削除`}
            title="この品目を削除"
            className="flex h-9 items-center gap-1 rounded border border-alert/30 bg-alert/5 px-2.5 text-xs font-bold text-alert hover:border-alert hover:bg-alert hover:text-white transition-colors focus-visible:outline-none"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
            <span>削除</span>
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <datalist id="products-table-category-list">
        {categories.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>

      <div className="space-y-2">
        {activeIds.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-soft">有効な品目がありません。</p>
        ) : (
          activeIds.map((id) => renderProductRow(id))
        )}
      </div>

      {inactiveIds.length > 0 && (
        <details className="rounded-lg border border-line bg-bg-soft/40 p-3">
          <summary className="cursor-pointer text-xs font-bold text-ink-soft select-none">
            削除（非表示）済みの品目を表示（{inactiveIds.length}件）
          </summary>
          <div className="mt-3 space-y-2">
            {inactiveIds.map((id) => {
              const r = rows[id]
              if (!r) return null
              return (
                <div
                  key={id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded border border-line bg-white/70 px-3 py-2 text-sm opacity-80"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-ink line-through">{r.name}</span>
                    <span className="text-xs text-ink-faint">（{r.base_unit} / {r.category || '未分類'}）</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      isLoading={savingId === id}
                      onClick={() => {
                        const nextRow = { ...r, is_active: true }
                        patch(id, { is_active: true })
                        void save(id, nextRow)
                      }}
                    >
                      <RotateCcw className="h-3.5 w-3.5 mr-1" />
                      一覧に戻す
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        </details>
      )}

      <ConfirmModal
        open={confirmId !== null}
        onClose={() => setConfirmId(null)}
        onConfirm={() => confirmId && remove(confirmId)}
        title="品目を削除しますか？"
        message={`「${confirmRow?.name ?? ''}」を品目一覧から削除します。（過去の注文履歴がある場合は、過去伝票の履歴のみ保護して一覧・選択肢から非表示にします）`}
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
            別の品目の<strong className="text-ink">荷姿</strong>として登録し、この重複品目は一覧から除外します。
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
