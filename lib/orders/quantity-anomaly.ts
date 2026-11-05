/**
 * いつもと違う数量の検知（純関数）。同じ取引先×品目の過去の承認済み数量の中央値と比べ、
 * 3倍以上 / 3分の1以下なら警告する。FAXの読み違い（30→300）と先方の書き間違いの両方を拾う。
 * 過去実績が3件未満のときは判定しない（新規の組み合わせで誤警告しない）。
 */
import { median } from '@/lib/metrics/compute'

export type QuantityAnomaly = 'high' | 'low' | null

export const ANOMALY_FACTOR = 3
export const ANOMALY_MIN_HISTORY = 3

export function detectQuantityAnomaly(
  quantity: number,
  history: number[],
): { anomaly: QuantityAnomaly; usual: number | null } {
  const past = history.filter((n) => Number.isFinite(n) && n > 0)
  if (past.length < ANOMALY_MIN_HISTORY || !(quantity > 0)) return { anomaly: null, usual: null }
  const usual = median(past)!
  if (quantity >= usual * ANOMALY_FACTOR) return { anomaly: 'high', usual }
  if (quantity <= usual / ANOMALY_FACTOR) return { anomaly: 'low', usual }
  return { anomaly: null, usual }
}
