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
  is_default_set: boolean
  default_quantity: number | null
  fraction_policy: FractionPolicy
  /** ラベル/シール指定（例: "Oisixラベル"/"農園独自"）。DBにはあったがこれまで未編集だった項目。 */
  label_spec: string | null
  /** テープ色（例: "透明"/"黄"/"赤"） */
  tape_color: string | null
  /** 固定の梱包指示（毎回同じ注意事項。その場限りの追記事項＝order_items.line_noteとは別） */
  packing_notes: string | null
}

export interface CustomerRulesEditorProps {
  customerId: string
  products: { id: string; name: string; unit: string }[]
  initialRules: Record<string, RuleRow>
  /** false なら閲覧のみ（規格ロック中・非マスター）。既定 true。 */
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
 * 取引先×商品の取引ルール編集（Laravel版 画面5）。
 * 品目ごとに P/C（スマートパースの基準）・コンテナ・いつものセット・既定数量・端数ポリシーを
 * 編集して行単位で保存（upsert）。P/C はケース記法 "15c2" 換算の要となる数値。
 */
export function CustomerRulesEditor({ customerId, products, initialRules, canEdit = true }: CustomerRulesEditorProps) {
  const [rows, setRows] = useState<Record<string, RuleRow>>(() => {
    const r: Record<string, RuleRow> = {}
    for (const p of products) r[p.id] = initialRules[p.id] ?? { ...EMPTY }
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
      toast.success('保存しました')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存に失敗しました')
    } finally {
      setSavingId(null)
    }
  }

  const cellInput =
    'h-10 w-full rounded border border-line-strong bg-bg-card px-2.5 text-sm text-ink focus:outline-none focus:border-trust-500 focus:ring-2 focus:ring-trust-100'

  return (
    <fieldset disabled={!canEdit} className="overflow-x-auto disabled:opacity-60">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="text-left text-ink-soft">
            <th className="px-2 py-2 font-medium">品目</th>
            <th className="px-2 py-2 font-medium">P/C（1ケース入数）</th>
            <th className="px-2 py-2 font-medium">荷姿</th>
            <th className="px-2 py-2 font-medium">規格</th>
            <th className="px-2 py-2 font-medium">カード</th>
            <th className="px-2 py-2 font-medium">ラベル/シール</th>
            <th className="px-2 py-2 font-medium">テープ色</th>
            <th className="px-2 py-2 font-medium">固定の梱包指示</th>
            <th className="px-2 py-2 font-medium">いつものセット</th>
            <th className="px-2 py-2 font-medium">既定数量</th>
            <th className="px-2 py-2 font-medium">端数</th>
            <th className="px-2 py-2 font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {products.map((p) => {
            const row = rows[p.id]!
            return (
              <tr key={p.id} className="border-t border-line align-middle">
                <td className="px-2 py-2 font-medium text-ink">
                  {p.name}
                  <span className="ml-1 text-xs text-ink-faint">/{p.unit}</span>
                </td>
                <td className="px-2 py-2">
                  <input
                    type="number"
                    min={0}
                    inputMode="numeric"
                    value={row.packs_per_case ?? ''}
                    onChange={(e) => patch(p.id, { packs_per_case: numOrNull(e.target.value) })}
                    className={cn(cellInput, 'num w-24 tabular-nums')}
                    placeholder="未設定"
                  />
                </td>
                <td className="px-2 py-2">
                  <input
                    type="text"
                    value={row.container_type ?? ''}
                    onChange={(e) => patch(p.id, { container_type: e.target.value })}
                    className={cn(cellInput, 'w-28')}
                    placeholder="ケース/箱/化粧箱"
                  />
                </td>
                <td className="px-2 py-2">
                  <input
                    type="text"
                    value={row.spec ?? ''}
                    onChange={(e) => patch(p.id, { spec: e.target.value })}
                    className={cn(cellInput, 'w-24')}
                    placeholder="L/200g 等"
                  />
                </td>
                <td className="px-2 py-2 text-center">
                  <input
                    type="checkbox"
                    checked={row.has_card}
                    onChange={(e) => patch(p.id, { has_card: e.target.checked })}
                    aria-label={`${p.name} のカード同梱`}
                    className="h-5 w-5 accent-earth-600"
                  />
                </td>
                <td className="px-2 py-2">
                  <input
                    type="text"
                    value={row.label_spec ?? ''}
                    onChange={(e) => patch(p.id, { label_spec: e.target.value })}
                    className={cn(cellInput, 'w-32')}
                    placeholder="Oisixラベル 等"
                  />
                </td>
                <td className="px-2 py-2">
                  <input
                    type="text"
                    value={row.tape_color ?? ''}
                    onChange={(e) => patch(p.id, { tape_color: e.target.value })}
                    className={cn(cellInput, 'w-20')}
                    placeholder="透明/黄/赤"
                  />
                </td>
                <td className="px-2 py-2">
                  <input
                    type="text"
                    value={row.packing_notes ?? ''}
                    onChange={(e) => patch(p.id, { packing_notes: e.target.value })}
                    className={cn(cellInput, 'w-40')}
                    placeholder="毎回同じ注意事項"
                  />
                </td>
                <td className="px-2 py-2 text-center">
                  <input
                    type="checkbox"
                    checked={row.is_default_set}
                    onChange={(e) => patch(p.id, { is_default_set: e.target.checked })}
                    aria-label={`${p.name} をいつものセットに含める`}
                    className="h-5 w-5 accent-earth-600"
                  />
                </td>
                <td className="px-2 py-2">
                  <input
                    type="number"
                    min={0}
                    inputMode="numeric"
                    value={row.default_quantity ?? ''}
                    onChange={(e) => patch(p.id, { default_quantity: numOrNull(e.target.value) })}
                    className={cn(cellInput, 'num w-24 tabular-nums')}
                    placeholder="—"
                  />
                </td>
                <td className="px-2 py-2">
                  <select
                    value={row.fraction_policy}
                    onChange={(e) => patch(p.id, { fraction_policy: e.target.value as FractionPolicy })}
                    className={cn(cellInput, 'w-24')}
                  >
                    {FRACTION_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-2 py-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => save(p.id)}
                    isLoading={savingId === p.id}
                  >
                    {savedId === p.id ? <Check className="h-4 w-4 text-harvest-600" aria-hidden /> : null}
                    保存
                  </Button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </fieldset>
  )
}
