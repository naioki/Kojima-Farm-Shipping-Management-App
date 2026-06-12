/**
 * 数量変更の楽観ロックと Undo 可否（features.md §6）。
 * 誤った Undo は出荷・請求の不整合を生むため、可否判定をここに集約してテストで固定する。
 */

/** Undo の許容期限（時間）。承認後変更=24h、出荷後訂正=72h。 */
export const UNDO_WINDOW_HOURS = {
  postApproval: 24,
  postShipping: 72,
} as const

export interface UndoEligibilityInput {
  /** 取り消す対象変更の audit_log.created_at */
  changeCreatedAt: Date
  now: Date
  /** order_item.shipped_at が記録済み（出荷済み） */
  isShipped: boolean
  /** 紐づく請求書が finalized 済み */
  isInvoiceFinalized: boolean
  /** 他者が編集ロック中 */
  lockedByOther: boolean
  /** 期限（時間）。既定は承認後の 24h */
  windowHours?: number
}

export type UndoBlockReason =
  | 'invoice_finalized'
  | 'already_shipped'
  | 'locked_by_other'
  | 'expired'

export interface UndoEligibility {
  canUndo: boolean
  reason?: UndoBlockReason
  /** 残り時間(ms)。canUndo=true のときのみ意味を持つ */
  remainingMs?: number
}

/**
 * Undo 可否を判定する（features.md §6 の不可条件を順に評価）。
 *   請求確定 → 出荷済み → 他者編集中 → 期限切れ の順でブロック。
 * いずれにも当たらなければ可。Redo は実装しない（複雑化回避）。
 */
export function determineUndoEligibility(input: UndoEligibilityInput): UndoEligibility {
  const windowHours = input.windowHours ?? UNDO_WINDOW_HOURS.postApproval

  if (input.isInvoiceFinalized) return { canUndo: false, reason: 'invoice_finalized' }
  if (input.isShipped) return { canUndo: false, reason: 'already_shipped' }
  if (input.lockedByOther) return { canUndo: false, reason: 'locked_by_other' }

  const elapsedMs = input.now.getTime() - input.changeCreatedAt.getTime()
  const windowMs = windowHours * 60 * 60 * 1000
  if (elapsedMs > windowMs) return { canUndo: false, reason: 'expired' }

  return { canUndo: true, remainingMs: windowMs - elapsedMs }
}

/** 楽観ロック：期待 version と実際の version が一致するか（features.md §6）。 */
export function isVersionCurrent(expected: number, actual: number): boolean {
  return Number.isInteger(expected) && expected === actual
}

/** 残り時間を「残21h」のような表示文字列に整形（UI用）。 */
export function formatRemaining(remainingMs: number): string {
  const totalMin = Math.max(0, Math.floor(remainingMs / 60000))
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return h > 0 ? `残${h}h` : `残${m}分`
}
