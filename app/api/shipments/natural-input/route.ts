import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { getAuthedUser } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSetting } from '@/lib/settings'
import { DEFAULT_MAIN_GEMINI_MODEL } from '@/lib/gemini/models'
import { jstTodayStr, shiftDateStr } from '@/lib/dates'
import { determineUnitCount } from '@/lib/pipeline/schemas'
import {
  findBestMatchingCustomer,
  findBestMatchingDestination,
  parseQuantityFromNaturalText,
  parseRelativeDateFromText,
} from '@/lib/orders/natural-parser'

export const runtime = 'nodejs'
export const maxDuration = 30

interface UncertainItem {
  field: 'delivery_date' | 'customer' | 'destination' | 'product' | 'quantity' | 'action'
  question: string
  suggestions: string[]
}

interface NaturalParseResult {
  action: 'create' | 'increase' | 'decrease' | 'set'
  customer_id: string | null
  customer_name: string | null
  destination_id: string | null
  destination_name: string | null
  product_id: string | null
  product_name: string | null
  quantity_number: number | null
  cases: number | null
  packs_per_case?: number | null
  unit: string
  delivery_date: string | null
  date_expression: string | null
  explanation: string
  uncertain_items: UncertainItem[]
  existing_shipment?: {
    order_id: string
    current_quantity: number
    product_name: string
    delivery_date: string
  } | null
}

function extractJson<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const raw = fenced ? fenced[1]! : text
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end === -1) throw new Error('AIの応答からJSONを抽出できませんでした')
  return JSON.parse(raw.slice(start, end + 1)) as T
}

/**
 * Gemini API が未設定または過負荷（503等）のときでも即座に自然言語入力を構造化する決定論的ローカルパーサー。
 */
function buildDeterministicNaturalResult(
  text: string,
  referenceDate: string,
  customers: { id: string; name: string }[],
  destinations: { id: string; customer_id: string; code?: string | null; full_name: string; aliases?: string[] | null }[],
  products: { id: string; name: string; unit: string }[],
): NaturalParseResult {
  const s = text.normalize('NFKC')

  // 1. アクション判定
  let action: NaturalParseResult['action'] = 'create'
  if (/増や|追加|プラス|\+|増量/.test(s)) action = 'increase'
  else if (/減ら|マイナス|-|削減|減量|キャンセル/.test(s)) action = 'decrease'
  else if (/変更|上書き|にする|確定/.test(s)) action = 'set'

  // 2. 日付判定
  const dateInfo = parseRelativeDateFromText(s, referenceDate)
  const isAmbiguousPeriod = /今週|ここ1週間|来週/.test(s) && !dateInfo.deliveryDate
  const deliveryDate = isAmbiguousPeriod ? null : dateInfo.deliveryDate

  // 3. 取引先判定
  let matchedCust = findBestMatchingCustomer(s, customers)
  let rawCustName: string | null = matchedCust?.name ?? null
  if (!matchedCust) {
    for (const c of customers) {
      const hit = findBestMatchingCustomer(c.name, [{ id: c.id, name: s }])
      if (hit) {
        matchedCust = c
        rawCustName = c.name
        break
      }
    }
  }
  if (!matchedCust) {
    if (/勘兵衛/.test(s)) rawCustName = '株式会社勘兵衛'
    else if (/和郷園/.test(s)) rawCustName = '農事組合法人 和郷園'
    else if (/房総食料/.test(s)) rawCustName = '農事組合法人 房総食料センター'
    else if (/農業総合研究所|農総研|NSK/i.test(s)) rawCustName = '株式会社農業総合研究所（NSK）'
    else if (/寺崎/.test(s)) rawCustName = '寺崎'
    else if (/ヨーク/.test(s)) rawCustName = 'ヨーク'
    if (rawCustName) matchedCust = findBestMatchingCustomer(rawCustName, customers)
  }

  // 4. 納入先判定
  const matchedDest = findBestMatchingDestination(s, destinations, matchedCust?.id ?? null)

  // 5. 品目判定
  let matchedProd = products.find((p) => s.includes(p.name))
  if (!matchedProd) {
    if (/小松菜/.test(s)) matchedProd = products.find((p) => p.name.includes('小松菜'))
    else if (/トマト/.test(s)) matchedProd = products.find((p) => p.name.includes('トマト'))
    else if (/ネギ|ねぎ/.test(s)) matchedProd = products.find((p) => p.name.includes('ネギ') || p.name.includes('ねぎ'))
    else matchedProd = products.find((p) => p.name.includes('青梗菜') || p.name.includes('チンゲン')) ?? products[0]
  }

  // 6. 数量・ケース判定
  const defaultPacks = determineUnitCount(matchedCust?.name ?? rawCustName, matchedDest?.full_name ?? s, undefined, matchedProd?.name)
  const qtyInfo = parseQuantityFromNaturalText(s, defaultPacks)

  const uncertainItems: UncertainItem[] = []
  const today = jstTodayStr()
  const tomorrow = shiftDateStr(today, 1)
  const dayAfter = shiftDateStr(today, 2)

  if (!deliveryDate) {
    uncertainItems.push({
      field: 'delivery_date',
      question: 'いつの納品（出荷日）に対する指示ですか？',
      suggestions: [`明日 (${tomorrow})`, `今日 (${today})`, `明後日 (${dayAfter})`],
    })
  }
  if (!matchedCust) {
    uncertainItems.push({
      field: 'customer',
      question: '対象の取引先を選択してください',
      suggestions: customers.slice(0, 4).map((c) => c.name),
    })
  }

  return {
    action,
    customer_id: matchedCust?.id ?? null,
    customer_name: matchedCust?.name ?? rawCustName,
    destination_id: matchedDest?.id ?? null,
    destination_name: matchedDest?.full_name ?? null,
    product_id: matchedProd?.id ?? null,
    product_name: matchedProd?.name ?? '青梗菜',
    quantity_number: qtyInfo.totalPacks,
    cases: qtyInfo.isCaseInput ? qtyInfo.cases : null,
    packs_per_case: qtyInfo.packsPerCase,
    unit: matchedProd?.unit ?? 'P',
    delivery_date: deliveryDate,
    date_expression: dateInfo.dateExpression,
    explanation: `入力文から${matchedCust?.name ?? rawCustName ?? '取引先'}の${matchedProd?.name ?? '青梗菜'}${qtyInfo.totalPacks ? `（総数${qtyInfo.totalPacks}P）` : ''}を解析しました。`,
    uncertain_items: uncertainItems,
  }
}

