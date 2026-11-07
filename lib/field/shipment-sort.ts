import { foldKana } from '@/lib/normalize/kana'

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
 * 便名に含まれる重複時刻プレフィックスや絵文字（例: "⏰ 当日18:00迄 岩槻便", "11:30発 岩槻便"）を除去して純粋な便名のみを返す
 */
export function cleanShippingRouteName(routeName: string | null | undefined): string | null {
  if (!routeName) return null
  const cleaned = routeName
    .replace(/^[⏰🌅🚚📦⏳\s]+/g, '')
    .replace(/^(?:(?:翌(?:日)?(?:午前|\d{1,2}:\d{2}|\d{1,2}時)|当日\s*(?:\d{1,2}:\d{2}|\d{1,2}時)?|\d{1,2}:\d{2}|\d{1,2}時)(?:発|出荷|迄に出荷|迄|まで)?[\s・:：]*)+/g, '')
    .replace(/^一般配送・時間未指定$/, '')
    .replace(/^時間指定なし（一般便）$/, '')
    .trim()
  return cleaned || null
}

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
      return time.startsWith('翌') ? `${time}迄（${cleanRoute}）` : `当日 ${time}迄（${cleanRoute}）`
    }
    if (time) {
      return time.startsWith('翌') ? `${time}迄に出荷` : `当日 ${time}迄に出荷`
    }
    if (cleanRoute) return cleanRoute
    return '時間指定なし（一般便）'
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

  if (c.includes('農業総') || c.toUpperCase().includes('NSK') || d.toUpperCase().includes('NSK')) {
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

  return { title: '時間指定なし（一般便）', departureTime: null, shippingRouteName: null }
}

/**
 * ソートモードに応じたグループ境界ヘッダー情報の生成（絵文字や時刻の二重表示を完全排除）
 */
export function getPackGroupInfo(item: PackSortableItem, mode: PackSortMode = 'time'): PackGroupInfo {
  if (mode === 'time') {
    // 積込・配送リスト（DeliveriesBoardView）と同じ「時刻＋便名」で区切る。
    // 時刻だけで区切ると、同じ18:00でも別便（岩槻便と戸田便）が1つの見出しにまとまってしまう。
    const time = item.departureTime
    const route = cleanShippingRouteName(item.shippingRouteName)
    const isNextDayTime = time?.startsWith('翌')
    const timeLabel = time ? (isNextDayTime ? `${time}迄` : `当日 ${time}迄`) : null
    return {
      groupKey: `time:${time || 'unset'}${route ? `|${route}` : ''}`,
      title:
        timeLabel && route
          ? `${timeLabel} ・ ${route}`
          : timeLabel
          ? `${timeLabel}に出荷`
          : route || '時間指定なし（一般便）',
      icon: time ? (isNextDayTime ? '🌅' : '⏰') : '📦',
    }
  }

  if (mode === 'container') {
    const rawCont = item.initialContainer || '通常コンテナ'
    const container = rawCont === '農業総研専用折りたたみコンテナ' ? 'NSKオリコン' : rawCont
    return {
      groupKey: `container:${rawCont}`,
      title: container,
      icon: '📦',
    }
  }

  // mode === 'destination'
  const normDest = normalizeDestinationGroupName(item.customerName, item.destinationName)
  const destName = normDest ? ` ▶ ${normDest}` : ''
  return {
    groupKey: `dest:${item.customerName}__${normDest}`,
    title: `${item.customerName}${destName}`,
    badge: item.departureTime
      ? item.departureTime.startsWith('翌')
        ? `${item.departureTime}迄`
        : `当日${item.departureTime}迄`
      : cleanShippingRouteName(item.shippingRouteName) || undefined,
    icon: '🏢',
  }
}

export function normalizeDestinationGroupName(
  customerName: string | null | undefined,
  destinationName: string | null | undefined,
): string {
  const raw = (destinationName ?? '').trim()
  if (!raw || raw === customerName?.trim() || raw === '直接納品' || raw === '標準納入先') return ''
  const norm = foldKana(raw.normalize('NFKC'))
  if (norm.includes('ラディッシュ') || norm.includes('ボーヤ') || norm.toUpperCase().includes('ST')) {
    return raw
  }
  if (norm.includes('岩槻') && !norm.includes('サンプル')) return '岩槻'
  if (norm.includes('戸田') && !norm.includes('サンプル')) return '戸田'
  if (norm.includes('相模')) return '相模センター'
  if (norm.includes('松戸')) return '松戸'
  if (norm.includes('柏')) return '柏'
  if (norm.includes('川越')) return '川越'
  if (norm.includes('チバセット') || norm.includes('千葉セット')) return 'ちばセット用'
  return raw
}

/**
 * パック作業カードの比較関数（v5.1.11 グループ分裂防止版）。
 * - `mode === 'time'`（早い便順）のときは、必ず「出発時刻（16:00 ➔ 18:00 ➔ 翌午前）」→「便名」を優先にして同じ便グループが分裂するのを防ぎ、
 *   同一時間帯グループの中で `dailyPackSortOrder`（手動並び替え順）を適用する。
 * - `mode === 'container'`（コンテナ順）のときは、必ず「コンテナ種別」を第1優先にして同じコンテナグループが分裂するのを防ぎ、
 *   同一コンテナグループの中で `dailyPackSortOrder` を適用する。
 * - `mode === 'destination'`（納入先順・カスタム順）のときは、`dailyPackSortOrder` を第1優先とし、未設定同士は出荷先・時刻順で並べる。
 */
