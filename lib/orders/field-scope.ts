import type { OrderStatus } from '@/types/database'

/**
 * 「現場の作業対象はどの注文か」の単一の正。
 *
 * 承認ゲート（app/api/orders/[id]/approve）は、出荷一覧に来た時点で
 * 納品日・納入先・荷姿が確定していることを保証するために置かれている。
 * ところが現場の各画面は delivery_date だけで注文を拾っていたため、
 *   - まだ人が検証していない解析結果（pending_review）
 *   - キャンセル済み
 * までが作業リスト・印刷帳票に出ていた（＝ゲートが素通り）。
 * 現場・印刷・配送で判定がずれないよう、絞り込みは必ずこのファイルを通す。
 *
 * 方針（オーナー判断）:
 *   - キャンセルはどこにも出さない
 *   - 未承認は「出荷一覧に警告付きで別枠表示」までは許す（事務所の承認待ちで
 *     現場の画面が空になり「今日は何もない」に見えるのを避けるため）。
 *     ただし印刷帳票と積込チェックからは外す（未検証のまま荷を作らせない）。
 */

/** 現場の画面に出してよい状態（キャンセルだけ落とす）。 */
export const FIELD_VISIBLE_STATUSES: readonly OrderStatus[] = [
  'pending_review',
  'approved',
  'shipped',
  'invoiced',
]

/** 承認済みとして扱う状態（承認後に進んだ状態も含む）。 */
export const FIELD_APPROVED_STATUSES: readonly OrderStatus[] = ['approved', 'shipped', 'invoiced']

/** 承認ゲートを通っているか。印刷・積込に載せてよいのはこれだけ。 */
export function isApprovedForField(status: string | null | undefined): boolean {
  return FIELD_APPROVED_STATUSES.includes(status as OrderStatus)
}

/** まだ人が検証していない（事務所の承認待ち）。警告付きで別枠表示する。 */
export function isAwaitingApproval(status: string | null | undefined): boolean {
  return status === 'pending_review'
}

/** キャンセル済み（どの現場画面にも出さない）。 */
export function isCancelled(status: string | null | undefined): boolean {
  return status === 'cancelled'
}
