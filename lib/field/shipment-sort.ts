import type { FieldStatus } from '@/types/database'

/**
 * 出荷一覧の行ステータス（表示用4区分）と並び順（Issue#5）。
 * field_status の3状態に「中断」（できた数 < 受注 かつ 未出荷）を加えた4区分で、
 * 現場が「これからやること」を上から順に見られるようにする。
 *   未着手 → 中断（作業中） → 梱包完了 → 出荷済み
 * ShipmentStatusSummary の集計と同じ判定基準（二重計上しない）。
 */
export type RowStatusKey = 'not_started' | 'interrupted' | 'packed' | 'shipped'

export function rowStatusKey(
  fieldStatus: FieldStatus,
  shippedQty: number | null,
  orderedQty: number,
): RowStatusKey {
  if (fieldStatus === 'shipped') return 'shipped'
  if (shippedQty != null && shippedQty < orderedQty) return 'interrupted'
  if (fieldStatus === 'packed') return 'packed'
  return 'not_started'
}

const RANK: Record<RowStatusKey, number> = {
  not_started: 0,
  interrupted: 1,
  packed: 2,
  shipped: 3,
}

export function statusRank(key: RowStatusKey): number {
  return RANK[key]
}

/**
 * ステータス順（同順位は元の並びを保つ安定ソート）で id 列を並べ替える。
 * statusById に無い id は未着手扱い（サーバー再取得直後の一瞬でも並びが壊れないように）。
 */
export function sortIdsByStatus(
  ids: readonly string[],
  statusById: ReadonlyMap<string, RowStatusKey>,
): string[] {
  return ids
    .map((id, i) => ({ id, i, rank: RANK[statusById.get(id) ?? 'not_started'] }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map((e) => e.id)
}
