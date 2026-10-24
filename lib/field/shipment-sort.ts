export type RowStatusKey = 'not_started' | 'interrupted' | 'packed' | 'shipped'

export function rowStatusKey(
  fieldStatus: string,
  shippedQty: number | null | undefined,
  orderedQty: number,
): RowStatusKey {
  if (fieldStatus === 'shipped') return 'shipped'
  if (shippedQty != null && shippedQty < orderedQty) {
    return 'interrupted'
  }
  if (fieldStatus === 'packed' || fieldStatus === 'not_started') {
    return fieldStatus
  }
  return 'not_started'
}

export function statusRank(status: string): number {
  switch (status) {
    case 'not_started':
      return 0
    case 'interrupted':
      return 1
    case 'packed':
      return 2
    case 'shipped':
      return 3
    default:
      return 0
  }
}

export function sortIdsByStatus(
  ids: string[],
  statusById: Map<string, string>,
): string[] {
  return ids
    .map((id, i) => ({
      id,
      i,
      rank: statusRank(statusById.get(id) ?? 'not_started'),
    }))
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
  initialContainer?: string | null
  productName?: string | null
}

export type PackSortMode = 'time' | 'destination' | 'container'

export interface PackGroupInfo {
  groupKey: string
  title: string
  subtitle?: string
  badge?: string
  icon: string
}

/**
 * ソートモードに応じたグループ境界ヘッダー情報の生成
 */
export function getPackGroupInfo(item: PackSortableItem, mode: PackSortMode = 'time'): PackGroupInfo {
  if (mode === 'time') {
    const time = item.departureTime
    const route = item.shippingRouteName
    return {
      groupKey: `time:${time || 'unset'}`,
      title: time ? `⏰ ${time}発 便` : '⏳ 便未定 / 午後',
      subtitle: route ? `ルート: ${route}` : undefined,
      badge: time ? '便指定' : '未定',
      icon: time ? '⏰' : '⏳',
    }
  }

  if (mode === 'container') {
    const container = item.initialContainer || '通常コンテナ'
    return {
      groupKey: `container:${container}`,
      title: `📦 ${container}`,
      icon: '📦',
    }
  }

  // mode === 'destination' (出荷先まとめ順)
  const destName = item.destinationName ? ` ➜ ${item.destinationName}` : ''
  return {
    groupKey: `dest:${item.customerName}__${item.destinationName || ''}`,
    title: `${item.customerName}${destName}`,
    subtitle: item.departureTime ? `⏰ ${item.departureTime}発` : undefined,
    badge: item.shippingRouteName || undefined,
    icon: '🏢',
  }
}

/**
 * 収穫・パックボード用ソート（3つのモードに対応）.
 * - 'time'（早い便順・デフォルト）: 出荷時刻が早い順 ➜ 納品先まとめ ➜ 規格順
 * - 'destination'（出荷先順）: 納品先デフォルト順 ➜ 出荷先まとめ ➜ 便順 ➜ 規格順
 * - 'container'（コンテナ順）: コンテナ種別 ➜ 納品先まとめ ➜ 便順 ➜ 規格順
 * ※いずれのモードでも管理者の当日手動ソート（dailyPackSortOrder）は最優先。
 */
export function comparePackItems(
  a: PackSortableItem,
  b: PackSortableItem,
  mode: PackSortMode = 'time',
): number {
  // 1. 管理者当日手動ソート（最優先）
  const manualA = a.dailyPackSortOrder
  const manualB = b.dailyPackSortOrder
  if (manualA != null && manualB != null && manualA !== manualB) {
    return manualA - manualB
  }
  if (manualA != null && manualB == null) return -1
  if (manualA == null && manualB != null) return 1

  // 納品先キー（同一出荷先集約）
  const keyA = `${a.customerName}__${a.destinationName || ''}`
  const keyB = `${b.customerName}__${b.destinationName || ''}`

  // 規格
  const specA = a.initialSpec || ''
  const specB = b.initialSpec || ''

  if (mode === 'time') {
    // 2. 出発時刻順（早い便を先に、未設定は後ろに）
    if (a.departureTime && b.departureTime && a.departureTime !== b.departureTime) {
      return a.departureTime.localeCompare(b.departureTime)
    }
    if (a.departureTime && !b.departureTime) return -1
    if (!a.departureTime && b.departureTime) return 1

    // 3. 同一便内の出荷先集約
    if (keyA !== keyB) {
      return keyA.localeCompare(keyB, 'ja')
    }

    // 4. 同一出荷先内の規格順
    return specA.localeCompare(specB, 'ja')
  }

  if (mode === 'container') {
    // 2. コンテナ種別順
    const contA = a.initialContainer || '通常コンテナ'
    const contB = b.initialContainer || '通常コンテナ'
    if (contA !== contB) {
      return contA.localeCompare(contB, 'ja')
    }

    // 3. 同一コンテナ内の出荷先（納品先別）
    if (keyA !== keyB) {
      return keyA.localeCompare(keyB, 'ja')
    }

    // 4. 便順
    if (a.departureTime && b.departureTime && a.departureTime !== b.departureTime) {
      return a.departureTime.localeCompare(b.departureTime)
    }

    // 5. 規格順
    return specA.localeCompare(specB, 'ja')
  }

  // mode === 'destination' (出荷先順)
  // 2. 納品先デフォルト順
  const defaultA = a.defaultPackSortOrder ?? 100
  const defaultB = b.defaultPackSortOrder ?? 100
  if (defaultA !== defaultB) {
    return defaultA - defaultB
  }

  // 3. 出荷先キー集約
  if (keyA !== keyB) {
    return keyA.localeCompare(keyB, 'ja')
  }

  // 4. 出発時刻順
  if (a.departureTime && b.departureTime && a.departureTime !== b.departureTime) {
    return a.departureTime.localeCompare(b.departureTime)
  }

  // 5. 規格順
  return specA.localeCompare(specB, 'ja')
}