export function comparePackItems(
  a: PackSortableItem,
  b: PackSortableItem,
  mode: PackSortMode = 'time',
): number {
  const manualA = a.dailyPackSortOrder
  const manualB = b.dailyPackSortOrder
  const compareManual = (): number => {
    if (manualA != null && manualB != null && manualA !== manualB) {
      return manualA - manualB
    }
    if (manualA != null && manualB == null) return -1
    if (manualA == null && manualB != null) return 1
    return 0
  }

  const normDestA = normalizeDestinationGroupName(a.customerName, a.destinationName)
  const normDestB = normalizeDestinationGroupName(b.customerName, b.destinationName)
  const keyA = `${a.customerName}__${normDestA}`
  const keyB = `${b.customerName}__${normDestB}`

  const specA = a.initialSpec || ''
  const specB = b.initialSpec || ''

  const prioA = parseDeparturePriority(a.departureTime)
  const prioB = parseDeparturePriority(b.departureTime)

  if (mode === 'time') {
    if (prioA !== prioB) return prioA - prioB
    // 同じ時刻でも便が違えば別グループ（getPackGroupInfo と同じ区切り）なので、手動順より先に便名でまとめる
    const routeA = cleanShippingRouteName(a.shippingRouteName) ?? ''
    const routeB = cleanShippingRouteName(b.shippingRouteName) ?? ''
    if (routeA !== routeB) {
      if (!routeA) return 1
      if (!routeB) return -1
      return routeA.localeCompare(routeB, 'ja')
    }
    const m = compareManual()
    if (m !== 0) return m
    if (keyA !== keyB) return keyA.localeCompare(keyB, 'ja')
    return specA.localeCompare(specB, 'ja')
  }

  if (mode === 'container') {
    const contA = a.initialContainer || '通常コンテナ'
    const contB = b.initialContainer || '通常コンテナ'
    if (contA !== contB) return contA.localeCompare(contB, 'ja')
    const m = compareManual()
    if (m !== 0) return m
    if (prioA !== prioB) return prioA - prioB
    if (keyA !== keyB) return keyA.localeCompare(keyB, 'ja')
    return specA.localeCompare(specB, 'ja')
  }

  // mode === 'destination'
  const m = compareManual()
  if (m !== 0) return m
  if (prioA !== prioB) return prioA - prioB
  const defaultA = a.defaultPackSortOrder ?? 100
  const defaultB = b.defaultPackSortOrder ?? 100
  if (defaultA !== defaultB) return defaultA - defaultB
  if (keyA !== keyB) return keyA.localeCompare(keyB, 'ja')
  return specA.localeCompare(specB, 'ja')
}

/**
 * 1箱あたりの入数（パック数）を決める。カード表示・途中数・グループ見出し・進捗サマリーで同じ値を使うための共通関数。
 * 優先順: 規格文字列の「入数N」「N入」→ 取引先×品目ルールの入数 → 取引先ごとの既定 → 標準20。
 */
export function resolvePacksPerCase(params: {
  customerName?: string | null
  spec?: string | null
  masterLabelSpec?: string | null
  masterPacksPerCase?: number | null
}): number {
  const { customerName, spec, masterLabelSpec, masterPacksPerCase } = params
  const combinedSpec = `${customerName ?? ''} ${spec || masterLabelSpec || ''}`.normalize('NFKC')
  const match = combinedSpec.match(/(?:入数|1箱|1ケース)\s*[:：]?\s*(\d+)|(\d+)\s*入(?:り)?/i)
  if (match) {
    const parsedNum = Number(match[1] || match[2])
    if (Number.isFinite(parsedNum) && parsedNum >= 10 && parsedNum <= 200) return parsedNum
  }
  if (masterPacksPerCase && masterPacksPerCase >= 10) return masterPacksPerCase
  if (combinedSpec.includes('農業総合研究所') || combinedSpec.includes('NSK')) return 24
  if (combinedSpec.includes('オレンジファーム')) return 25
  if (combinedSpec.includes('やなぎさわ') || combinedSpec.includes('ランドローム')) return 10
  return 20
}

/**
 * パック数を「満杯の箱数＋端数パック」に分ける（箱は切り捨て）。25P・20入 → 1箱+5P。
 * 途中経過の「完了」は満杯になった箱だけを数える（切り上げると 25P が「2箱完了」に見えて出荷ミスにつながる）。
 */
export function splitCasesAndPacks(packs: number, packsPerCase: number): { cases: number; loose: number } {
  const p = Math.max(0, Math.floor(packs))
  const ppc = packsPerCase > 0 ? packsPerCase : 20
  return { cases: Math.floor(p / ppc), loose: p % ppc }
}

/** 「1箱+5P」「2箱」「15P」の表記。0 は「0P」。 */
export function formatCasesAndPacks(packs: number, packsPerCase: number): string {
  const { cases, loose } = splitCasesAndPacks(packs, packsPerCase)
  if (cases > 0 && loose > 0) return `${cases}箱+${loose}P`
  if (cases > 0) return `${cases}箱`
  return `${loose}P`
}

/**
 * 完成した（満杯の）箱数。基本は切り捨てだが、全数できていれば端数箱も含めた総箱数（切り上げ）にそろえる。
 * 残り箱数 = 総箱数 − これ ＝「まだ満杯になっていない箱」の数になり、進捗サマリー・見出し・カードで一致する。
 */
export function completedCaseCount(donePacks: number, totalPacks: number, packsPerCase: number): number {
  const ppc = packsPerCase > 0 ? packsPerCase : 20
  const totalCases = Math.ceil(Math.max(0, totalPacks) / ppc)
  if (donePacks >= totalPacks) return totalCases
  return Math.min(totalCases, Math.floor(Math.max(0, donePacks) / ppc))
}
