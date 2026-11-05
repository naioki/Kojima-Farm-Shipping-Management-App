/**
 * 出荷前の最終チェック（純関数）。積込前に「承認済みの数量」と「パック済み」が合わない明細だけを拾う。
 *   - 未パック: field_status が not_started（承認後の数量変更でパック済みが戻った明細も含む）
 *   - 一部のみ: パック/出荷の実数（shipped_qty）が注文数に届いていない
 * 合っている明細は出さない（見るべきものだけを出す）。
 */
export interface PreflightItem {
  id: string
  label: string // 取引先 ＞ 納入先
  product_name: string
  quantity: number
  field_status: string | null
  shipped_qty: number | null
}

export interface PreflightIssue {
  id: string
  label: string
  product_name: string
  quantity: number
  kind: 'not_packed' | 'short'
  done: number
}

export function findPreflightIssues(items: PreflightItem[]): PreflightIssue[] {
  const out: PreflightIssue[] = []
  for (const it of items) {
    const q = Number(it.quantity) || 0
    if (q <= 0) continue
    const sq = it.shipped_qty == null ? null : Number(it.shipped_qty)
    if (sq != null && sq < q) {
      out.push({ id: it.id, label: it.label, product_name: it.product_name, quantity: q, kind: 'short', done: sq })
    } else if ((it.field_status ?? 'not_started') === 'not_started' && sq == null) {
      out.push({ id: it.id, label: it.label, product_name: it.product_name, quantity: q, kind: 'not_packed', done: 0 })
    }
  }
  return out.sort((a, b) => a.label.localeCompare(b.label, 'ja') || a.product_name.localeCompare(b.product_name, 'ja'))
}
