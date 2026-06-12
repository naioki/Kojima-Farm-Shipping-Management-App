/**
 * Gemini 無料枠の優先度ゲート（features.md §4）。
 * 5チャネルで枯渇させないため、残量に応じて優先度ごとに解析可否を決める。
 *
 *   P1 即時 : ポータル/手動 → そもそも Gemini 不要（このゲートの対象外・常に可）
 *   P2 5分  : FAX・メール画像（OCR必要）
 *   P3 バッチ: 差分の低確信度再解析・週次レポート
 *
 * 閾値:
 *   残 > 200 : 全て可
 *   残 <= 200: P3 停止
 *   残 <= 50 : P2 停止し通知（LINE WORKS / Discord）
 *   残 <= 0  : 自動解析停止・手動受付のみ
 */

export const GEMINI_DAILY_FREE_LIMIT = 1500
export const THRESHOLD_P3_PAUSE = 200
export const THRESHOLD_P2_PAUSE = 50

export type GeminiPriority = 'P2' | 'P3'
export type QuotaLevel = 'ok' | 'p3_paused' | 'p2_paused' | 'exhausted'

export interface QuotaStatus {
  level: QuotaLevel
  remaining: number
  allowP2: boolean
  allowP3: boolean
  /** 残50/0 を跨いだら運用者へ通知すべき（features.md §9-2） */
  shouldNotify: boolean
}

/** 当日の残回数から現在のゲート状態を導く。 */
export function getQuotaStatus(remaining: number): QuotaStatus {
  if (remaining <= 0) {
    return { level: 'exhausted', remaining, allowP2: false, allowP3: false, shouldNotify: true }
  }
  if (remaining <= THRESHOLD_P2_PAUSE) {
    return { level: 'p2_paused', remaining, allowP2: false, allowP3: false, shouldNotify: true }
  }
  if (remaining <= THRESHOLD_P3_PAUSE) {
    return { level: 'p3_paused', remaining, allowP2: true, allowP3: false, shouldNotify: false }
  }
  return { level: 'ok', remaining, allowP2: true, allowP3: true, shouldNotify: false }
}

/** 残回数 = 上限 - 当日使用数。負にはしない。 */
export function remainingFromUsage(usedToday: number, limit = GEMINI_DAILY_FREE_LIMIT): number {
  return Math.max(0, limit - usedToday)
}

/** 指定優先度の解析を今走らせてよいか。 */
export function canRunGemini(priority: GeminiPriority, remaining: number): boolean {
  const status = getQuotaStatus(remaining)
  return priority === 'P2' ? status.allowP2 : status.allowP3
}
