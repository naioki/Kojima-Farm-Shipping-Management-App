import 'server-only'
import { getSetting } from '@/lib/settings'

/**
 * 取り込みの設定（features.md §2-1）。
 * ファイル名規則やしきい値は「config で管理（コード直書き禁止）」。規則変更時にコードを触らない。
 * 解決順は設定（DB の app_settings）→ 環境変数 → 既定値。設定画面から入力できる。
 */

/**
 * FAXファイル名から FAX番号と受信日を抽出する正規表現。
 * 既定: "0479123456_20250109_xxxx.pdf" のような "<番号>_<YYYYMMDD>" を想定。
 * 別フォーマットなら設定 FAX_FILENAME_PATTERN（名前付きグループ fax, date 必須）で上書き。
 */
const DEFAULT_FAX_PATTERN = String.raw`(?<fax>\d{6,11})[_-](?<date>\d{8})`

export async function getFaxFilenamePattern(): Promise<RegExp> {
  const src = (await getSetting('FAX_FILENAME_PATTERN')) || DEFAULT_FAX_PATTERN
  return new RegExp(src)
}

export interface ParsedFaxFilename {
  faxNumber: string
  /** YYYYMMDD */
  dateKey: string
}

/** ファイル名から FAX番号と日付キーを取り出す。規則に合わなければ null（→ status='unmatched'）。 */
export async function parseFaxFilename(filename: string): Promise<ParsedFaxFilename | null> {
  const m = (await getFaxFilenamePattern()).exec(filename)
  const fax = m?.groups?.['fax']
  const date = m?.groups?.['date']
  if (!fax || !date) return null
  return { faxNumber: fax, dateKey: date }
}

/** メール件名/本文に含まれていたら注文として優先する語（features.md §2-2）。 */
export async function getOrderKeywords(): Promise<string[]> {
  const raw = (await getSetting('ORDER_KEYWORDS')) || '注文,発注,ご注文,オーダー'
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

export async function looksLikeOrder(text: string): Promise<boolean> {
  const keywords = await getOrderKeywords()
  return keywords.some((kw) => text.includes(kw))
}

/** 取り込み元の Drive フォルダID（設定 DRIVE_FOLDER_ID）。未設定は null。 */
export async function getDriveFolderId(): Promise<string | null> {
  return getSetting('DRIVE_FOLDER_ID')
}

/**
 * Cloud Scheduler（OIDC）からの呼び出しを検証する（security.md）。
 * 簡易には共有シークレット（CRON_SECRET）をヘッダで確認。OIDC を使う場合は
 * Authorization: Bearer の検証に差し替える。
 */
export async function verifyCronRequest(headers: Headers): Promise<boolean> {
  const secret = await getSetting('CRON_SECRET')
  if (!secret) return false
  const provided = headers.get('x-cron-secret') || headers.get('authorization')?.replace('Bearer ', '')
  return provided === secret
}
