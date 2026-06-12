import type { Channel } from '@/types/database'

/**
 * 重複・再送判定（features.md §3）。
 * 取引先は「前回FAXに行を足して丸ごと再送」してくる。完全重複は捨て、再送は差分取り込みへ回す。
 * 判定はDBの一意制約（exact_hash / message_id）とこの純粋関数の組み合わせで行う。
 */

/** YYYYMMDD（ローカル日付）を返す。sender_date_key の日付部に使う。 */
export function toDateKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}${m}${day}`
}

/**
 * チャネル別の sender_date_key（"識別子_YYYYMMDD"）を組み立てる。
 * - fax   : FAX番号_YYYYMMDD
 * - email : 送信元アドレス_YYYYMMDD
 * - portal/manual : 再送概念なし → null（同日同顧客の警告は別途UIで）
 */
export function buildSenderDateKey(
  channel: Channel,
  identifier: string | null | undefined,
  date: Date,
): string | null {
  if (channel === 'portal' || channel === 'manual') return null
  if (!identifier) return null
  return `${identifier.trim().toLowerCase()}_${toDateKey(date)}`
}

export type ReceiptDisposition = 'duplicate' | 'revision' | 'new'

export interface DedupeSignals {
  /** exact_hash（MD5）が既存と一致した（FAX/画像の完全重複） */
  exactHashMatch: boolean
  /** 同一 sender_date_key の受信が既存にある（同日・同送信元の再送） */
  senderDateKeyMatch: boolean
}

/**
 * 受信物の扱いを決める（features.md §3）。
 *   1. exact_hash 一致      → 'duplicate'（解析せず終了）
 *   2. sender_date_key 一致 → 'revision'（is_revision=true・差分モードで解析）
 *   3. いずれも無し         → 'new'（新規注文）
 * 完全重複の判定を最優先にする（再送扱いで二重計上しないため）。
 */
export function decideReceiptDisposition(signals: DedupeSignals): ReceiptDisposition {
  if (signals.exactHashMatch) return 'duplicate'
  if (signals.senderDateKeyMatch) return 'revision'
  return 'new'
}
