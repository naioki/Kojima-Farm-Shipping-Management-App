import { normalizeOrgName } from '@/lib/normalize/org-name'
import { foldKana } from '@/lib/normalize/kana'
import { similarity } from '@/lib/matching/name-match'
import { jstTodayStr, shiftDateStr } from '@/lib/dates'
import { matchDestination } from '@/lib/field/batch-register'
import type { OrdersResult, ParsedOrder, ParsedItem } from '@/lib/gemini/analyze'

export interface CustomerLike {
  id: string
  name: string
}

export interface DestinationLike {
  id: string
  customer_id?: string | null
  customerId?: string | null
  code?: string | null
  full_name?: string | null
  aliases?: string[] | null
}

export interface ProductLike {
  id: string
  name: string
  unit?: string | null
  default_unit_price?: number | null
  default_tax_rate?: number | null
}

/** 既知の略称・現場呼称から正式名または主要キーワードへのマッピング */
const KNOWN_CUSTOMER_PATTERNS: Array<{ regex: RegExp; keywords: string[] }> = [
  { regex: /農総研|農業総合研究所|NSK/i, keywords: ['農業総合研究所', 'nsk'] },
  { regex: /和郷園|和郷/i, keywords: ['和郷園', '和郷'] },
  { regex: /房総食料|房総/i, keywords: ['房総食料', '房総'] },
  { regex: /寺崎|テラサキ/i, keywords: ['寺崎', 'テラサキ'] },
  { regex: /ヨーク|ヨークマート|ヨークベニマル/i, keywords: ['ヨーク', 'york'] },
  { regex: /勘兵衛|かんべえ/i, keywords: ['勘兵衛', 'かんべえ'] },
  { regex: /らでぃっしゅ|オイシックス|らでぃっしゅぼーや/i, keywords: ['らでぃっしゅぼーや', 'オイシックス'] },
]

/**
 * 取引先名の最良一致を決定論的に特定する
 */
export function findBestMatchingCustomer<T extends { id: string; name: string }>(
  rawText: string | null | undefined,
  customers: T[],
): T | null {
  if (!rawText || !rawText.trim() || !customers.length) return null

  const cleanRaw = rawText.trim()
  const rawNorm = normalizeOrgName(foldKana(cleanRaw))

  // 1. 完全一致（正規化後）
  for (const c of customers) {
    const cNorm = normalizeOrgName(foldKana(c.name))
    if (cNorm && (cNorm === rawNorm || c.name === cleanRaw)) {
      return c
    }
  }

  // 2. 既知の別名・エイリアスパターンマッチ
  for (const pattern of KNOWN_CUSTOMER_PATTERNS) {
    if (pattern.regex.test(cleanRaw)) {
      for (const c of customers) {
        const cLower = c.name.toLowerCase()
        if (pattern.keywords.some((kw) => cLower.includes(kw.toLowerCase()))) {
          return c
        }
      }
    }
  }

  // 3. 部分一致（包含関係）
  for (const c of customers) {
    const cNorm = normalizeOrgName(foldKana(c.name))
    if (!cNorm || !rawNorm) continue
    if (cNorm.length >= 3 && rawNorm.includes(cNorm)) return c
    if (rawNorm.length >= 3 && cNorm.includes(rawNorm)) return c
  }

  // 4. 文字列類似度（Levenshtein）
  let bestCust: T | null = null
  let bestScore = 0
  for (const c of customers) {
    const score = similarity(cleanRaw, c.name)
    if (score > bestScore) {
      bestScore = score
      bestCust = c
    }
  }

  if (bestScore >= 0.65 && bestCust) {
    return bestCust
  }

  return null
}

/**
 * 納入先（店舗・センター）の最良一致を特定する
 */
export function findBestMatchingDestination<
  T extends {
    id: string
    customer_id?: string | null
    customerId?: string | null
    code?: string | null
    full_name?: string | null
    aliases?: string[] | null
  }
