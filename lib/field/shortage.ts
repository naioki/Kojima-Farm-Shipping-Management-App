import Decimal from 'decimal.js'
import type { EstimateStatus } from '@/types/database'

/**
 * 過不足計算（features.md §8）。
 * 収穫見込み(harvest_estimates) − 必要数(harvest_tasks 集計)。
 * 未入力は「0」ではなく「⚠️未入力」として扱う（0と誤認させない）。
 */

export interface EstimateInput {
  status: EstimateStatus
  planned_qty?: number | null
  estimate_qty?: number | null
  actual_qty?: number | null
  carry_over?: number | null
}

export type ShortageKind = 'not_entered' | 'shortage' | 'surplus' | 'even'

export interface ShortageResult {
  kind: ShortageKind
  /** 見込み総量（実→見直し→計画の優先で採用＋前日繰越）。未入力は null */
  available: Decimal | null
  /** available − required。未入力は null。負＝不足 */
  net: Decimal | null
}

/** 見込みは actual > estimate > planned の優先で確定値を採用し、繰越を足す。 */
function resolveAvailable(est: EstimateInput): Decimal | null {
  const pick = est.actual_qty ?? est.estimate_qty ?? est.planned_qty
  if (pick == null) return null
  return new Decimal(pick).plus(est.carry_over ?? 0)
}

export function calcShortage(requiredQty: Decimal.Value, est: EstimateInput): ShortageResult {
  if (est.status === 'not_entered') {
    return { kind: 'not_entered', available: null, net: null }
  }
  const available = resolveAvailable(est)
  if (available == null) {
    // ステータスは入力済みだが数値が無い → 未入力扱い（安全側）
    return { kind: 'not_entered', available: null, net: null }
  }
  const net = available.minus(requiredQty)
  const kind: ShortageKind = net.isNegative() ? 'shortage' : net.isZero() ? 'even' : 'surplus'
  return { kind, available, net }
}
