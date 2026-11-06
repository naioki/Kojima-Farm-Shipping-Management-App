'use client'

import { useState } from 'react'
import { Check } from 'lucide-react'
import toast from 'react-hot-toast'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/Button'
import type { FractionPolicy } from '@/types/database'

export interface RuleRow {
  packs_per_case: number | null
  container_type: string | null
  spec: string | null
  has_card: boolean
  has_seal?: boolean | null
  seal_text?: string | null
  bag_type?: string | null
  is_default_set: boolean
  default_quantity: number | null
  fraction_policy: FractionPolicy
  label_spec: string | null
  tape_color: string | null
  packing_notes: string | null
}

export interface CustomerRulesEditorProps {
  customerId: string
  products: { id: string; name: string; unit: string }[]
  initialRules: Record<string, RuleRow>
  canEdit?: boolean
}

const FRACTION_OPTIONS: { value: FractionPolicy; label: string }[] = [
  { value: 'confirm', label: '確認' },
  { value: 'carry_over', label: '繰越' },
  { value: 'loose', label: 'バラ' },
  { value: 'round_down', label: '切捨' },
]

const EMPTY: RuleRow = {
  packs_per_case: null,
  container_type: null,
  spec: null,
  has_card: false,
  has_seal: null,
  seal_text: null,
  bag_type: null,
  is_default_set: false,
  default_quantity: null,
  fraction_policy: 'confirm',
  label_spec: null,
  tape_color: null,
  packing_notes: null,
}