>(
  rawText: string | null | undefined,
  destinations: T[],
  customerId?: string | null,
): T | null {
  if (!rawText || !rawText.trim() || !destinations.length) return null

  const cleanText = rawText.trim()
  const pool = customerId
    ? destinations.filter((d) => (d.customer_id ?? d.customerId) === customerId)
    : destinations

  const searchPool = pool.length > 0 ? pool : destinations

  // 1. matchDestination (既存ロジック)
  const formattedForMatch = searchPool.map((d) => ({
    id: d.id,
    label: d.full_name || d.code || '',
    code: d.code ?? undefined,
    aliases: d.aliases ?? undefined,
  }))
  const matched = matchDestination(cleanText, formattedForMatch)
  if (matched) {
    const found = searchPool.find((d) => d.id === matched.id)
    if (found) return found
  }

  // 2. 正規化部分一致・コード一致
  const normSearch = foldKana(cleanText).replace(/[\s　]+/g, '').toLowerCase()
  for (const d of searchPool) {
    const dName = foldKana(d.full_name || '').replace(/[\s　]+/g, '').toLowerCase()
    const dCode = (d.code || '').replace(/[\s　]+/g, '').toLowerCase()
    if (dName && (dName.includes(normSearch) || normSearch.includes(dName))) {
      return d
    }
    if (dCode && (dCode === normSearch || normSearch.includes(dCode))) {
      return d
    }
    if (d.aliases && Array.isArray(d.aliases)) {
      for (const a of d.aliases) {
        const aNorm = foldKana(a).replace(/[\s　]+/g, '').toLowerCase()
        if (aNorm && (aNorm.includes(normSearch) || normSearch.includes(aNorm))) {
          return d
        }
      }
    }
  }

  // 3. 類似度スコア
  let bestDest: T | null = null
  let bestScore = 0
  for (const d of searchPool) {
    const target = d.full_name || d.code || ''
    const score = similarity(cleanText, target)
    if (score > bestScore) {
      bestScore = score
      bestDest = d
    }
  }

  if (bestScore >= 0.65 && bestDest) {
    return bestDest
  }

  return null
}

/**
 * 日本語の相対日付・絶対日付を解析する
 */
export function parseRelativeDateFromText(
  text: string,
  referenceDate?: string,
): { deliveryDate: string | null; dateExpression: string | null } {
  const ref = referenceDate && /^\d{4}-\d{2}-\d{2}$/.test(referenceDate) ? referenceDate : jstTodayStr()
  const s = text.trim()

  // 1. 相対日付キーワード
  if (/明後日|あさって/.test(s)) {
    return { deliveryDate: shiftDateStr(ref, 2), dateExpression: '明後日' }
  }
  if (/明々後日|しあさって/.test(s)) {
    return { deliveryDate: shiftDateStr(ref, 3), dateExpression: '明々後日' }
  }
  if (/明日|あす|あした/.test(s)) {
    return { deliveryDate: shiftDateStr(ref, 1), dateExpression: '明日' }
  }
  if (/今日|きょう|本日/.test(s)) {
    return { deliveryDate: ref, dateExpression: '今日' }
  }
  if (/昨日|きのう/.test(s)) {
    return { deliveryDate: shiftDateStr(ref, -1), dateExpression: '昨日' }
  }

  // 2. YYYY-MM-DD / YYYY/MM/DD
  const fullMatch = s.match(/(20\d{2})[-/年](\d{1,2})[-/月](\d{1,2})日?/)
  if (fullMatch && fullMatch[1] && fullMatch[2] && fullMatch[3]) {
    const y = fullMatch[1]
    const m = fullMatch[2].padStart(2, '0')
    const d = fullMatch[3].padStart(2, '0')
    return { deliveryDate: `${y}-${m}-${d}`, dateExpression: fullMatch[0] }
  }

  // 3. M/D / M月D日
  const shortMatch = s.match(/(?:^|[^\d])(\d{1,2})[/月](\d{1,2})日?/)
  if (shortMatch && shortMatch[1] && shortMatch[2]) {
    const y = ref.slice(0, 4)
    const m = shortMatch[1].padStart(2, '0')
    const d = shortMatch[2].padStart(2, '0')
    return { deliveryDate: `${y}-${m}-${d}`, dateExpression: shortMatch[0].trim() }
  }

  // 4. 曜日解析 (例: 月曜, 金曜日, 来週火曜)
  const weekdays = ['日', '月', '火', '水', '木', '金', '土']
  const weekdayMatch = s.match(/(来週)?([日月火水木金土])曜(?:日)?/)
  if (weekdayMatch && weekdayMatch[2]) {
    const isNextWeek = Boolean(weekdayMatch[1])
    const targetDayIndex = weekdays.indexOf(weekdayMatch[2])
    const refDate = new Date(`${ref}T00:00:00+09:00`)
    const currentDayIndex = refDate.getDay()
    let diff = targetDayIndex - currentDayIndex
    if (diff <= 0) diff += 7
    if (isNextWeek) diff += 7
    return {
      deliveryDate: shiftDateStr(ref, diff),
      dateExpression: weekdayMatch[0],
    }
  }

  return { deliveryDate: null, dateExpression: null }
}

