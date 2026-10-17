/**
 * 納品書番号の整形。フォーマット: D + YYYYMM + '-' + 4桁連番（例 D202606-0001）。
 * 連番は get_next_delivery_note_number(p_month) が月別に払い出す（参照用・欠番許容）。
 */

/** 'YYYY-MM-DD' → 'YYYYMM'（採番キー）。 */
export function deliveryNoteMonthKey(deliveryDate: string): string {
  return deliveryDate.slice(0, 7).replace('-', '')
}

/** 月キー（YYYYMM）と連番から納品書番号を作る。 */
export function formatDeliveryNoteNumber(monthKey: string, seq: number): string {
  return `D${monthKey}-${String(seq).padStart(4, '0')}`
}
