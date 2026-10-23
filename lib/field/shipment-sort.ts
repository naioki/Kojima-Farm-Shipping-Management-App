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

export interface PackSortableItem {
  itemId: string
  customerName: string
  destinationName?: string | null
  dailyPackSortOrder?: number | null
  defaultPackSortOrder?: number | null
  shippingRouteName?: string | null
  departureTime?: string | null
  initialSpec?: string | null
  productName?: string | null
}

/**
 * 収穫・パックボード用ソート（同一出荷先デフォルト集約 ＆ 便順優先）.
 * 1. 管理者の当日手動ソート（dailyPackSortOrder: 10, 20... 最優先）
 * 2. 出発予定時刻（departureTime: 06:00 → 11:30 早い便優先）
 * 3. 納品先デフォルト設定順（defaultPackSortOrder）
 * 4. 出荷先集約（取引先名 ＋ 納品先名）
 * 5. 規格順（spec）
 */
export function comparePackItems(a: PackSortableItem, b: PackSortableItem): number {
  // 1. 管理者当日手動ソート
  const manualA = a.dailyPackSortOrder
  const manualB = b.dailyPackSortOrder
  if (manualA != null && manualB != null && manualA !== manualB) {
    return manualA - manualB
  }
  if (manualA != null && manualB == null) return -1
  if (manualA == null && manualB != null) return 1

  // 2. 出発時刻順（早い便を先に）
  if (a.departureTime && b.departureTime && a.departureTime !== b.departureTime) {
    return a.departureTime.localeCompare(b.departureTime)
  }
  if (a.departureTime && !b.departureTime) return -1
  if (!a.departureTime && b.departureTime) return 1

  // 3. 納品先デフォルト順
  const defaultA = a.defaultPackSortOrder ?? 100
  const defaultB = b.defaultPackSortOrder ?? 100
  if (defaultA !== defaultB) {
    return defaultA - defaultB
  }

  // 4. ★ 出荷先キー（取引先名 + 納品先名）で同一出荷先を完全集約
  const keyA = `${a.customerName}__${a.destinationName || ''}`
  const keyB = `${b.customerName}__${b.destinationName || ''}`
  if (keyA !== keyB) {
    return keyA.localeCompare(keyB, 'ja')
  }

  // 5. 同一出荷先内の規格順
  const specA = a.initialSpec || ''
  const specB = b.initialSpec || ''
  return specA.localeCompare(specB, 'ja')
}