/**
 * 数量・ケース・端数を自然文から決定論的に抽出する
 */
export function parseQuantityFromNaturalText(
  text: string,
  defaultPacks: number = 20,
): {
  totalPacks: number | null
  cases: number | null
  packsPerCase: number
  isCaseInput: boolean
  quantityRaw: string | null
} {
  const s = text.trim()

  // 1. "10c+5P" や "10ケース+5パック"
  const comboMatch = s.match(/(\d+)\s*(?:c|ケース|箱)\s*\+\s*(\d+)\s*(?:p|パック|袋|本)?/i)
  if (comboMatch && comboMatch[1] && comboMatch[2]) {
    const c = parseInt(comboMatch[1], 10)
    const rem = parseInt(comboMatch[2], 10)
    const tot = c * defaultPacks + rem
    return {
      totalPacks: tot,
      cases: c,
      packsPerCase: defaultPacks,
      isCaseInput: true,
      quantityRaw: `${c}c+${rem}P`,
    }
  }

  // 2. "10ケース", "10c", "10箱"
  const caseMatch = s.match(/(\d+)\s*(?:c|ケース|箱)/i)
  if (caseMatch && caseMatch[1]) {
    const c = parseInt(caseMatch[1], 10)
    const tot = c * defaultPacks
    return {
      totalPacks: tot,
      cases: c,
      packsPerCase: defaultPacks,
      isCaseInput: true,
      quantityRaw: `${c}c`,
    }
  }

  // 3. "200パック", "200P", "200袋", "200本"
  const packMatch = s.match(/(\d+)\s*(?:p|パック|袋|本)/i)
  if (packMatch && packMatch[1]) {
    const tot = parseInt(packMatch[1], 10)
    const c = Math.floor(tot / defaultPacks)
    return {
      totalPacks: tot,
      cases: c,
      packsPerCase: defaultPacks,
      isCaseInput: false,
      quantityRaw: String(tot),
    }
  }

  // 4. 単独数値 (文脈がケースかパックか)
  const numMatch = s.match(/(?:^|[^\d])(\d+)(?:$|[^\d])/i)
  if (numMatch && numMatch[1]) {
    const n = parseInt(numMatch[1], 10)
    // 50以下は通常ケース数指定の現場慣行
    if (n <= 50) {
      return {
        totalPacks: n * defaultPacks,
        cases: n,
        packsPerCase: defaultPacks,
        isCaseInput: true,
        quantityRaw: `${n}c`,
      }
    }
    return {
      totalPacks: n,
      cases: Math.floor(n / defaultPacks),
      packsPerCase: defaultPacks,
      isCaseInput: false,
      quantityRaw: String(n),
    }
  }

  return {
    totalPacks: null,
    cases: null,
    packsPerCase: defaultPacks,
    isCaseInput: false,
    quantityRaw: null,
  }
}

