import { jstTodayStr, shiftDateStr } from '@/lib/dates'
import { foldKana } from '@/lib/normalize/kana'
import { normalizeOrgName } from '@/lib/normalize/org-name'
import {
  calculateContainerBoxes,
  determineHasCard,
  determineUnitCount,
  formatQuantityCaseText,
  generateOrderKey,
  isSampleOrderText,
  normalizeItemName,
  resolveContainerType,
} from '@/lib/pipeline/schemas'
import type { ParsedItem, ParsedOrder, OrdersResult } from '@/lib/gemini/analyze'

export interface MasterCustomer {
  id: string
  name: string
  aliases?: string[]
}

export interface MasterDestination {
  id: string
  customer_id: string
  code?: string | null
  full_name: string
  aliases?: string[] | null
}

export interface MasterProduct {
  id: string
  name: string
  unit?: string
  aliases?: string[] | null
}

/**
 * 取引先名の表記ゆれ・法人格・空白・括弧内略称（NSK等）を吸収して比較用のキーを作る。
 */
export function normalizeCustomerMatchKey(raw?: string | null): string {
  if (!raw) return ''
  return foldKana(normalizeOrgName(raw))
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/[\s　・]/g, '')
    .toLowerCase()
}

/**
 * 取引先名テキストから customers マスタの最良一致を検索する。
 * 括弧内の別名（例: ランドローム（やなぎさわファーム））や aliases 配列もすべて照合する。
 */
export function findBestMatchingCustomer<T extends { id: string; name: string; aliases?: string[] | null }>(
  rawName: string | null | undefined,
  customers: T[],
): T | undefined {
  if (!rawName || !rawName.trim()) return undefined
  const trimmed = rawName.trim()
  if (/^(?:アイプラス|小島農園)$/.test(trimmed.replace(/[\s　株式会社有限会社農事組合法人]/g, ''))) {
    return undefined
  }

  const normFull = (s: string) =>
    foldKana(normalizeOrgName(s))
      .replace(/[\s　・()（）]/g, '')
      .toLowerCase()

  const extractCandidateKeys = (c: T): string[] => {
    const keys = new Set<string>()
    const full = normFull(c.name)
    if (full) keys.add(full)
    const base = normalizeCustomerMatchKey(c.name)
    if (base) keys.add(base)
    const parenMatches = c.name.matchAll(/[（(]([^）)]+)[）)]/g)
    for (const m of parenMatches) {
      const pk = normFull(m[1] ?? '')
      if (pk.length >= 2) keys.add(pk)
    }
    for (const al of c.aliases ?? []) {
      const ak = normFull(al)
      if (ak.length >= 2) keys.add(ak)
      const ab = normalizeCustomerMatchKey(al)
      if (ab.length >= 2) keys.add(ab)
    }
    return Array.from(keys)
  }

  const rawFull = normFull(trimmed)
  const rawBase = normalizeCustomerMatchKey(trimmed)
  if (!rawFull && !rawBase) return undefined

  // 1. 正規化名・別名の完全一致
  const exact = customers.find((c) => {
    const keys = extractCandidateKeys(c)
    return keys.some((k) => (rawFull && k === rawFull) || (rawBase && k === rawBase))
  })
  if (exact) return exact

  // 2. NSK / やなぎさわ / オレンジファーム 等の既知別名対応
  if (trimmed.toUpperCase().includes('NSK') || trimmed.includes('農業総合研究所') || trimmed.includes('農総研')) {
    const nsk = customers.find(
      (c) => c.name.includes('農業総合研究所') || c.name.toUpperCase().includes('NSK'),
    )
    if (nsk) return nsk
  }
  if (/やなぎさわ|ヤナギサワ|柳沢|ランドローム/.test(trimmed)) {
    const yanagisawa = customers.find(
      (c) => /やなぎさわ|ヤナギサワ|ランドローム/.test(c.name),
    )
    if (yanagisawa) return yanagisawa
  }
  if (/オレンジファーム/.test(trimmed)) {
    const orange = customers.find((c) => c.name.includes('オレンジファーム'))
    if (orange) return orange
  }

  // 3. 部分一致（2文字以上）
  return customers.find((c) => {
    const keys = extractCandidateKeys(c)
    return keys.some((k) => {
      if (k.length < 2) return false
      if (rawBase.length >= 2 && (k.includes(rawBase) || rawBase.includes(k))) return true
      if (rawFull.length >= 2 && (k.includes(rawFull) || rawFull.includes(k))) return true
      return false
    })
  })
}

