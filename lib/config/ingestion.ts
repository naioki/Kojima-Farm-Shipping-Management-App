/**
 * 取り込みの設定（features.md §2-1）。
 * ファイル名規則やしきい値は「config で管理（コード直書き禁止）」。規則変更時にコードを触らない。
 * 既定値を持ちつつ環境変数で上書きできるようにする。
 */

/**
 * FAXファイル名から FAX番号と受信日を抽出する正規表現。
 * 既定: "0479123456_20250109_xxxx.pdf" のような "<番号>_<YYYYMMDD>" を想定。
 * 別フォーマットなら FAX_FILENAME_PATTERN（名前付きグループ fax, date 必須）で上書き。
 */
const DEFAULT_FAX_PATTERN = String.raw`(?<fax>\d{6,11})[_-](?<date>\d{8})`

export function getFaxFilenamePattern(): RegExp {
  const src = process.env.FAX_FILENAME_PATTERN || DEFAULT_FAX_PATTERN
  return new RegExp(src)
}

export interface ParsedFaxFilename {
  faxNumber: string
  /** YYYYMMDD */
  dateKey: string
}

/** ファイル名から FAX番号と日付キーを取り出す。規則に合わなければ null（→ status='unmatched'）。 */
export function parseFaxFilename(filename: string): ParsedFaxFilename | null {
  const m = getFaxFilenamePattern().exec(filename)
  const fax = m?.groups?.['fax']
  const date = m?.groups?.['date']
  if (!fax || !date) return null
  return { faxNumber: fax, dateKey: date }
}

/** メール件名/本文に含まれていたら注文として優先する語（features.md §2-2）。 */
export const ORDER_KEYWORDS = (process.env.ORDER_KEYWORDS || '注文,発注,ご注文,オーダー')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

export function looksLikeOrder(text: string): boolean {
  return ORDER_KEYWORDS.some((kw) => text.includes(kw))
}

/**
 * Cloud Scheduler（OIDC）からの呼び出しを検証する（security.md）。
 * 簡易には共有シークレット（CRON_SECRET）をヘッダで確認。OIDC を使う場合は
 * Authorization: Bearer の検証に差し替える。
 */
export function verifyCronRequest(headers: Headers): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const provided = headers.get('x-cron-secret') || headers.get('authorization')?.replace('Bearer ', '')
  return provided === secret
}
