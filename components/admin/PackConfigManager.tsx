'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Trash2, Package, ChevronDown, Pencil } from 'lucide-react'
import toast from 'react-hot-toast'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/Button'
import {
  PackInstructionFields,
  EMPTY_INSTRUCTIONS,
  instructionsToPayload,
  boolToTri,
  type InstructionFormState,
} from '@/components/admin/PackInstructionFields'
import { PackPhotoUploader } from '@/components/admin/PackPhotoUploader'

interface Option { id: string; name: string; base_unit?: string }
export interface PackConfigRow {
  id: string
  product_id: string
  customer_id: string | null
  label: string
  selling_unit_label: string
  base_per_selling: number
  needs_manual_confirm: boolean
  // 作業指示（詳細）— 編集の初期値に使う
  spec_note: string | null
  has_card: boolean | null
  has_seal: boolean | null
  tape_color: string | null
  label_spec: string | null
  price_tag_required: boolean | null
  returnable_container: boolean | null
  quality_note: string | null
  standing_notes: string | null
  field_memo: string | null
}

function rowToInstructions(r: PackConfigRow): InstructionFormState {
  return {
    spec_note: r.spec_note ?? '',
    label_spec: r.label_spec ?? '',
    tape_color: r.tape_color ?? '',
    has_card: boolToTri(r.has_card),
    has_seal: boolToTri(r.has_seal),
    price_tag_required: boolToTri(r.price_tag_required),
    returnable_container: boolToTri(r.returnable_container),
    quality_note: r.quality_note ?? '',
    standing_notes: r.standing_notes ?? '',
    field_memo: r.field_memo ?? '',
  }
}

