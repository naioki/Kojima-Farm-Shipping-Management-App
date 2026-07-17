'use client'

import { cn } from '@/lib/cn'

/** 作業指示（詳細）の編集状態。boolean は tri-state（''=未設定 / 'true' / 'false'）で持つ。 */
export interface InstructionFormState {
  spec_note: string
  label_spec: string
  tape_color: string
  has_card: '' | 'true' | 'false'
  has_seal: '' | 'true' | 'false'
  price_tag_required: '' | 'true' | 'false'
  returnable_container: '' | 'true' | 'false'
  quality_note: string
  standing_notes: string
  field_memo: string
}

export const EMPTY_INSTRUCTIONS: InstructionFormState = {
  spec_note: '',
  label_spec: '',
  tape_color: '',
  has_card: '',
  has_seal: '',
  price_tag_required: '',
  returnable_container: '',
  quality_note: '',
  standing_notes: '',
  field_memo: '',
}

/** tri-state 文字列 → boolean|null（未設定=null）。 */
function triToBool(v: '' | 'true' | 'false'): boolean | null {
  return v === '' ? null : v === 'true'
}

/** boolean|null → tri-state 文字列。 */
export function boolToTri(v: boolean | null | undefined): '' | 'true' | 'false' {
  return v == null ? '' : v ? 'true' : 'false'
}

/** 編集状態 → API ペイロード（空文字は null に正規化）。 */
export function instructionsToPayload(s: InstructionFormState) {
  const t = (v: string) => (v.trim() === '' ? null : v.trim())
  return {
    spec_note: t(s.spec_note),
    label_spec: t(s.label_spec),
    tape_color: t(s.tape_color),
    has_card: triToBool(s.has_card),
    has_seal: triToBool(s.has_seal),
    price_tag_required: triToBool(s.price_tag_required),
    returnable_container: triToBool(s.returnable_container),
    quality_note: t(s.quality_note),
    standing_notes: t(s.standing_notes),
    field_memo: t(s.field_memo),
  }
}

const inputCls =
  'h-10 w-full rounded border border-line-strong bg-bg-card px-3 text-sm text-ink focus:outline-none focus:border-trust-500 focus:ring-2 focus:ring-trust-100'
const areaCls = 'w-full rounded border border-line-strong bg-bg-card px-3 py-2 text-sm text-ink focus:outline-none focus:border-trust-500 focus:ring-2 focus:ring-trust-100'

function TriSelect({
  id,
  label,
  value,
  onChange,
}: {
  id: string
  label: string
  value: '' | 'true' | 'false'
  onChange: (v: '' | 'true' | 'false') => void
}) {
  return (
    <label htmlFor={id} className="space-y-1 block">
      <span className="text-xs font-medium text-ink-soft">{label}</span>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value as '' | 'true' | 'false')} className={inputCls}>
        <option value="">未設定</option>
        <option value="true">あり</option>
        <option value="false">なし</option>
      </select>
    </label>
  )
}

/**
 * 荷姿の作業指示（詳細）フォーム入力。値駆動表示（PackInstructions）と対になる編集UI。
 * すべて任意。未入力でも画面を占拠しないよう、呼び出し側で折りたたみに収める。
 */
export function PackInstructionFields({
  idPrefix,
  state,
  onChange,
}: {
  idPrefix: string
  state: InstructionFormState
  onChange: (next: InstructionFormState) => void
}) {
  const set = <K extends keyof InstructionFormState>(k: K, v: InstructionFormState[K]) =>
    onChange({ ...state, [k]: v })

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label htmlFor={`${idPrefix}-label_spec`} className="space-y-1 block">
          <span className="text-xs font-medium text-ink-soft">ラベル種別</span>
          <input id={`${idPrefix}-label_spec`} className={inputCls} value={state.label_spec} onChange={(e) => set('label_spec', e.target.value)} placeholder="Oisix/農園独自/組合指定 等" />
        </label>
        <label htmlFor={`${idPrefix}-tape_color`} className="space-y-1 block">
          <span className="text-xs font-medium text-ink-soft">テープ色</span>
          <input id={`${idPrefix}-tape_color`} className={inputCls} value={state.tape_color} onChange={(e) => set('tape_color', e.target.value)} placeholder="透明/黄/赤 等" />
        </label>
      </div>

      <label htmlFor={`${idPrefix}-spec_note`} className="space-y-1 block">
        <span className="text-xs font-medium text-ink-soft">規格（サイズ・等級等）</span>
        <input id={`${idPrefix}-spec_note`} className={inputCls} value={state.spec_note} onChange={(e) => set('spec_note', e.target.value)} placeholder="L/200g/秀 等" />
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <TriSelect id={`${idPrefix}-has_card`} label="カードの有無" value={state.has_card} onChange={(v) => set('has_card', v)} />
        <TriSelect id={`${idPrefix}-has_seal`} label="シールの有無" value={state.has_seal} onChange={(v) => set('has_seal', v)} />
        <TriSelect id={`${idPrefix}-price_tag_required`} label="値札・バーコード" value={state.price_tag_required} onChange={(v) => set('price_tag_required', v)} />
        <TriSelect id={`${idPrefix}-returnable_container`} label="通い箱/折りコン返却" value={state.returnable_container} onChange={(v) => set('returnable_container', v)} />
      </div>

      <label htmlFor={`${idPrefix}-quality_note`} className="space-y-1 block">
        <span className="text-xs font-medium text-ink-soft">品質注意（保冷・傷みやすさ等）</span>
        <textarea id={`${idPrefix}-quality_note`} className={cn(areaCls)} rows={2} value={state.quality_note} onChange={(e) => set('quality_note', e.target.value)} placeholder="要冷蔵・葉物は潰れやすい 等" />
      </label>

      <label htmlFor={`${idPrefix}-standing_notes`} className="space-y-1 block">
        <span className="text-xs font-medium text-ink-soft">固定の追加事項（帳票に毎回表示）</span>
        <textarea id={`${idPrefix}-standing_notes`} className={cn(areaCls)} rows={2} value={state.standing_notes} onChange={(e) => set('standing_notes', e.target.value)} placeholder="毎回入れる指示（帳票・現場の両方に出す）" />
      </label>

      <label htmlFor={`${idPrefix}-field_memo`} className="space-y-1 block">
        <span className="text-xs font-medium text-ink-soft">現場メモ（現場画面のみ表示）</span>
        <textarea id={`${idPrefix}-field_memo`} className={cn(areaCls)} rows={2} value={state.field_memo} onChange={(e) => set('field_memo', e.target.value)} placeholder="現場だけに出す補足（帳票には出さない）" />
      </label>
    </div>
  )
}
