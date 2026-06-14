/**
 * 取引先の規格（取引ルール = customer_product_rules）の変更権限。
 * 「いきなり規格を変えられたら困る」対策：設定でロックし、マスター指定の人だけが変更できる。
 *   - RULES_EDIT_LOCK off … 管理者なら変更可（RLS で admin に限定済み）
 *   - RULES_EDIT_LOCK on  … マスター（RULES_MASTER_EMAILS）に載っている人だけ変更可
 *                            ※ マスター未指定（空）は全員ロックアウトを避け、管理者を許可
 */

/** カンマ/改行/セミコロン区切りのメール文字列 → 正規化済みメール配列（小文字・空除去）。 */
export function parseMasterEmails(raw: string | null | undefined): string[] {
  return (raw ?? '')
    .split(/[,\n;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0)
}

export interface RulesEditContext {
  /** RULES_EDIT_LOCK が on か */
  lock: boolean
  /** RULES_MASTER_EMAILS（正規化済み） */
  masterEmails: string[]
  /** 現在のユーザーのメール */
  userEmail: string | null | undefined
}

/** 規格を変更してよいか。 */
export function canEditRules({ lock, masterEmails, userEmail }: RulesEditContext): boolean {
  if (!lock) return true
  if (masterEmails.length === 0) return true // マスター未指定なら管理者を許可（総ロックアウト回避）
  return userEmail != null && masterEmails.includes(userEmail.toLowerCase())
}