/**
 * 荷姿の管理（管理者）。1品目×取引先につき複数形態を登録できる。
 * base_per_selling（販売単位1あたりの基準単位数）が換算の真実。
 * 各荷姿に「作業指示（詳細）」（規格・カード/シール・テープ色・ラベル種別・写真等）を持てる。
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
  const [showDetail, setShowDetail] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [form, setForm] = useState({
    product_id: '',
    customer_id: '',
    label: '',
    selling_unit_label: '',
    base_per_selling: '',
    needs_manual_confirm: false,
  })
  const [instr, setInstr] = useState<InstructionFormState>(EMPTY_INSTRUCTIONS)

  const productName = new Map(products.map((p) => [p.id, p.name]))
  const customerName = new Map(customers.map((c) => [c.id, c.name]))
  const baseUnitOf = new Map(products.map((p) => [p.id, p.base_unit || '基準単位']))

  async function add() {
    const base = parseFloat(form.base_per_selling)
    if (!form.product_id || !form.label || !form.selling_unit_label || !(base > 0)) {
      toast.error('品目・表示名・販売単位・入数（正の数）は必須です')
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
          ...instructionsToPayload(instr),
        }),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error ?? `登録失敗 (${res.status})`)
      }
      toast.success('荷姿を登録しました')
      setForm({ product_id: '', customer_id: '', label: '', selling_unit_label: '', base_per_selling: '', needs_manual_confirm: false })
      setInstr(EMPTY_INSTRUCTIONS)
      setShowDetail(false)
      setOpen(false)
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '登録に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: string) {
    if (!confirm('この荷姿を「使わない（非表示）」にしますか？過去の注文・請求には影響しません。')) return
    const res = await fetch(`/api/pack-configs/${id}`, { method: 'DELETE' })
    if (res.ok) {
      toast.success('非表示にしました')
      router.refresh()
    } else {
      toast.error('非表示にできませんでした')
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
            <li key={r.id} className="px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <div className="min-w-0 flex-1 basis-60">
                  <p className="flex flex-wrap items-center gap-x-1.5 text-sm font-medium text-ink">
                    <Package className="h-3.5 w-3.5 shrink-0 text-earth-500" aria-hidden />
                    {productName.get(r.product_id) ?? '?'}
                    <span className="break-words text-ink-soft">— {r.label}</span>
                  </p>
                  <p className="num text-xs text-ink-faint">
                    1{r.selling_unit_label} = {r.base_per_selling}{baseUnitOf.get(r.product_id) ?? '基準単位'}
                    {r.customer_id && ` ・ ${customerName.get(r.customer_id) ?? '取引先'}専用`}
                    {r.needs_manual_confirm && ' ・要人手確認'}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      setEditing((cur) => (cur === r.id ? null : r.id))
                      setInstr(rowToInstructions(r))
                    }}
                    aria-label="作業指示を編集"
                    aria-expanded={editing === r.id}
                    title="作業指示（規格・シール・テープ色など）を編集します。入数や名前は変えられません"
                    className="inline-flex h-10 items-center gap-1 whitespace-nowrap rounded px-2 text-sm text-ink-soft hover:text-trust-700"
                  >
                    <Pencil className="h-4 w-4" aria-hidden />
                    作業指示を編集
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(r.id)}
                    aria-label="この荷姿を使わない（非表示）"
                    title="削除ではなく、一覧と選択肢から非表示にします"
                    className="inline-flex h-10 items-center gap-1 whitespace-nowrap rounded px-2 text-sm text-ink-soft hover:text-alert"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                    使わない（非表示）
                  </button>
                </div>
              </div>

              {editing === r.id && (
                <div className="mt-3 space-y-3 rounded-lg border border-line bg-bg-soft p-3">
                  <PackInstructionFields idPrefix={`edit-${r.id}`} state={instr} onChange={setInstr} />
                  <PackPhotoUploader packConfigId={r.id} />
                  <div className="flex justify-end gap-2">
                    <button type="button" onClick={() => setEditing(null)} className="min-h-10 px-2 text-sm text-ink-soft hover:text-ink">
                      閉じる
                    </button>
                    <Button
                      size="sm"
                      isLoading={saving}
                      onClick={async () => {
                        setSaving(true)
                        try {
                          const res = await fetch(`/api/pack-configs/${r.id}`, {
                            method: 'PATCH',
                            headers: { 'content-type': 'application/json' },
                            body: JSON.stringify(instructionsToPayload(instr)),
                          })
                          if (!res.ok) {
                            const j = (await res.json().catch(() => ({}))) as { error?: string }
                            throw new Error(j.error ?? `保存失敗 (${res.status})`)
                          }
                          toast.success('作業指示を保存しました')
                          setEditing(null)
                          router.refresh()
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : '保存に失敗しました')
                        } finally {
                          setSaving(false)
                        }
                      }}
                    >
                      作業指示を保存
                    </Button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {open ? (
        <div className="space-y-2 rounded-lg border border-line bg-bg-soft p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1 text-xs font-medium text-ink-soft">
              品目 *
              <select value={form.product_id} onChange={(e) => setForm((f) => ({ ...f, product_id: e.target.value }))} className={inputCls}>
                <option value="">品目を選択</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label className="block space-y-1 text-xs font-medium text-ink-soft">
              取引先
              <select value={form.customer_id} onChange={(e) => setForm((f) => ({ ...f, customer_id: e.target.value }))} className={inputCls}>
                <option value="">共通（取引先専用にしない）</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <label className="block space-y-1 text-xs font-medium text-ink-soft">
              表示名 *
              <input className={inputCls} placeholder="例: スタンドパック3個入り12袋" value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} />
            </label>
            <label className="block space-y-1 text-xs font-medium text-ink-soft">
              販売単位の名前 *
              <input className={inputCls} placeholder="例: ケース" value={form.selling_unit_label} onChange={(e) => setForm((f) => ({ ...f, selling_unit_label: e.target.value }))} />
            </label>
            <label className="block space-y-1 text-xs font-medium text-ink-soft">
              入数（1販売単位に入る数） *
              <input type="number" inputMode="decimal" min={0} className={cn(inputCls, 'num')} placeholder="例: 36" value={form.base_per_selling} onChange={(e) => setForm((f) => ({ ...f, base_per_selling: e.target.value }))} />
            </label>
            <label className="flex min-h-10 items-center gap-2 self-end text-sm text-ink">
              <input type="checkbox" checked={form.needs_manual_confirm} onChange={(e) => setForm((f) => ({ ...f, needs_manual_confirm: e.target.checked }))} className="h-5 w-5 accent-earth-600" />
              人の確認が必要（組合指定など）
            </label>
          </div>

          {/* 作業指示（詳細）は折りたたみ。未入力でも画面を占拠しない。 */}
          <div className="rounded border border-line bg-bg-card/60">
            <button
              type="button"
              onClick={() => setShowDetail((v) => !v)}
              aria-expanded={showDetail}
              className="flex min-h-10 w-full items-center justify-between px-3 py-2 text-sm font-medium text-ink-soft hover:text-ink"
            >
              作業指示（詳細）
              <ChevronDown className={cn('h-4 w-4 transition-transform', showDetail && 'rotate-180')} aria-hidden />
            </button>
            {showDetail && (
              <div className="border-t border-line px-3 py-3">
                <PackInstructionFields idPrefix="new" state={instr} onChange={setInstr} />
                <p className="mt-2 text-xs text-ink-faint">写真は登録後、一覧の「作業指示を編集」から追加できます。</p>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => { setOpen(false); setShowDetail(false) }} className="min-h-10 px-2 text-sm text-ink-soft hover:text-ink">キャンセル</button>
            <Button size="sm" onClick={add} isLoading={saving}>登録</Button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className="flex min-h-10 w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-line py-2 text-sm text-ink-soft hover:border-earth-400 hover:text-ink">
          <Plus className="h-4 w-4" aria-hidden />
          荷姿を追加
        </button>
      )}
    </div>
  )
}
