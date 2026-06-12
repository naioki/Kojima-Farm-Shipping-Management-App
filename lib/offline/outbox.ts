import type { FieldStatus } from '@/types/database'

/**
 * オフライン同期の outbox ロジック（features.md §7 オフライン同期 / Phase F）。
 * 圏外でのタップを IndexedDB の outbox に積み、復帰時に順次 PATCH する。
 * ここでは「積まれたエントリの畳み込み」「PATCH ペイロード化」「競合判定」という
 * 純粋ロジックのみを持ち、IndexedDB I/O は呼び出し側（hooks）に委ねてテスト可能にする。
 */

export interface OutboxEntry {
  itemId: string
  fieldStatus: FieldStatus
  /** タップ時点で UI が持っていた version（楽観ロック用） */
  version: number
  /** epoch ms。送信順・畳み込みの基準 */
  ts: number
}

/**
 * 同一 itemId の複数タップは最終状態だけを送ればよいので、ts が最大のものに畳み込む。
 * 送信順を安定させるため ts 昇順で返す。
 */
export function collapseOutbox(entries: OutboxEntry[]): OutboxEntry[] {
  const latest = new Map<string, OutboxEntry>()
  for (const e of entries) {
    const cur = latest.get(e.itemId)
    if (!cur || e.ts > cur.ts) latest.set(e.itemId, e)
  }
  return [...latest.values()].sort((a, b) => a.ts - b.ts)
}

export interface PatchPayload {
  field_status: FieldStatus
  version: number
}

export function toPatchPayload(entry: OutboxEntry): PatchPayload {
  return { field_status: entry.fieldStatus, version: entry.version }
}

/**
 * サーバの現 version と outbox エントリの version がずれていれば競合。
 * 競合セルは赤表示で手動確認（§6 の楽観ロックを流用）。
 */
export function isConflict(entry: OutboxEntry, serverVersion: number): boolean {
  return entry.version !== serverVersion
}

export type SyncOutcome = 'sent' | 'conflict' | 'failed'

/** 1エントリ送信結果の集計用。UI のセル状態反映に使う。 */
export interface SyncResult {
  itemId: string
  outcome: SyncOutcome
  error?: string
}