/**
 * 納入先名テキストから delivery_destinations マスタの最良一致を検索する。
 */
export function findBestMatchingDestination<
  T extends { id: string; customer_id?: string; code?: string | null; full_name: string; aliases?: string[] | null },
>(rawDest: string | null | undefined, destinations: T[], customerId?: string | null): T | undefined {
  if (!rawDest || !rawDest.trim()) return undefined
  const pool = customerId ? destinations.filter((d) => !d.customer_id || d.customer_id === customerId) : destinations
  if (pool.length === 0) return undefined

  const norm = (s: string) =>
    foldKana(s.normalize('NFKC'))
      .replace(/[\s　()（）・]/g, '')
      .toLowerCase()

  const target = norm(rawDest)
  if (!target) return undefined

  // 1. 完全一致
  const exact = pool.find((d) => {
    const cands = [d.code, d.full_name, ...(d.aliases ?? [])].filter((x): x is string => Boolean(x)).map(norm)
    return cands.some((c) => c === target)
  })
  if (exact) return exact

  // 2. 部分一致（短い別名の誤吸収を防ぐため 2文字以上）
  const partials = pool.filter((d) => {
    const cands = [d.code, d.full_name, ...(d.aliases ?? [])].filter((x): x is string => Boolean(x)).map(norm)
    return cands.some((c) => c.includes(target) || (c.length >= 2 && target.includes(c)))
  })

  if (partials.length >= 1) {
    const wantsSample = target.includes('サンプル')
    const wantsRadish = /らでぃっしゅ|ラディッシュ|radish/i.test(rawDest)
    const filtered = partials.filter((d) => {
      const dText = `${d.code ?? ''} ${d.full_name}`
      const isDestRadish = /らでぃっしゅ|ラディッシュ|radish/i.test(dText)
      if (wantsRadish !== isDestRadish) return false
      return true
    })
    const poolToUse = filtered.length > 0 ? filtered : partials
    if (poolToUse.length === 1) return poolToUse[0]
    const sampleFiltered = poolToUse.find((d) => {
      const hasSample = `${d.code ?? ''} ${d.full_name}`.includes('サンプル')
      return wantsSample ? hasSample : !hasSample
    })
    return sampleFiltered ?? poolToUse[0]
  }
  return undefined
}

/**
 * テキスト内の日付表現（「今日」「明日」「明後日」「11/2」「2026-11-02」等）を解決する。
 */
export function parseRelativeDateFromText(
  text: string,
  referenceDate: string = jstTodayStr(),
): { deliveryDate: string | null; dateExpression: string | null } {
  const s = text.normalize('NFKC')

  // 1. YYYY-MM-DD または YYYY/MM/DD
  const isoMatch = s.match(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/)
  if (isoMatch) {
    const yyyy = isoMatch[1]!
    const mm = isoMatch[2]!.padStart(2, '0')
    const dd = isoMatch[3]!.padStart(2, '0')
    return { deliveryDate: `${yyyy}-${mm}-${dd}`, dateExpression: isoMatch[0] }
  }

  // 2. 明後日 / あさって
  if (/明後日|あさって/.test(s)) {
    return { deliveryDate: shiftDateStr(referenceDate, 2), dateExpression: '明後日' }
  }

  // 3. 明日 / あした / 翌日
  if (/明日|あした|翌日/.test(s)) {
    return { deliveryDate: shiftDateStr(referenceDate, 1), dateExpression: '明日' }
  }

  // 4. 今日 / 本日 / 当日
  if (/今日|本日|当日/.test(s)) {
    return { deliveryDate: referenceDate, dateExpression: '今日' }
  }

  // 5. MM/DD または M月D日（数値表現と区別するため前後にケース/パックが無いもの）
  const mdJapanese = s.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日/)
  if (mdJapanese) {
    const year = referenceDate.slice(0, 4)
    const mm = mdJapanese[1]!.padStart(2, '0')
    const dd = mdJapanese[2]!.padStart(2, '0')
    return { deliveryDate: `${year}-${mm}-${dd}`, dateExpression: mdJapanese[0] }
  }

  const mdSlash = s.match(/(?:^|[\s　])(\d{1,2})\/(\d{1,2})(?=[\s　]|$)/)
  if (mdSlash) {
    const mNum = Number(mdSlash[1])
    const dNum = Number(mdSlash[2])
    if (mNum >= 1 && mNum <= 12 && dNum >= 1 && dNum <= 31) {
      const year = referenceDate.slice(0, 4)
      const mm = String(mNum).padStart(2, '0')
      const dd = String(dNum).padStart(2, '0')
      return { deliveryDate: `${year}-${mm}-${dd}`, dateExpression: `${mNum}/${dNum}` }
    }
  }

  return { deliveryDate: null, dateExpression: null }
}