/**
 * 自然文やExcelプレーンテキストから決定論的に注文オブジェクトを構築する（Gemini障害時の完全フォールバック）
 */
export function parseNaturalOrderTextDeterministic(
  text: string,
  context: {
    customers: CustomerLike[]
    destinations: DestinationLike[]
    products: ProductLike[]
  },
): OrdersResult {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !/^#|^\/\//.test(l))

  const today = jstTodayStr()
  const defaultDate = shiftDateStr(today, 1)

  const parsedOrders: ParsedOrder[] = []

  // 行ごとに解析
  for (const line of lines) {
    // 1. 日付
    const dateInfo = parseRelativeDateFromText(line, today)
    const deliveryDate = dateInfo.deliveryDate || defaultDate

    // 2. 取引先
    const cust = findBestMatchingCustomer(line, context.customers)
    const custName = cust?.name || null

    // 3. 納入先
    const dest = findBestMatchingDestination(line, context.destinations, cust?.id ?? null)
    const destName = dest?.full_name || dest?.code || null

    // 4. 品目
    let matchedProd = context.products.find((p) => line.includes(p.name))
    if (!matchedProd) {
      if (/小松菜/.test(line)) matchedProd = context.products.find((p) => p.name.includes('小松菜'))
      else if (/トマト/.test(line)) matchedProd = context.products.find((p) => p.name.includes('トマト'))
      else if (/ネギ|ねぎ/.test(line)) matchedProd = context.products.find((p) => p.name.includes('ネギ') || p.name.includes('ねぎ'))
      else matchedProd = context.products.find((p) => p.name.includes('青梗菜') || p.name.includes('チンゲン')) ?? context.products[0]
    }

    // 5. 数量
    const defaultPacks = 20
    const qtyInfo = parseQuantityFromNaturalText(line, defaultPacks)
    if (!qtyInfo.quantityRaw && !qtyInfo.totalPacks) continue

    const qtyStr = qtyInfo.quantityRaw || String(qtyInfo.totalPacks ?? 0)

    const item: ParsedItem = {
      raw_name: matchedProd?.name || '青梗菜',
      product_name: matchedProd?.name || '青梗菜',
      quantity: qtyStr,
      unit: matchedProd?.unit || 'P',
      confidence: 1.0,
      spec: matchedProd?.name?.includes('小松菜') ? '200g (入数20)' : '2〜3株 (入数20)',
      packs_per_case: qtyInfo.packsPerCase,
    }

    // 同一顧客・納入先・日付で集約
    const existingOrder = parsedOrders.find(
      (o) =>
        o.customer_name === custName &&
        o.destination_name === destName &&
        o.delivery_date === deliveryDate,
    )

    if (existingOrder) {
      existingOrder.items.push(item)
    } else {
      parsedOrders.push({
        customer_name: custName,
        destination_name: destName,
        delivery_date: deliveryDate,
        items: [item],
      })
    }
  }

  // 1行もヒットしなかった場合のフェイルセーフ
  if (parsedOrders.length === 0 && text.trim()) {
    const cust = findBestMatchingCustomer(text, context.customers)
    const dest = findBestMatchingDestination(text, context.destinations, cust?.id ?? null)
    const prod = context.products[0]
    const dateInfo = parseRelativeDateFromText(text, today)
    const qtyInfo = parseQuantityFromNaturalText(text, 20)

    if (qtyInfo.quantityRaw) {
      parsedOrders.push({
        customer_name: cust?.name ?? null,
        destination_name: dest?.full_name ?? null,
        delivery_date: dateInfo.deliveryDate ?? defaultDate,
        items: [
          {
            raw_name: prod?.name || '青梗菜',
            product_name: prod?.name || '青梗菜',
            quantity: qtyInfo.quantityRaw,
            unit: prod?.unit || 'P',
            confidence: 0.8,
            packs_per_case: qtyInfo.packsPerCase,
          },
        ],
      })
    }
  }

  return {
    is_order: parsedOrders.length > 0,
    orders: parsedOrders,
  }
}
