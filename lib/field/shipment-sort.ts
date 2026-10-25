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
 * 出荷・締切時刻文字列を時系列の分単位スコアに変換する（小さいほど優先度が高い・早い便）。
 * - 当日便 ('06:00', '16:00', '18:00' 等): 0 〜 1439
 * - 翌日午前・翌日便 ('翌午前', '翌09:00', '翌11:00' 等): 1440 〜 2879
 *   👉 これにより「当日16:00 (NSK) ➜ 当日18:00 (和郷園) ➜ 翌午前 (農業総研)」の順が100%保証される。
 * - 未設定 (null / ''): 9999（最後尾）
 */
export function parseDeparturePriority(departureTime: string | null | undefined): number {
  if (!departureTime) return 9999
  const raw = departureTime.trim()
  if (!raw) return 9999

  const isNextDay = raw.startsWith('翌')
  const body = raw.replace(/^翌(日)?/, '').replace(/^当日/, '').replace(/発$/, '').trim()

  const hmMatch = body.match(/^(\d{1,2}):(\d{2})$/)
  if (hmMatch) {
    const h = parseInt(hmMatch[1]!, 10)
    const m = parseInt(hmMatch[2]!, 10)
    return (isNextDay ? 24 * 60 : 0) + h * 60 + m
  }

  if (body.includes('午前') || body.toLowerCase() === 'am') {
    return (isNextDay ? 24 * 60 : 0) + 11 * 60 + 30
  }
  if (body.includes('午後') || body.toLowerCase() === 'pm') {
    return (isNextDay ? 24 * 60 : 0) + 14 * 60
  }

  return isNextDay ? 24 * 60 + 12 * 60 : 23 * 60 + 59
}

/**
 * 便名に含まれる重複時刻プレフィックス（例: "11:30発 岩槻便" の "11:30発 "）を除去してクリーンな便名を返す
 */
export function cleanShippingRouteName(routeName: string | null | undefined): string | null {
  if (!routeName) return null
  const cleaned = routeName
    .replace(/^(?:(?:翌(?:日)?(?:午前|\d{1,2}:\d{2}|\d{1,2}時)|当日|\d{1,2}:\d{2}|\d{1,2}時)(?:発|出荷|迄|まで)?\s*)+/, '')
    .replace(/^一般配送・時間未指定$/, '')
    .trim()
  return cleaned || null
}

/**
 * 取引先・納入先・マスタオーバーライドから、出荷時刻と便名の初期値・表示タイトルを決定論的に解決する。
 * （収穫・パックボードと便別積込・配送ボードの双方で単一の正として使用）
 * - 和郷園（岩槻・戸田・松戸・柏・相模・川越等）: 当日 18:00 締切
 * - NSK（16時指定・センター便）: 当日 16:00 締切
 * - 農業総研（翌朝・午前中便）: 翌午前 締切
 */