/**
 * 1行の注文テキストから数量・ケース数・入数を決定論的に抽出する。
 */
export function parseQuantityFromNaturalText(
  text: string,
  defaultPacksPerCase = 20,
): {
  totalPacks: number | null
  cases: number | null
  remainderPacks: number
  packsPerCase: number
  rawQuantityText: string
  isCaseInput: boolean
} {
  const s = text.normalize('NFKC')

  // 入数の明示指定（例: "入数24", "24入", "(15-0)" 等）
  let packsPerCase = defaultPacksPerCase
  const explicitUnitMatch = s.match(/(?:入数|1箱|1ケース)\s*[:：]?\s*(\d+)|(\d+)\s*入(?:り)?/)
  if (explicitUnitMatch) {
    const u = Number(explicitUnitMatch[1] || explicitUnitMatch[2])
    if (u > 0 && u <= 200) packsPerCase = u
  }

  // 1. 和郷園スタイル: "300+0 (15-0)" or "300+20"
  const wagoenMatch = s.match(/(\d+)\s*\+\s*(\d+)(?:\s*\(\s*(\d+)\s*-\s*(\d+)\s*\))?/)
  if (wagoenMatch) {
    const baseP = Number(wagoenMatch[1])
    const extraP = Number(wagoenMatch[2])
    const total = baseP + extraP
    const c = wagoenMatch[3] != null ? Number(wagoenMatch[3]) : Math.floor(total / packsPerCase)
    const r = wagoenMatch[4] != null ? Number(wagoenMatch[4]) : total % packsPerCase
    return {
      totalPacks: total,
      cases: c,
      remainderPacks: r,
      packsPerCase,
      rawQuantityText: wagoenMatch[0],
      isCaseInput: false,
    }
  }

  // 2. c記法: "15c2" / "20c"
  const cNotationMatch = s.match(/(?:^|[\s　+＋-])(\d+)\s*c\s*(\d*)(?=[\s　追加増減]|$)/i)
  if (cNotationMatch) {
    const cases = Number(cNotationMatch[1])
    const rem = cNotationMatch[2] ? Number(cNotationMatch[2]) : 0
    const total = cases * packsPerCase + rem
    return {
      totalPacks: total,
      cases,
      remainderPacks: rem,
      packsPerCase,
      rawQuantityText: `${cases}c${rem > 0 ? rem : ''}`,
      isCaseInput: true,
    }
  }

  // 3. ケース・箱表記: "5ケース" / "5箱" / "5C/S" / "5cs"
  const caseWordMatch = s.match(/(\d+(?:\.\d+)?)\s*(?:ケース|箱|c\/s|cs)/i)
  if (caseWordMatch) {
    const cases = Math.floor(Number(caseWordMatch[1]))
    const remMatch = s.match(/(?:端数|バラ|\+|＋)\s*(\d+)\s*(?:パック|P|点|袋)?/i)
    const rem = remMatch ? Number(remMatch[1]) : 0
    const total = cases * packsPerCase + rem
    return {
      totalPacks: total,
      cases,
      remainderPacks: rem,
      packsPerCase,
      rawQuantityText: String(total),
      isCaseInput: true,
    }
  }

  // 4. パック・P・点・袋・束・玉 表記: "84パック" / "1000パック" / "50P" / "96点"
  const packWordMatch = s.match(/(\d+)\s*(?:パック|P|p|点|袋|束|玉|個|本)(?![a-zA-Z])/)
  if (packWordMatch) {
    const total = Number(packWordMatch[1])
    const cases = Math.floor(total / packsPerCase)
    const rem = total % packsPerCase
    return {
      totalPacks: total,
      cases,
      remainderPacks: rem,
      packsPerCase,
      rawQuantityText: String(total),
      isCaseInput: false,
    }
  }

  // 5. 末尾または単独の数値（日付や入数を除いた数値）
  const cleaned = s
    .replace(/\b20\d{2}[-/]\d{1,2}[-/]\d{1,2}\b/g, ' ')
    .replace(/\d{1,2}\s*月\s*\d{1,2}\s*日/g, ' ')
    .replace(/(?:入数|1箱|1ケース)\s*[:：]?\s*\d+/g, ' ')
    .replace(/\d+\s*入(?:り)?/g, ' ')
    .replace(/\d+\s*g/gi, ' ')
  const numMatches = [...cleaned.matchAll(/(?:^|[\s　,、])(\d{1,5})(?=[\s　,、]|$)/g)]
  if (numMatches.length > 0) {
    const lastMatch = numMatches[numMatches.length - 1]!
    const n = Number(lastMatch[1])
    if (n > 0) {
      const cases = Math.floor(n / packsPerCase)
      const rem = n % packsPerCase
      return {
        totalPacks: n,
        cases,
        remainderPacks: rem,
        packsPerCase,
        rawQuantityText: String(n),
        isCaseInput: false,
      }
    }
  }

  return {
    totalPacks: null,
    cases: null,
    remainderPacks: 0,
    packsPerCase,
    rawQuantityText: '',
    isCaseInput: false,
  }
}

