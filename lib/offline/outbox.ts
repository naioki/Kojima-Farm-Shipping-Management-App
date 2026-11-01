import type { FieldStatus } from '@/types/database'

/**
 * オフライン同期の outbox ロジック（v6.0 Local-First Overhaul / features.md §7）。
 * 1. セルタップ（field_status PATCH）の畳み込み・競合判定
 * 2. 新規・増減出荷登録（POST /api/shipments）のオフラインキューイング・指数バックオフ再試行
 * 圏外のビニールハウスや集荷場でも 0ms で UI に確定反映し、電波復帰時に確実に自動同期する。
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
 * 圃場での新規出荷・増減登録（POST /api/shipments）用のオフラインキューエントリ（v6.0追加）。
 */
export interface ShipmentOutboxEntry {
  id: string
  payload: {
    customer_id: string
    product_id: string
    delivery_date: string
    shipping_time?: 'am' | 'pm'
    quantity_raw: string
    packs_per_case?: number
    spec?: string
    container_type?: string
    has_card?: boolean
    destination_id?: string | null
    mode: 'create' | 'increase' | 'decrease' | 'set'
    note?: string
    ai_original?: unknown
  }
  /** 画面表示用のラベル（例: ランドローム / 青梗菜 30箱） */
  summaryLabel: string
  ts: number
  retryCount: number
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

/**
 * 指数バックオフ待機時間（ミリ秒）を算出（最大 30 秒）。
 */
export function calcBackoffMs(retryCount: number): number {
  const base = 1000 * Math.pow(2, Math.max(0, Math.min(retryCount, 5)))
  return Math.min(30000, base)
}

export type SyncOutcome = 'sent' | 'conflict' | 'failed'

/** 1エントリ送信結果の集計用。UI のセル状態反映に使う。 */
export interface SyncResult {
  itemId: string
  outcome: SyncOutcome
  error?: string
}
