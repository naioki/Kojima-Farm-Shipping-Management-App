import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { getAuthedUser } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSetting } from '@/lib/settings'
import { DEFAULT_MAIN_GEMINI_MODEL } from '@/lib/gemini/models'

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

export async function POST(req: NextRequest) {
  const user = await getAuthedUser()
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const text = typeof body.text === 'string' ? body.text.trim() : ''
  const referenceDate = typeof body.referenceDate === 'string' && body.referenceDate ? body.referenceDate : new Date().toISOString().split('T')[0]!

  if (!text) {
    return NextResponse.json({ error: 'テキストを入力してください' }, { status: 400 })
  }

  const admin = createAdminClient()

  // 1. マスタ情報を取得（取引先・納入先・品目）
  const [custRes, destRes, prodRes] = await Promise.all([
    admin.from('customers').select('id, name').eq('is_active', true),
    admin.from('delivery_destinations').select('id, customer_id, full_name').eq('is_active', true),
    admin.from('products').select('id, name, unit').eq('is_active', true),
  ])

  const customers = custRes.data || []
  const destinations = destRes.data || []
  const products = prodRes.data || []

  // 2. Gemini API クライアント初期化
  const apiKey = await getSetting('GEMINI_API_KEY')
  if (!apiKey) {
    return NextResponse.json({ error: 'GEMINI_API_KEY が未設定です' }, { status: 500 })
  }

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
   - 品目が省略されている場合は小島農園の主力品目「チンゲン菜」（青梗菜）を既定候補とします。
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
    const parsed = JSON.parse(rawText) as NaturalParseResult

    // 顧客ID・品目IDの確実な名寄せ補正
    if (parsed.customer_name && !parsed.customer_id) {
      const hit = customers.find((c) => c.name.includes(parsed.customer_name!) || parsed.customer_name!.includes(c.name))
      if (hit) parsed.customer_id = hit.id
    }
    if (parsed.product_name && !parsed.product_id) {
      const hit = products.find(
        (p) =>
          p.name.includes(parsed.product_name!) ||
          parsed.product_name!.includes(p.name) ||
          (parsed.product_name!.includes('チンゲン') && p.name.includes('青梗菜')),
      )
      if (hit) parsed.product_id = hit.id
    }

    // 既存注文の差分確認（もし顧客と日付と品目が特定できた場合、既存出荷を取得）
    let existingShipment: NaturalParseResult['existing_shipment'] = null
    const targetDate = parsed.delivery_date || referenceDate
    if (parsed.customer_id && targetDate) {
      const { data: existOrders } = await admin
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
        .limit(1)

      const ord = existOrders?.[0]
      if (ord) {
        type RawItem = { id: string; product_id: string | null; product_name: string; quantity: number }
        const items = (ord.order_items || []) as unknown as RawItem[]
        const matchedItem = items.find((i) => (parsed.product_id && i.product_id === parsed.product_id) || i.product_name.includes('チンゲン') || i.product_name.includes('青梗菜'))
        if (matchedItem) {
          existingShipment = {
            order_id: ord.id,
            delivery_date: ord.delivery_date,
            product_name: matchedItem.product_name,
            current_quantity: Number(matchedItem.quantity) || 0,
          }
        }
      }
    }

    parsed.existing_shipment = existingShipment

    return NextResponse.json({ ok: true, data: parsed })
  } catch (err) {
    console.error('[natural-input] 解析エラー:', err)
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : '自然言語の解析に失敗しました',
    }, { status: 500 })
  }
}