export function resolveDefaultRouteInfo(params: {
  destName: string | null | undefined
  customerName: string | null | undefined
  dest?: { departure_time?: string | null; shipping_route_name?: string | null } | null
  orderShippingTime?: string | null
  override?: { departureTime?: string | null; shippingRouteName?: string | null } | null
}): { title: string; departureTime: string | null; shippingRouteName: string | null } {
  const { destName, customerName, dest, orderShippingTime, override } = params

  const isValidTime = (t: string | null | undefined): boolean => {
    if (!t) return false
    const s = t.trim()
    return /^(?:翌(?:日)?(?:\d{1,2}:\d{2}|午前)|(?:\d{1,2}:\d{2}))$/.test(s)
  }

  const formatTitle = (time: string | null, route: string | null): string => {
    const cleanRoute = cleanShippingRouteName(route)
    if (time && cleanRoute) {
      return time.startsWith('翌') ? `🌅 ${time}迄 ${cleanRoute}` : `⏰ 当日${time}迄 ${cleanRoute}`
    }
    if (time) {
      return time.startsWith('翌') ? `🌅 ${time}迄に出荷` : `⏰ 当日${time}迄に出荷`
    }
    if (cleanRoute) return cleanRoute
    return '一般配送・時間未指定'
  }

  if (override && (cleanShippingRouteName(override.shippingRouteName) || isValidTime(override.departureTime))) {
    const effectiveTime = isValidTime(override.departureTime) ? override.departureTime!.trim() : null
    const effectiveRoute = cleanShippingRouteName(override.shippingRouteName)
    return {
      title: formatTitle(effectiveTime, effectiveRoute),
      departureTime: effectiveTime,
      shippingRouteName: effectiveRoute,
    }
  }

  if (dest && (cleanShippingRouteName(dest.shipping_route_name) || isValidTime(dest.departure_time))) {
    const effectiveTime = isValidTime(dest.departure_time) ? dest.departure_time!.trim() : null
    const effectiveRoute = cleanShippingRouteName(dest.shipping_route_name)
    return {
      title: formatTitle(effectiveTime, effectiveRoute),
      departureTime: effectiveTime,
      shippingRouteName: effectiveRoute,
    }
  }

  const d = (destName ?? '').trim()
  const c = (customerName ?? '').trim()

  // 1. 和郷園（パック当日の午後6時＝18:00まで）
  if (
    c.includes('和郷園') ||
    d.includes('岩槻') ||
    d.includes('戸田') ||
    d.includes('松戸') ||
    d.includes('柏') ||
    d.includes('相模') ||
    d.includes('川越') ||
    c.includes('パルシステム') ||
    d.includes('ちばコープ')
  ) {
    const subRoute =
      d && d !== c && d !== '直接納品' && d !== '標準納入先' ? `${d}便` : '和郷園便'
    return {
      title: formatTitle('18:00', subRoute),
      departureTime: '18:00',
      shippingRouteName: subRoute,
    }
  }

  // 2. NSK / 農業総合研究所
  if (c.includes('農業総') || c.toUpperCase().includes('NSK') || d.toUpperCase().includes('NSK')) {
    // 納入先名や取引先名が明示的にNSK単独・または16時指定の場合
    if (
      d.toUpperCase().includes('NSK') ||
      d.includes('16時') ||
      d.includes('16:00') ||
      (c.toUpperCase().includes('NSK') && !c.includes('農業総'))
    ) {
      const subRoute = 'NSK便'
      return {
        title: formatTitle('16:00', subRoute),
        departureTime: '16:00',
        shippingRouteName: subRoute,
      }
    }
    // 農業総研（パック翌日の午前中までに出荷）
    const subRoute = '農業総研便'
    return {
      title: formatTitle('翌午前', subRoute),
      departureTime: '翌午前',
      shippingRouteName: subRoute,
    }
  }

  if (c.includes('直売') || d.includes('直売')) {
    return { title: '直売所便', departureTime: null, shippingRouteName: '直売所便' }
  }
  if (orderShippingTime === 'am') {
    return { title: formatTitle('11:30', '午前便'), departureTime: '11:30', shippingRouteName: '午前便' }
  }
  if (orderShippingTime === 'pm') {
    return { title: formatTitle('14:00', '午後便'), departureTime: '14:00', shippingRouteName: '午後便' }
  }

  return { title: '一般配送・時間未指定', departureTime: null, shippingRouteName: null }
}

/**
 * ソートモードに応じたグループ境界ヘッダー情報の生成
 */
