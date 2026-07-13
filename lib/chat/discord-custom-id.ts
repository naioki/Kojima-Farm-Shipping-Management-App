/**
 * Discord Interactions の custom_id 設計とユーザー許可判定（チャネル依存だが純関数）。
 * v4 `chat.py` の custom_id 設計を移植。ただし 2E-1 のユースケース層が orderId 起点なので、
 * v4 の verif_id/order_date 二分割は orderId + 任意 date に単純化した。
 *
 * custom_id 一覧（Discord上限100文字。UUID(36)・日付(YYYY-MM-DD,10)ともに ':' を含まないので
 * 単純 split(':') で安全に分解できる）:
 *   preview:<orderId>              未確定注文の明細プレビュー＋承認/日付ボタン（同期応答）
 *   approve:<orderId>              納品日確定済み → そのまま承認して印刷（同期・type:4）
 *   approve_pick:<orderId>         納品日/納入先未確定 → 日付選択ボタンを出す（同期応答）
 *   approve_on:<orderId>:<date>    選んだ日付で承認して印刷（同期・type:4）
 *   approve_other:<orderId>        日付を手入力するモーダルを開く
 *   approve_modal:<orderId>        ↑モーダル送信（date_input を resolveDateFromText で解決・同期・type:4）
 *   reprint:<orderId>:<date>       確定済み受注の印刷キュー再投入（同期・type:4）
 *   ingest                         メール取込を起動（poll-email を self-invoke → 即 ack。日付スコープなし）
 *
 * 2E-2r: poll-email はメールボックス全体を Message-ID で重複排除する設計で日付スコープを持たない
 * ため、取込の日付ピッカー（旧 ingest_pick/ingest_on/ingest_other/ingest_modal）は廃止し
 * 単一トリガー ingest に一本化した。
 */

export interface ParsedCustomId {
  action: string
  args: string[]
}

/** custom_id を action と引数へ分解する。先頭要素が action、以降が引数。 */
export function parseCustomId(customId: string): ParsedCustomId {
  const parts = customId.split(':')
  return { action: parts[0] ?? '', args: parts.slice(1) }
}

/** action と引数から custom_id を組み立てる（引数に ':' を含めてはならない）。 */
export function buildCustomId(action: string, ...args: string[]): string {
  return [action, ...args].join(':')
}

/**
 * ALLOWED_DISCORD_USERS（カンマ区切り）をユーザーID配列へ。空/未設定は空配列（＝全員許可）。
 */
export function parseAllowedUsers(raw: string | null | undefined): string[] {
  if (!raw) return []
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

/**
 * 許可判定。allowed が空なら全員許可（設定していない運用を尊重）。
 * 非空なら userId が含まれるときのみ true。userId 不明（null）は非空リスト下では拒否。
 */
export function isUserAllowed(allowed: string[], userId: string | null | undefined): boolean {
  if (allowed.length === 0) return true
  if (!userId) return false
  return allowed.includes(userId)
}
