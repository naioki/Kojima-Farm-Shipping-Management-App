import type { PendingOrder, PendingOrderItem } from '@/lib/orders/pending-types'

/** 承認画面（SplitApprovalView）の編集行 */
export interface EditableRow extends PendingOrderItem {
  draftQty: string
  saving: boolean
  confirmDelete: boolean
}

export type RowsByOrder = Record<string, EditableRow[]>

function toRow(it: PendingOrderItem): EditableRow {
  return { ...it, draftQty: String(it.quantity), saving: false, confirmDelete: false }
}

/** props の注文から編集行を作る */
export function buildRows(orders: PendingOrder[]): RowsByOrder {
  const map: RowsByOrder = {}
  for (const o of orders) map[o.id] = o.items.map(toRow)
  return map
}

/** 編集中（保存中・数量を打ちかけ・削除確認中）の行か */
function isEditing(row: EditableRow): boolean {
  return row.saving || row.confirmDelete || row.draftQty !== String(row.quantity)
}

/**
 * router.refresh() 後に新しい props が来たとき、編集中でない行は props の値（version 含む）で作り直す。
 * 編集中の行は入力も version も画面で読んだときのまま残す。version だけ最新にすると、他の人の変更を
 * 見ないまま保存して黙って上書きしてしまう（楽観ロックが効かなくなる）。その行の保存は 409 になり、
 * 409 の処理で編集中を解いて再読込すると、次の同期で最新の値になる。
 */
export function syncRowsWithProps(prev: RowsByOrder, orders: PendingOrder[]): RowsByOrder {
  const next: RowsByOrder = {}
  for (const o of orders) {
    const prevById = new Map((prev[o.id] ?? []).map((r) => [r.id, r]))
    next[o.id] = o.items.map((it) => {
      const old = prevById.get(it.id)
      if (old && isEditing(old)) return old
      return toRow(it)
    })
  }
  return next
}

/** /api/orders/revise の成功応答（保存後の各明細の数量・version）で行を更新する */
export function applyRevisedItems(
  rows: EditableRow[],
  saved: Array<{ id: string; quantity: number; version: number }>,
): EditableRow[] {
  const byId = new Map(saved.map((s) => [s.id, s]))
  return rows.map((row) => {
    const s = byId.get(row.id)
    if (!s) return row
    return { ...row, quantity: s.quantity, draftQty: String(s.quantity), version: s.version, confidence: 1.0 }
  })
}
