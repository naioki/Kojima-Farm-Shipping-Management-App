/**
 * 納品書スナップショットの同一判定（純関数）。
 * 発行済みの納品書は書き換えない（CLAUDE.md: スナップショット凍結）。
 * 内容が同じなら既存を再利用し、違えば新しい番号で発行する、の判定に使う。
 */
export interface NoteItemLite {
  product_name: string
  quantity: number | string
  unit: string
  unit_price: number | string | null
  tax_rate: number | string
}
export interface NoteHeaderLite {
  amount_mode: string
  issuer_name: string | null
  issuer_address: string | null
  issuer_tel: string | null
  total_amount: number | string | null
}

const fmt = (n: number | string | null | undefined) => (Number(n ?? 0) || 0).toFixed(2)

export function noteItemsSignature(rows: NoteItemLite[]): string {
  return rows
    .map((r) => [r.product_name, fmt(r.quantity), r.unit, fmt(r.unit_price), String(Number(r.tax_rate))].join('|'))
    .join('\n')
}

export function isSameNoteSnapshot(
  existing: { header: NoteHeaderLite; items: NoteItemLite[] },
  next: { header: NoteHeaderLite; items: NoteItemLite[] },
): boolean {
  const a = existing.header
  const b = next.header
  return (
    a.amount_mode === b.amount_mode &&
    (a.issuer_name ?? null) === (b.issuer_name ?? null) &&
    (a.issuer_address ?? null) === (b.issuer_address ?? null) &&
    (a.issuer_tel ?? null) === (b.issuer_tel ?? null) &&
    fmt(a.total_amount) === fmt(b.total_amount) &&
    noteItemsSignature(existing.items) === noteItemsSignature(next.items)
  )
}