export function getPackGroupInfo(item: PackSortableItem, mode: PackSortMode = 'time'): PackGroupInfo {
  if (mode === 'time') {
    const time = item.departureTime
    const route = cleanShippingRouteName(item.shippingRouteName)
    const isNextDayTime = time?.startsWith('翌')
    return {
      groupKey: `time:${time || 'unset'}`,
      title: time
        ? isNextDayTime
          ? `🌅 ${time}迄に出荷（翌日午前中迄）`
          : `⏰ 当日 ${time}迄に出荷`
        : '⏳ 時間指定なし（一般便）',
      subtitle: route ? `便: ${route}` : undefined,
      badge: time ? (isNextDayTime ? '翌日午前迄' : `当日${time}迄`) : '時間未指定',
      icon: time ? (isNextDayTime ? '🌅' : '⏰') : '⏳',
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
  const normDest = normalizeDestinationGroupName(item.customerName, item.destinationName)
  const destName = normDest ? ` ➜ ${normDest}` : ''
  return {
    groupKey: `dest:${item.customerName}__${normDest}`,
    title: `${item.customerName}${destName}`,
    subtitle: item.departureTime
      ? item.departureTime.startsWith('翌')
        ? `🌅 ${item.departureTime}迄`
        : `⏰ 当日${item.departureTime}迄`
      : undefined,
    badge: cleanShippingRouteName(item.shippingRouteName) || undefined,
    icon: '🏢',
  }
}

/**
 * 納入先名の表記ゆれ（例：「パルシステム 岩槻」「青コン岩槻」「岩槻」や「ちばコープ グリーンボックス(戸田)」「戸田」）を正規化し、
 * 同一納入先のカードが別グループに分裂するのを防ぐヘルパー。
 */
export function normalizeDestinationGroupName(
  customerName: string | null | undefined,
  destinationName: string | null | undefined,
): string {
  const raw = (destinationName ?? '').trim()
  if (!raw || raw === customerName?.trim() || raw === '直接納品' || raw === '標準納入先') return ''
  const norm = raw.normalize('NFKC')
  if (norm.includes('岩槻') && !norm.includes('サンプル')) return '岩槻'
  if (norm.includes('戸田') && !norm.includes('サンプル')) return '戸田'
  if (norm.includes('相模')) return '相模'
  if (norm.includes('松戸')) return '松戸'
  if (norm.includes('柏')) return '柏'
  if (norm.includes('川越')) return '川越'
  if (norm.includes('ちばセット') || norm.includes('千葉セット')) return 'ちばセット用'
  return raw
}

/**
 * 収穫・パックボード用ソート（3つのモードに対応）.
 * - 'time'（早い便順・デフォルト）: 出荷時刻が早い順 ➜ 納品先まとめ ➜ 規格順
 * - 'destination'（出荷先順）: 出荷時刻優先（16:00 NSK ➜ 18:00 和郷園 ➜ 翌午前 農総研） ➜ 納品先デフォルト順 ➜ 出荷先まとめ ➜ 規格順
 * - 'container'（コンテナ順）: コンテナ種別 ➜ 出荷時刻順（16:00 ➜ 18:00 ➜ 翌午前） ➜ 納品先まとめ ➜ 規格順
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

  // 納品先キー（表記ゆれを吸収して同一出荷先に集約）
  const normDestA = normalizeDestinationGroupName(a.customerName, a.destinationName)
  const normDestB = normalizeDestinationGroupName(b.customerName, b.destinationName)
  const keyA = `${a.customerName}__${normDestA}`
  const keyB = `${b.customerName}__${normDestB}`

  // 規格
  const specA = a.initialSpec || ''
  const specB = b.initialSpec || ''

  const prioA = parseDeparturePriority(a.departureTime)
  const prioB = parseDeparturePriority(b.departureTime)

  if (mode === 'time') {
    // 2. 出発時刻順（当日16:00 ➜ 当日18:00 ➜ 翌午前 ➜ 未設定 の順）
    if (prioA !== prioB) {
      return prioA - prioB
    }

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

    // 3. 同一コンテナ内は必ず早い便順（16:00 ➜ 18:00 ➜ 翌午前）を優先
    if (prioA !== prioB) {
      return prioA - prioB
    }

    // 4. 同一コンテナ・同一時間帯内の出荷先集約
    if (keyA !== keyB) {
      return keyA.localeCompare(keyB, 'ja')
    }

    // 5. 規格順
    return specA.localeCompare(specB, 'ja')
  }

  // mode === 'destination' (出荷先順)
  // 2. まず出荷時刻優先（16:00 NSK ➜ 18:00 和郷園 ➜ 翌午前 農総研）で大きな順序を守る
  if (prioA !== prioB) {
    return prioA - prioB
  }

  // 3. 納品先デフォルト順
  const defaultA = a.defaultPackSortOrder ?? 100
  const defaultB = b.defaultPackSortOrder ?? 100
  if (defaultA !== defaultB) {
    return defaultA - defaultB
  }

  // 4. 出荷先キー集約
  if (keyA !== keyB) {
    return keyA.localeCompare(keyB, 'ja')
  }

  // 5. 規格順
  return specA.localeCompare(specB, 'ja')
}