const numOrNull = (s: string): number | null => {
  const t = s.trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

/**
 * 取引先×商品の取引ルール編集（#47 シール有無・シール表記・袋種別の設定に対応）。
 */
export function CustomerRulesEditor({ customerId, products, initialRules, canEdit = true }: CustomerRulesEditorProps) {
  const [rows, setRows] = useState<Record<string, RuleRow>>(() => {
    const r: Record<string, RuleRow> = {}
    for (const p of products) r[p.id] = initialRules[p.id] ? { ...EMPTY, ...initialRules[p.id] } : { ...EMPTY }
    return r
  })
  const [savingId, setSavingId] = useState<string | null>(null)
  const [savedId, setSavedId] = useState<string | null>(null)

  function patch(productId: string, fields: Partial<RuleRow>) {
    setRows((prev) => ({ ...prev, [productId]: { ...prev[productId]!, ...fields } }))
    setSavedId(null)
  }

  async function save(productId: string) {
    const row = rows[productId]!
    setSavingId(productId)
    try {
      const res = await fetch('/api/customer-product-rules', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          customer_id: customerId,
          product_id: productId,
          packs_per_case: row.packs_per_case,
          container_type: row.container_type || null,
          spec: row.spec || null,
          has_card: row.has_card,
          has_seal: row.has_seal ?? null,
          seal_text: row.seal_text || null,
          bag_type: row.bag_type || null,
          is_default_set: row.is_default_set,
          default_quantity: row.default_quantity,
          fraction_policy: row.fraction_policy,
          label_spec: row.label_spec || null,
          tape_color: row.tape_color || null,
          packing_notes: row.packing_notes || null,
        }),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error ?? `保存に失敗 (${res.status})`)
      }
      setSavedId(productId)
      toast.success('取引ルールを保存しました')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存に失敗しました')
    } finally {
      setSavingId(null)
    }
  }

  const fieldInput =
    'h-10 w-full min-w-0 rounded border border-line-strong bg-bg-card px-2.5 text-sm text-ink focus:outline-none focus:border-trust-500 focus:ring-2 focus:ring-trust-100'
  const labelCls = 'block text-xs font-medium text-ink-soft mb-1'

  return (
    <fieldset disabled={!canEdit} className="min-w-0 space-y-3 disabled:opacity-60">
      {products.map((p) => {
        const row = rows[p.id]!
        return (
          <div key={p.id} className="min-w-0 rounded-xl border border-line bg-bg-card p-3 sm:p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="min-w-0 break-words text-base font-bold text-ink">
                {p.name}
                <span className="ml-1 text-xs font-normal text-ink-faint">/{p.unit}</span>
              </h3>
              <Button
                variant="secondary"
                size="sm"
                className="min-h-10 shrink-0 whitespace-nowrap"
                onClick={() => save(p.id)}
                isLoading={savingId === p.id}
              >
                {savedId === p.id ? <Check className="h-4 w-4 text-harvest-600" aria-hidden /> : null}
                保存
              </Button>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <label className="min-w-0">
                <span className={labelCls}>入数（1ケースの入り数）</span>
                <input
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={row.packs_per_case ?? ''}
                  onChange={(e) => patch(p.id, { packs_per_case: numOrNull(e.target.value) })}
                  className={cn(fieldInput, 'num tabular-nums font-bold')}
                  placeholder="例: 20"
                />
              </label>
              <label className="min-w-0">
                <span className={labelCls}>コンテナ・荷姿</span>
                <input
                  type="text"
                  value={row.container_type ?? ''}
                  onChange={(e) => patch(p.id, { container_type: e.target.value })}
                  className={fieldInput}
                  placeholder="例: 青コン"
                />
              </label>
              <label className="min-w-0">
                <span className={labelCls}>規格</span>
                <input
                  type="text"
                  value={row.spec ?? row.label_spec ?? ''}
                  onChange={(e) => patch(p.id, { spec: e.target.value, label_spec: e.target.value })}
                  className={fieldInput}
                  placeholder="例: 200gUP"
                />
              </label>

              {/* #47 シール有無・シール表記 */}
              <div className="min-w-0">
                <span className={labelCls}>シールの有無・表記</span>
                <div className="flex min-w-0 items-center gap-1.5">
                  <select
                    aria-label={`${p.name} のシール有無`}
                    value={row.has_seal === true ? 'true' : row.has_seal === false ? 'false' : ''}
                    onChange={(e) => {
                      const v = e.target.value
                      const nextHasSeal = v === 'true' ? true : v === 'false' ? false : null
                      patch(p.id, {
                        has_seal: nextHasSeal,
                        seal_text: nextHasSeal === true ? (row.seal_text || 'シールあり') : nextHasSeal === false ? 'シールなし' : null,
                      })
                    }}
                    className={cn(fieldInput, 'w-28 shrink-0 text-xs font-bold px-1.5')}
                  >
                    <option value="">自動判定</option>
                    <option value="true">あり</option>
                    <option value="false">なし</option>
                  </select>
                  <input
                    type="text"
                    aria-label={`${p.name} のシール表記`}
                    value={row.seal_text ?? ''}
                    onChange={(e) => patch(p.id, { seal_text: e.target.value })}
                    className={cn(fieldInput, 'flex-1 text-xs')}
                    placeholder="シール表記"
                  />
                </div>
              </div>
              <label className="min-w-0">
                <span className={labelCls}>袋の種類</span>
                <select
                  value={row.bag_type ?? ''}
                  onChange={(e) => patch(p.id, { bag_type: e.target.value || null })}
                  className={cn(fieldInput, 'text-xs font-bold')}
                >
                  <option value="">指定なし</option>
                  <option value="印字袋(FG)">印字袋(FG)</option>
                  <option value="無地袋">無地袋</option>
                </select>
              </label>
              <label className="min-w-0">
                <span className={labelCls}>テープの色</span>
                <input
                  type="text"
                  value={row.tape_color ?? ''}
                  onChange={(e) => patch(p.id, { tape_color: e.target.value })}
                  className={fieldInput}
                  placeholder="例: 紫"
                />
              </label>

              <label className="min-w-0 sm:col-span-2 lg:col-span-3">
                <span className={labelCls}>固定の梱包指示</span>
                <input
                  type="text"
                  value={row.packing_notes ?? ''}
                  onChange={(e) => patch(p.id, { packing_notes: e.target.value })}
                  className={fieldInput}
                  placeholder="毎回同じ注意事項があれば入力"
                />
              </label>

              <label className="min-w-0">
                <span className={labelCls}>いつもの数量</span>
                <input
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={row.default_quantity ?? ''}
                  onChange={(e) => patch(p.id, { default_quantity: numOrNull(e.target.value) })}
                  className={cn(fieldInput, 'num tabular-nums')}
                  placeholder="例: 10"
                />
              </label>
              <label className="min-w-0">
                <span className={labelCls}>端数の扱い</span>
                <select
                  value={row.fraction_policy}
                  onChange={(e) => patch(p.id, { fraction_policy: e.target.value as FractionPolicy })}
                  className={cn(fieldInput, 'text-xs')}
                >
                  {FRACTION_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>

              <div className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-1 sm:col-span-2 lg:col-span-3">
                <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={row.has_card}
                    onChange={(e) => patch(p.id, { has_card: e.target.checked })}
                    className="h-5 w-5 accent-earth-600"
                  />
                  カードを同梱する
                </label>
                <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={row.is_default_set}
                    onChange={(e) => patch(p.id, { is_default_set: e.target.checked })}
                    className="h-5 w-5 accent-earth-600"
                  />
                  いつものセットに含める
                </label>
              </div>
            </div>
          </div>
        )
      })}
    </fieldset>
  )
}
