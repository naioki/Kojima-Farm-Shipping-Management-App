/**
 * 規格（取引ルール）の変更を「人が読める旧→新」に整形する（履歴表示・通知本文で共用）。
 * audit_log の old_values / new_values（customer_product_rules の行）を受け取る。
 */

const LABELS: Record<string, string> = {
  packs_per_case: 'P/C',
  container_type: '荷姿',
  spec: '規格',
  has_card: 'カード',
  is_default_set: 'いつものセット',
  default_quantity: '既定数量',
  fraction_policy: '端数',
}

const FRACTION_JP: Record<string, string> = {
  confirm: '確認',
  carry_over: '繰越',
  loose: 'バラ',
  round_down: '切捨',
}

/** 比較対象（規格に関わる項目のみ）。 */
export const RULE_TRACKED_FIELDS = Object.keys(LABELS)

function fmt(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'あり' : 'なし'
  if (field === 'fraction_policy') return FRACTION_JP[String(value)] ?? String(value)
  return String(value)
}

export interface RuleChange {
  field: string
  label: string
  before: string
  after: string
}

/** 旧→新の差分（規格項目のみ・実際に変わったもの）。新規作成時は old=null。 */
export function formatRuleChanges(
  oldValues: Record<string, unknown> | null | undefined,
  newValues: Record<string, unknown> | null | undefined,
): RuleChange[] {
  const out: RuleChange[] = []
  for (const field of RULE_TRACKED_FIELDS) {
    const before = oldValues ? oldValues[field] : null
    const after = newValues ? newValues[field] : null
    // 値が変わった項目だけ（新規作成で after が空なら出さない）
    if (before === after) continue
    if (!oldValues && (after === null || after === undefined || after === '')) continue
    out.push({ field, label: LABELS[field]!, before: fmt(field, before), after: fmt(field, after) })
  }
  return out
}

/** 通知・一覧用の1行サマリー（例: "P/C 12→15 / 規格 L→2L"）。 */
export function summarizeRuleChanges(changes: RuleChange[]): string {
  return changes.map((c) => `${c.label} ${c.before}→${c.after}`).join(' / ')
}