export async function POST(req: NextRequest) {
  const user = await getAuthedUser()
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const text = typeof body.text === 'string' ? body.text.trim() : ''
  const referenceDate =
    typeof body.referenceDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.referenceDate)
      ? body.referenceDate
      : jstTodayStr()

  if (!text) {
    return NextResponse.json({ error: 'テキストを入力してください' }, { status: 400 })
  }

  const admin = createAdminClient()

  // 1. マスタ情報を取得（取引先・納入先・品目）
  const [custRes, destRes, prodRes] = await Promise.all([
    admin.from('customers').select('id, name').eq('is_active', true),
    admin.from('delivery_destinations').select('id, customer_id, code, full_name, aliases').eq('is_active', true),
    admin.from('products').select('id, name, unit').eq('is_active', true),
  ])

  const customers = custRes.data || []
  const destinations = destRes.data || []
  const products = prodRes.data || []

  // 2. Gemini API クライアント初期化（未設定・エラー時は決定論的パーサーに自動フォールバック）
  const apiKey = await getSetting('GEMINI_API_KEY')
  let parsed: NaturalParseResult

  if (!apiKey) {
    parsed = buildDeterministicNaturalResult(text, referenceDate, customers, destinations, products)
  } else {
    const genAI = new GoogleGenerativeAI(apiKey)
    const modelName = (await getSetting('GEMINI_MODEL')) || DEFAULT_MAIN_GEMINI_MODEL

    const custListStr = customers.map((c) => `- ID:${c.id} 名称:${c.name}`).join('\n')
    const prodListStr = products.map((p) => `- ID:${p.id} 名称:${p.name} (単位:${p.unit})`).join('\n')
    const destListStr = destinations.map((d) => `- ID:${d.id} 取引先ID:${d.customer_id} 納入先:${d.full_name}`).join('\n')

    const prompt = `あなたは「小島農園」の受発注・出荷指示アシスタントです。
ユーザーの発言（自然言語入力）を解析し、出荷の登録・変更意図をJSON形式で構造化してください。

【基準日(今日)】: ${referenceDate}

【登録済み取引先マスタ】:
${custListStr}

【登録済み納入先マスタ】:
${destListStr}

【登録済み品目マスタ】:
${prodListStr}

【解析ルール】:
1. 意図(action):
   - 'increase': 「増やした」「+100」「追加」「増量」など既存または新規の加算
   - 'decrease': 「減らした」「-50」「キャンセル」「削減」など減量
   - 'set': 「〜にする」「〜に変更」「確定」など数量上書き
   - 'create': 新規の注文作成（通常）
2. 取引先名・品目名:
   - 「A社」「パル」などの略称や通称は、マスタから最も可能性の高いものを推測してマッピングしてください。
   - 品目が省略されている場合は小島農園の主力品目「青梗菜」（チンゲン菜）を既定候補とします。
3. 数量・単位:
   - 「1000パック」「1000P」→ quantity_number: 1000, unit: "P"
   - 「20箱」「20ケース」「20c」→ cases: 20, unit: "ケース"
4. 日付(delivery_date):
   - 明確な日付（例: 「明日」「10/24」「来週月曜」）は基準日 ${referenceDate} を元に YYYY-MM-DD を算出してセットしてください。
   - 曖昧な期間（例: 「ここ1週間で」「今週」）は delivery_date は null とし、date_expression にその文字列を残してください。
5. 不明点・確認事項(uncertain_items):
   - 曖昧または不足している重要情報（日付、納入先、品目、増量対象など）があれば、ユーザーに問いかける質問(question)と、ワンタップで選べる具体的な候補選択肢(suggestions)をリスト化してください。

【出力JSONスキーマ】:
{
  "action": "create" | "increase" | "decrease" | "set",
  "customer_id": string | null,
  "customer_name": string | null,
  "destination_id": string | null,
  "destination_name": string | null,
  "product_id": string | null,
  "product_name": string | null,
  "quantity_number": number | null,
  "cases": number | null,
  "unit": string,
  "delivery_date": string | null,
  "date_expression": string | null,
  "explanation": string,
  "uncertain_items": [
    {
      "field": "delivery_date" | "customer" | "destination" | "product" | "quantity",
      "question": string,
      "suggestions": string[]
    }
  ]
}

ユーザーの入力:
"${text}"
`

    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: {
          temperature: 0.1,
          responseMimeType: 'application/json',
        },
      })

      const res = await model.generateContent(prompt)
      const rawText = res.response.text()
      parsed = extractJson<NaturalParseResult>(rawText)
    } catch (err) {
      console.warn('[natural-input] Geminiエラーのため決定論的パーサーへフォールバック:', err)
      parsed = buildDeterministicNaturalResult(text, referenceDate, customers, destinations, products)
    }
  }

  // 顧客ID・納入先ID・品目IDの確実な名寄せ補正（normalizeOrgName / foldKana 使用）
  if (parsed.customer_name && !parsed.customer_id) {
    const hit = findBestMatchingCustomer(parsed.customer_name, customers)
    if (hit) {
      parsed.customer_id = hit.id
      parsed.customer_name = hit.name
    }
  }
  if (parsed.destination_name && !parsed.destination_id) {
    const hit = findBestMatchingDestination(parsed.destination_name, destinations, parsed.customer_id)
    if (hit) {
      parsed.destination_id = hit.id
      parsed.destination_name = hit.full_name
    }
  }
  if (parsed.product_name && !parsed.product_id) {
    const hit = products.find(
      (p) =>
        p.name.includes(parsed.product_name!) ||
        parsed.product_name!.includes(p.name) ||
        (parsed.product_name!.includes('チンゲン') && p.name.includes('青梗菜')) ||
        (parsed.product_name!.includes('青梗菜') && p.name.includes('チンゲン')),
    )
    if (hit) {
      parsed.product_id = hit.id
      parsed.product_name = hit.name
    }
  }
  if (!parsed.product_id && products.length > 0) {
    const defaultProd = products.find((p) => p.name.includes('青梗菜') || p.name.includes('チンゲン')) ?? products[0]!
    parsed.product_id = defaultProd.id
    parsed.product_name = defaultProd.name
  }

  // 入数・総パック数の補完
  const unitCount = determineUnitCount(parsed.customer_name, parsed.destination_name, parsed.packs_per_case, parsed.product_name)
  parsed.packs_per_case = unitCount
  if (parsed.cases != null && parsed.cases > 0 && (!parsed.quantity_number || parsed.quantity_number <= 0)) {
    parsed.quantity_number = parsed.cases * unitCount
  }

  // 既存注文の差分確認（もし顧客と日付と品目が特定できた場合、既存出荷を取得）
  let existingShipment: NaturalParseResult['existing_shipment'] = null
  const targetDate = parsed.delivery_date || referenceDate
  if (parsed.customer_id && targetDate) {
    let existQuery = admin
      .from('orders')
      .select(`
        id,
        delivery_date,
        order_items (
          id,
          product_id,
          product_name,
          quantity
        )
      `)
      .eq('customer_id', parsed.customer_id)
      .eq('delivery_date', targetDate)
      .neq('status', 'cancelled')

    if (parsed.destination_id) {
      existQuery = existQuery.eq('destination_id', parsed.destination_id)
    }
    const { data: existOrders } = await existQuery.limit(1)

    const ord = existOrders?.[0]
    if (ord) {
      type RawItem = { id: string; product_id: string | null; product_name: string; quantity: number }
      const items = (ord.order_items || []) as unknown as RawItem[]
      const matchingItems = items.filter(
        (i) =>
          (parsed.product_id && i.product_id === parsed.product_id) ||
          i.product_name.includes('チンゲン') ||
          i.product_name.includes('青梗菜'),
      )
      if (matchingItems.length > 0) {
        const totalQty = matchingItems.reduce((acc, cur) => acc + (Number(cur.quantity) || 0), 0)
        existingShipment = {
          order_id: ord.id,
          delivery_date: ord.delivery_date ?? targetDate,
          product_name: matchingItems[0]!.product_name,
          current_quantity: totalQty,
        }
      }
    }
  }

  parsed.existing_shipment = existingShipment

  return NextResponse.json({ ok: true, data: parsed })
}