/**
 * 自然言語テキスト（1行または複数行）から OrdersResult 互換の注文構造を決定論的に生成する。
 * Gemini API キー未設定時や 503 過負荷時のフォールバック、およびテキスト解析の補完に使用する。
 */
export function parseNaturalOrderTextDeterministic(
  rawText: string,
  masters?: {
    customers?: MasterCustomer[]
    destinations?: MasterDestination[]
    products?: MasterProduct[]
  },
  referenceDate: string = jstTodayStr(),
): OrdersResult {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#') && !l.startsWith('//'))

  if (lines.length === 0) {
    return {
      is_order: false,
      skip_reason: 'テキストが空です',
      orders: [],
      used_model: 'deterministic-local-parser',
      applied_rules_count: 5,
    }
  }

  const customers = masters?.customers ?? []
  const destinations = masters?.destinations ?? []
  const products = masters?.products ?? []

  // 全体から共通の日付・取引先を抽出（複数行で1注文の場合に引き継ぐ）
  const globalDate = parseRelativeDateFromText(rawText, referenceDate).deliveryDate
  let globalCustomer: string | null = null
  for (const c of customers) {
    const key = normalizeCustomerMatchKey(c.name)
    if (key && foldKana(rawText.normalize('NFKC')).toLowerCase().includes(key)) {
      globalCustomer = c.name
      break
    }
  }
  if (!globalCustomer) {
    if (/勘兵衛/.test(rawText)) globalCustomer = '株式会社勘兵衛'
    else if (/和郷園/.test(rawText)) globalCustomer = '農事組合法人 和郷園'
    else if (/房総食料/.test(rawText)) globalCustomer = '農事組合法人 房総食料センター'
    else if (/農業総合研究所|農総研|NSK/i.test(rawText)) globalCustomer = '株式会社農業総合研究所（NSK）'
    else if (/ヨーク/.test(rawText)) globalCustomer = 'ヨーク'
    else if (/寺崎/.test(rawText)) globalCustomer = '寺崎'
    else if (/ランドローム|やなぎさわ/.test(rawText)) globalCustomer = 'やなぎさわファーム'
  }

  const parsedOrders: ParsedOrder[] = []

  for (const line of lines) {
    // ヘッダー行（CSVの「品名,数量,出荷先」等）はスキップ
    if (/^(?:品名|品目|取引先|顧客)[,、\t]/.test(line)) continue

    const lineDate = parseRelativeDateFromText(line, referenceDate).deliveryDate ?? globalDate ?? shiftDateStr(referenceDate, 1)

    // 取引先の検出
    let lineCustomer: string | null = null
    for (const c of customers) {
      const key = normalizeCustomerMatchKey(c.name)
      if (key && foldKana(line.normalize('NFKC')).toLowerCase().includes(key)) {
        lineCustomer = c.name
        break
      }
    }
    if (!lineCustomer) {
      if (/勘兵衛/.test(line)) lineCustomer = '株式会社勘兵衛'
      else if (/和郷園/.test(line)) lineCustomer = '農事組合法人 和郷園'
      else if (/房総食料/.test(line)) lineCustomer = '農事組合法人 房総食料センター'
      else if (/農業総合研究所|農総研|NSK/i.test(line)) lineCustomer = '株式会社農業総合研究所（NSK）'
      else if (/ヨーク/.test(line)) lineCustomer = 'ヨーク'
      else if (/寺崎/.test(line)) lineCustomer = '寺崎'
      else if (/ランドローム|やなぎさわ/.test(line)) lineCustomer = 'やなぎさわファーム'
      else {
        const companyMatch = line.match(/([^\s　,、]+(?:社|様|農園|ファーム|センター|青果|商店))/)
        if (companyMatch?.[1] && !/向け|用$/.test(companyMatch[1])) {
          lineCustomer = companyMatch[1].replace(/様$/, '')
        }
      }
    }
    const resolvedCustomer = lineCustomer ?? globalCustomer

    // 納入先の検出
    const matchedCustObj = findBestMatchingCustomer(resolvedCustomer, customers)
    const custDests = matchedCustObj
      ? destinations.filter((d) => d.customer_id === matchedCustObj.id)
      : destinations

    let resolvedDest: string | null = null
    for (const d of custDests) {
      const cands = [d.full_name, d.code, ...(d.aliases ?? [])].filter((x): x is string => Boolean(x))
      const hit = cands.find((c) => {
        const normC = foldKana(c.normalize('NFKC')).replace(/[\s　]/g, '').toLowerCase()
        const normLine = foldKana(line.normalize('NFKC')).replace(/[\s　]/g, '').toLowerCase()
        return normC.length >= 2 && normLine.includes(normC)
      })
      if (hit) {
        resolvedDest = d.full_name
        break
      }
    }
    if (!resolvedDest) {
      if (/イオンタウン|イオン/.test(line)) resolvedDest = 'イオンタウン向け'
      else if (/らでぃっしゅ|ラディッシュ/i.test(line)) resolvedDest = 'らでぃっしゅぼーや 岩槻ST'
      else if (/相模/.test(line)) resolvedDest = 'パルシステム 相模センター'
      else if (/岩槻|パルシステム/.test(line)) resolvedDest = 'パルシステム 岩槻'
      else if (/グリーンボックス|グリンBOX|ちばコープ/i.test(line)) resolvedDest = 'ちばコープ グリーンボックス(戸田)'
      else if (/ちばセット|千葉セット/.test(line)) resolvedDest = 'ちばセット用'
      else if (/BOX用|ボックス用/i.test(line)) resolvedDest = 'BOX用'
      else {
        const mukeMatch = line.match(/([^\s　,、]+(?:向け|センター|店|ST|便|運輸))/)
        if (mukeMatch?.[1]) resolvedDest = mukeMatch[1]
      }
    }

    // 品目の検出
    let resolvedProdName = 'チンゲン菜'
    let resolvedUnit = 'P'
    for (const p of products) {
      const pNorm = foldKana(p.name.normalize('NFKC')).toLowerCase()
      const lNorm = foldKana(line.normalize('NFKC')).toLowerCase()
      if (pNorm && lNorm.includes(pNorm)) {
        resolvedProdName = p.name
        resolvedUnit = p.unit || 'P'
        break
      }
    }
    if (/小松菜|こまつな/.test(line)) resolvedProdName = '小松菜'
    else if (/トマト/.test(line)) resolvedProdName = 'トマト'
    else if (/長ネギ|長ねぎ|ネギ|ねぎ/.test(line)) resolvedProdName = '長ネギ'
    else if (/白菜|はくさい/.test(line)) resolvedProdName = 'ミニ白菜'
    else if (/チンゲン|ちんげん|青梗菜/.test(line)) resolvedProdName = normalizeItemName('チンゲン菜')

    const defaultPacks = determineUnitCount(resolvedCustomer, line, undefined, resolvedProdName)
    const qtyInfo = parseQuantityFromNaturalText(line, defaultPacks)
    if (!qtyInfo.totalPacks || qtyInfo.totalPacks <= 0) continue

    const isSample = isSampleOrderText(resolvedDest, line)
    const cases = isSample && qtyInfo.totalPacks < qtyInfo.packsPerCase ? 0 : (qtyInfo.cases ?? Math.floor(qtyInfo.totalPacks / qtyInfo.packsPerCase))
    const rem = isSample && qtyInfo.totalPacks < qtyInfo.packsPerCase ? qtyInfo.totalPacks : qtyInfo.remainderPacks
    const boxCount = calculateContainerBoxes(cases, rem)
    const containerType = resolveContainerType({
      clientName: resolvedCustomer,
      destination: resolvedDest,
      rawText: line,
    })
    const quantityCaseText = isSample && cases === 0
      ? `サンプル ${qtyInfo.totalPacks}P`
      : formatQuantityCaseText(qtyInfo.totalPacks, cases, rem)

    const hasSeal = /シール\s*(?:あり|有|付)/.test(line)
      ? true
      : /シール\s*(?:なし|無|不要)/.test(line)
      ? false
      : null
    const sealText = hasSeal ? 'シールあり' : hasSeal === false ? 'シールなし' : null
    const hasCard = determineHasCard({
      clientName: resolvedCustomer,
      destination: resolvedDest,
      rawText: line,
    })
    const bagType = /FG|印字/i.test(line) || (resolvedCustomer ?? '').includes('勘兵衛')
      ? '印字袋(FG)'
      : /無地/.test(line)
      ? '無地袋'
      : null
    const spec =
      (resolvedCustomer ?? '').includes('勘兵衛')
        ? `200gFG×${qtyInfo.packsPerCase}入`
        : (resolvedCustomer ?? '').includes('農業総合研究所') || (resolvedCustomer ?? '').includes('NSK')
        ? `200gUP (入数${qtyInfo.packsPerCase})`
        : (resolvedCustomer ?? '').includes('房総食料')
        ? `200g (入数${qtyInfo.packsPerCase})`
        : `2〜3株 (入数${qtyInfo.packsPerCase})`

    const item: ParsedItem = {
      raw_name: line,
      product_name: resolvedProdName,
      quantity: String(qtyInfo.totalPacks),
      unit: resolvedUnit,
      confidence: 0.95,
      spec,
      packs_per_case: qtyInfo.packsPerCase,
      cases,
      remainder_packs: rem,
      box_count: boxCount,
      container_type: containerType,
      quantity_case_text: quantityCaseText,
      is_case_input: qtyInfo.isCaseInput,
      bag_type: bagType,
      has_seal: hasSeal,
      seal_text: sealText,
      has_card: hasCard,
      order_key: generateOrderKey({
        clientName: resolvedCustomer ?? '',
        deliveryDate: lineDate ?? '',
        destination: resolvedDest ?? '',
        itemName: resolvedProdName,
        spec,
      }),
    }

    // 同一 (customer_name, destination_name, delivery_date) の注文があればまとめる
    const existingOrder = parsedOrders.find(
      (o) =>
        o.customer_name === resolvedCustomer &&
        (o.destination_name ?? null) === (resolvedDest ?? null) &&
        o.delivery_date === lineDate,
    )
    if (existingOrder) {
      existingOrder.items.push(item)
    } else {
      parsedOrders.push({
        customer_name: resolvedCustomer,
        destination_name: resolvedDest,
        delivery_date: lineDate,
        slip_no: null,
        note: null,
        items: [item],
      })
    }
  }

  return {
    is_order: parsedOrders.length > 0,
    skip_reason: parsedOrders.length === 0 ? '数量を含む有効な注文行が見つかりませんでした' : null,
    slip_no: null,
    is_full_resending_matrix: false,
    orders: parsedOrders,
    used_model: 'deterministic-local-parser',
    applied_rules_count: 5,
  }
}
