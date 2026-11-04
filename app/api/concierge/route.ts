import { NextResponse } from 'next/server'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { getAuthedUser } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isStaffUser } from '@/lib/auth/is-staff-user'
import { getSetting } from '@/lib/settings'
import { DEFAULT_MAIN_GEMINI_MODEL, modelTryOrder } from '@/lib/gemini/models'
import { jstTodayStr, shiftDateStr } from '@/lib/dates'
import {
  buildConciergeSystemPrompt,
  buildDeterministicConciergeResponse,
  type ConciergeContextData,
  type ConciergeResponse,
} from '@/lib/concierge/schema'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(req: Request) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'ログインが必要です' }, { status: 401 })
  if (!(await isStaffUser(user.id))) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    message?: string
    history?: Array<{ role: 'user' | 'assistant'; content: string }>
    referenceDate?: string
  }
  const message = (body.message ?? '').trim()
  if (!message) {
    return NextResponse.json({ error: 'メッセージを入力してください' }, { status: 400 })
  }

  const todayStr = jstTodayStr()
  const tomorrowStr =
    typeof body.referenceDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.referenceDate)
      ? body.referenceDate
      : shiftDateStr(todayStr, 1)

  const admin = createAdminClient()

  // マスタ・明日の注文・現在の設定を並列で取得
  const [custRes, destRes, prodRes, settingsRes, ordersRes, rulesRes, apiKey, configuredModel] =
    await Promise.all([
      (async () => {
        const r1 = await admin
          .from('customers')
          .select('id, name, channel_identifiers')
          .eq('is_active', true)
          .order('name')
        if (!r1.error) return r1
        return await admin.from('customers').select('id, name').eq('is_active', true).order('name')
      })(),
      admin
        .from('delivery_destinations')
        .select('id, customer_id, code, full_name')
        .eq('is_active', true)
        .order('sort_order'),
      admin
        .from('products')
        .select('id, name, unit, category, container_capacity')
        .eq('is_active', true)
        .order('name'),
      admin.from('app_settings').select('key, value'),
      admin
        .from('orders')
        .select('id, customer_id, destination_id, order_items(product_name, quantity)')
        .eq('delivery_date', tomorrowStr)
        .in('status', ['approved', 'shipped', 'invoiced']),
      admin.from('customer_product_rules').select('customer_id, product_id, packs_per_case'),
      getSetting('GEMINI_API_KEY'),
      getSetting('GEMINI_MODEL'),
    ])

  const customers = (custRes.data ?? []).map((c) => {
    const ch = (c as { channel_identifiers?: { aliases?: string[] } | null }).channel_identifiers
    return {
      id: c.id as string,
      name: c.name as string,
      aliases: Array.isArray(ch?.aliases) ? ch.aliases : undefined,
    }
  })

  const destinations = (destRes.data ?? []).map((d) => ({
    id: d.id as string,
    customer_id: (d.customer_id as string) ?? '',
    code: (d.code as string | null) ?? null,
    full_name: d.full_name as string,
  }))

  const products = (prodRes.data ?? [])
    .filter((p) => p.category !== '資材')
    .map((p) => ({
      id: p.id as string,
      name: p.name as string,
      unit: p.unit as string,
      category: (p.category as string | null) ?? null,
      container_capacity: (p.container_capacity as number | null) ?? 20,
    }))

  const custMap = new Map(customers.map((c) => [c.id, c.name]))
  const destMap = new Map(destinations.map((d) => [d.id, d.code || d.full_name]))
  const rulePpcMap = new Map<string, number>()
  for (const r of (rulesRes.data ?? []) as Array<{ customer_id: string; packs_per_case?: number | null }>) {
    if (r.packs_per_case && r.packs_per_case > 0) {
      rulePpcMap.set(r.customer_id, r.packs_per_case)
    }
  }

  const tomorrowOrderSummary: ConciergeContextData['tomorrowOrderSummary'] = []
  for (const o of ordersRes.data ?? []) {
    const cName = custMap.get(o.customer_id) ?? '—'
    const dName = o.destination_id ? destMap.get(o.destination_id) ?? cName : cName
    const ppc =
      rulePpcMap.get(o.customer_id) ??
      (cName.includes('農業総合研究所') || cName.includes('NSK')
        ? 24
        : cName.includes('オレンジファーム')
        ? 25
        : cName.includes('ランドローム') || cName.includes('やなぎさわ')
        ? 10
        : 20)
    const rawItems = Array.isArray(o.order_items) ? o.order_items : []
    for (const it of rawItems as Array<{ product_name?: string; quantity?: number }>) {
      const q = Number(it.quantity) || 0
      if (q > 0) {
        tomorrowOrderSummary.push({
          customerName: cName,
          destinationName: dName,
          productName: it.product_name ?? '青梗菜',
          quantity: q,
          packsPerCase: ppc,
        })
      }
    }
  }

  const currentSettings: Record<string, string> = {
    STAFF_CAN_OCR: 'on',
    STAFF_CAN_CREATE_ORDER: 'on',
    STAFF_CAN_APPROVE: 'on',
    STAFF_CAN_PRINT_DOCS: 'on',
    STAFF_CAN_REPORT_SPEC: 'on',
    AUTO_APPROVE_ENABLED: 'off',
    NOTIFY_LINEWORKS_ENABLED: 'on',
  }
  for (const row of settingsRes.data ?? []) {
    if (row.key in currentSettings && typeof row.value === 'string') {
      currentSettings[row.key] = row.value
    }
  }

  const ctx: ConciergeContextData = {
    todayStr,
    tomorrowStr,
    customers,
    destinations,
    products,
    currentSettings,
    tomorrowOrderSummary,
  }

  // 1. まず決定論的エンジンで0.01秒で確実に解決できる定型リクエストかチェック
  const deterministic = buildDeterministicConciergeResponse(message, ctx)
  if (deterministic && (!apiKey || message.length <= 60)) {
    return NextResponse.json(deterministic)
  }

  // 2. Gemini による柔軟な対話＋アクション提案生成
  if (apiKey) {
    const genAI = new GoogleGenerativeAI(apiKey)
    const tryModels = modelTryOrder(configuredModel || DEFAULT_MAIN_GEMINI_MODEL)
    const systemInstruction = buildConciergeSystemPrompt(ctx)

    const historyText = (body.history ?? [])
      .slice(-6)
      .map((h) => `${h.role === 'user' ? 'ユーザー' : 'AI窓口'}: ${h.content}`)
      .join('\n')

    const userPrompt = historyText
      ? `【これまでの会話】\n${historyText}\n\n【今回のユーザーの相談・お願い】\n${message}`
      : `【ユーザーの相談・お願い】\n${message}`

    for (const modelName of tryModels) {
      try {
        const model = genAI.getGenerativeModel({
          model: modelName,
          systemInstruction,
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.2,
          },
        })

        const result = await model.generateContent(userPrompt)
        const rawText = result.response.text()
        const json = JSON.parse(rawText) as Partial<ConciergeResponse>
        if (typeof json.reply === 'string' && json.reply.trim()) {
          return NextResponse.json({
            reply: json.reply.trim(),
            proposals: Array.isArray(json.proposals) ? json.proposals : deterministic?.proposals ?? [],
            followUpSuggestions: Array.isArray(json.followUpSuggestions)
              ? json.followUpSuggestions.slice(0, 4)
              : ['明日の注文状況を教えて', '新しい品目を追加したい', 'スタッフの設定をすべてオンにして'],
          } satisfies ConciergeResponse)
        }
      } catch (err) {
        console.warn(`[concierge] model ${modelName} failed:`, err)
      }
    }
  }

  // 3. フォールバック応答
  if (deterministic) {
    return NextResponse.json(deterministic)
  }

  return NextResponse.json({
    reply:
      'ご相談ありがとうございます！たとえば「明日 和郷園に青梗菜20箱追加して」「新しい品目で春菊を追加して」「オレンジファームを25入りに変えて」「スタッフの設定を全部オンにして」のように話しかけていただければ、すぐに実行ボタンをお出しします！',
    proposals: [
      {
        type: 'navigate',
        title: '収穫・パックボードを開く',
        summary: '今日のパック作業・出荷カード一覧へ移動します',
        payload: {
          href: `/field/shipments?date=${tomorrowStr}`,
          button_label: '📦 収穫・パックボードへ移動',
        },
      },
    ],
    followUpSuggestions: [
      '明日の注文状況を教えて',
      'スタッフの設定を全部オンにして',
      '新しい品目で「春菊」を追加して',
      'オレンジファームの入数を25入りにして',
    ],
  } satisfies ConciergeResponse)
}
