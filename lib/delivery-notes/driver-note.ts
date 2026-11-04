import { shiftDateStr } from '@/lib/dates'
import { determineUnitCount } from '@/lib/pipeline/schemas'

export type IssuerPreset = 'kojima' | 'iplus'
export type DeliveryNoteIssuerPreset = IssuerPreset
export type DeliveryNoteLayout = '2up' | 'full'

export const ISSUER_PRESETS: { value: IssuerPreset; label: string; companyName: string }[] = [
  { value: 'kojima', label: '小島農園', companyName: '小島農園' },
  { value: 'iplus', label: '株式会社アイプラス', companyName: '株式会社アイプラス' },
]

export const DELIVERY_NOTE_LAYOUTS: { value: DeliveryNoteLayout; label: string; hint: string }[] = [
  {
    value: '2up',
    label: 'A4上下2連（切るとA5×2枚：納品書＋控）',
    hint: '上半分が運転手渡し用の納品書、下半分が農園控え（半分に切るとA5サイズ）',
  },
  {
    value: 'full',
    label: 'A4全面（1枚）',
    hint: 'A4用紙1枚に納品書のみを大きく印字',
  },
]

export function parseIssuerPreset(
  val: string | null | undefined,
  fallback: IssuerPreset = 'kojima',
): IssuerPreset {
  if (val === 'iplus' || val === '株式会社アイプラス' || val === 'アイプラス') return 'iplus'
  if (val === 'kojima' || val === '小島農園') return 'kojima'
  return fallback
}

export function parseDeliveryNoteLayout(
  val: string | null | undefined,
  fallback: DeliveryNoteLayout = '2up',
): DeliveryNoteLayout {
  if (val === '2up' || val === 'full') return val
  return fallback
}

/**
 * トラック運転手へ納品書を手渡しする対象取引先かどうかを判定する。
 * （株式会社勘兵衛・株式会社オレンジファーム、または channel_identifiers で指定された取引先）
 */
export function isDriverDeliveryNoteCustomer(
  customerName?: string | null,
  channelIdentifiers?: Record<string, unknown> | null,
): boolean {
  if (channelIdentifiers && typeof channelIdentifiers.requires_delivery_note === 'boolean') {
    return channelIdentifiers.requires_delivery_note
  }
  const norm = (customerName ?? '').normalize('NFKC')
  return norm.includes('勘兵衛') || norm.includes('オレンジファーム') || norm.includes('オレンジ')
}

/**
 * 取引先ごとの既定の発行元名義（小島農園 / 株式会社アイプラス）を返す。
 * - 勘兵衛・オレンジファーム ➔ 株式会社アイプラス
 * - その他 ➔ 小島農園
 */
export function resolveDefaultIssuerPreset(
  customerName?: string | null,
  channelIdentifiers?: Record<string, unknown> | null,
): IssuerPreset {
  if (channelIdentifiers && typeof channelIdentifiers.issuer_preset === 'string') {
    return parseIssuerPreset(channelIdentifiers.issuer_preset)
  }
  const norm = (customerName ?? '').normalize('NFKC')
  if (norm.includes('勘兵衛') || norm.includes('オレンジファーム') || norm.includes('オレンジ')) {
    return 'iplus'
  }
  return 'kojima'
}

export function resolveIssuerCompanyName(preset: IssuerPreset, defaultFarmName?: string | null): string {
  if (preset === 'iplus') return '株式会社アイプラス'
  return defaultFarmName?.trim() || '小島農園'
}

/**
 * 納品書に印字する日付（1つだけ）を決定する。
 * - オレンジファームのように「出荷ボード上は水曜・金曜出荷」だが「FAX伝票記載日は木曜・土曜着」の場合、
 *   納品書にはFAX記載の日付（11/5、11/7、11/12等）1つだけを印字して現場・納品先の混乱を防ぐ。
 */
export function resolvePrintedDeliveryDate(
  customerName: string | null | undefined,
  deliveryDate: string,
  orderNotes?: Array<string | null | undefined>,
): string {
  for (const n of orderNotes ?? []) {
    if (!n) continue
    const m = n.match(/(?:伝票着日|着日)\s*[:：]?\s*(\d{4}-\d{2}-\d{2})/)
    if (m?.[1]) return m[1]
  }
  const norm = (customerName ?? '').normalize('NFKC')
  if ((norm.includes('オレンジファーム') || norm.includes('オレンジ')) && /^\d{4}-\d{2}-\d{2}$/.test(deliveryDate)) {
    const [y, m, d] = deliveryDate.split('-').map(Number)
    if (y && m && d) {
      const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
      // 水曜(3)出荷 → 木曜(4)着、金曜(5)出荷 → 土曜(6)着
      if (dow === 3 || dow === 5) {
        return shiftDateStr(deliveryDate, 1)
      }
    }
  }
  return deliveryDate
}

/**
 * 納品書の明細行に表示する「箱数（ケース数）」と「総数量」およびクリーンな規格表記を算出する。
 */
export function formatDeliveryNoteItemQty(params: {
  customerName?: string | null
  productName: string
  quantity: number
  unit: string
  spec?: string | null
  packsPerCase?: number | null
}): {
  displayName: string
  boxCountText: string
  totalQtyText: string
} {
  const ppc = determineUnitCount(
    params.customerName,
    params.spec,
    params.packsPerCase,
    params.productName,
  )
  const qty = Math.max(0, Math.round(Number(params.quantity) || 0))
  const cases = ppc > 0 ? Math.floor(qty / ppc) : 0
  const rem = ppc > 0 ? qty % ppc : 0

  let boxCountText = '—'
  if (ppc > 1 && qty > 0) {
    if (cases > 0 && rem > 0) {
      boxCountText = `${cases}箱＋端数${rem}${params.unit || 'P'}`
    } else if (cases > 0) {
      boxCountText = `${cases}箱`
    } else {
      boxCountText = `バラ${rem}${params.unit || 'P'}`
    }
  } else if (ppc === 1 && qty > 0) {
    boxCountText = `${qty}箱`
  }

  const cleanSpec = (params.spec ?? '')
    .replace(/\(\s*入数\s*\d+\s*\)/g, '')
    .replace(/（\s*入数\s*\d+\s*）/g, '')
    .trim()

  const specSuffix = cleanSpec
    ? cleanSpec.includes('入')
      ? `（${cleanSpec}）`
      : `（${cleanSpec}・${ppc}入）`
    : ppc > 1
    ? `（${ppc}入）`
    : ''

  return {
    displayName: `${params.productName}${specSuffix}`,
    boxCountText,
    totalQtyText: `${qty.toLocaleString('ja-JP')}${params.unit || '袋'}`,
  }
}
