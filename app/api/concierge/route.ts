import { NextResponse } from 'next/server'
import { GoogleGenerativeAI, type Part } from '@google/generative-ai'
import { requireStaffApi } from '@/lib/auth/api-guard'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSetting } from '@/lib/settings'
import { conciergeToolDeclarations, runConciergeTool, getTodayWork, type ToolContext } from '@/lib/concierge/tools'
import { sanitizeProposals, parseLooseJson, buildBriefing } from '@/lib/concierge/guard'
import { DEFAULT_MAIN_GEMINI_MODEL, modelTryOrder } from '@/lib/gemini/models'
import { jstTodayStr, shiftDateStr } from '@/lib/dates'
import { resolvePacksPerCase, splitPacksForCustomer } from '@/lib/masters/packs-per-case'
import {
  buildConciergeSystemPrompt,
  buildDeterministicConciergeResponse,
  type ConciergeContextData,
  type ConciergeResponse,
} from '@/lib/concierge/schema'

export const runtime = 'nodejs'
export const maxDuration = 60

/** ツール呼び出しの最大往復数（無限ループ・コスト暴走の防止） */
const MAX_TOOL_ROUNDS = 4

/** 道具（ツール）の使い方と、正直さのルール（システムプロンプトに追記） */
function toolRules(role: 'admin' | 'staff'): string {
  return `
==================================================
【4. データの調べ方（最重要）】
==================================================
- 注文・作業状況・売上・評価指標など「数字」を聞かれたら、上の要約だけで答えず、必ず道具（get_orders / get_today_work${role === 'admin' ? ' / get_sales_summary / get_metrics' : ''}）で実際のデータを調べてから答えてください。
- 道具の結果に無い数字を作ってはいけません。調べられなかったときは「わかりませんでした」と正直に伝え、どの画面で確認できるかを navigate で案内してください。
- 出荷先は必ず「取引先 ＞ 納入先」の形で書いてください。
- 今話している相手は「${role === 'admin' ? '管理者（経営者）' : '現場スタッフ'}」です。${role === 'admin' ? '' : '設定の変更（toggle_setting）と /admin で始まる画面への案内は提案しないでください（スタッフは使えません）。売上の金額は答えないでください。'}
- 調べ終わったら、最後は【3. 応答のルール】のJSONだけを出力してください。`
}

export async function POST(req: Request) {
  const guard = await requireStaffApi()
  if (!guard.ok) return guard.response
  const role = guard.role

  const body = (await req.json().catch(() => ({}))) as {
    message?: string
    mode?: 'briefing'
    history?: Array<{ role: 'user' | 'assistant'; content: string }>
    referenceDate?: string
  }
  const message = (body.message ?? '').trim()
  if (!message && body.mode !== 'briefing') {
    return NextResponse.json({ error: 'メッセージを入力してください' }, { status: 400 })
  }

  const todayStr = jstTodayStr()
  const tomorrowStr =
    typeof body.referenceDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.referenceDate)
      ? body.referenceDate
      : shiftDateStr(todayStr, 1)

  const admin = createAdminClient()

  // 開いた瞬間の「今日の要点」: AI を呼ばずに実データから即答（速い・数字が正確）
  if (body.mode === 'briefing') {
    try {
      const w = (await getTodayWork(tomorrowStr, { admin })) as Record<string, number>
      if ('error' in w) throw new Error(String((w as { error?: unknown }).error))
      return NextResponse.json(
        buildBriefing({
          role,
          deliveryDate: tomorrowStr,
          dateLabel: tomorrowStr === shiftDateStr(todayStr, 1) ? '明日' : tomorrowStr === todayStr ? '今日' : tomorrowStr,
          notStarted: w['未着手'] ?? 0,
          packed: w['パック済'] ?? 0,
          shipped: w['出荷済'] ?? 0,
          packsLeft: w['未出荷のパック数'] ?? 0,
          pendingApprovals: w['承認待ちの注文'] ?? 0,
          failedReceipts: w['読み取り失敗_取引先不明の受信'] ?? 0,
        }),
      )
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : '今日の要点を取得できませんでした' }, { status: 500 })
    }
  }

  // マスタ・明日の注文・現在の設定を並列で取得
  const [custRes, destRes, prodRes, settingsRes, ordersRes, rulesRes, apiKey, configuredModel, packsRes] =
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
        .select('id, customer_id, destination_id, order_items(product_id, product_name, quantity, pack_config_id)')
        .eq('delivery_date', tomorrowStr)
        .in('status', ['approved', 'shipped', 'invoiced']),
      admin.from('customer_product_rules').select('customer_id, product_id, packs_per_case'),
      getSetting('GEMINI_API_KEY'),
      getSetting('GEMINI_MODEL'),
      // 入数の解決用（出荷一覧のカードと同じ lib/masters/packs-per-case.ts の材料）
      admin.from('pack_configs').select('id, product_id, customer_id, base_per_selling, is_active'),
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
  // 読み取りツール（lib/concierge/tools.ts）用の取引先単位の入数（従来どおり）
  const rulePpcMap = new Map<string, number>()
  for (const r of (rulesRes.data ?? []) as Array<{ customer_id: string; packs_per_case?: number | null }>) {
    if (r.packs_per_case && r.packs_per_case > 0) {
      rulePpcMap.set(r.customer_id, r.packs_per_case)
    }
  }
  // 明日の注文の要約の入数はカード・コンテナ内訳と同じ解決（取引先別の設定 → 荷姿 → 品目の標準 → 既定20）
  const ruleByPair = new Map(
    ((rulesRes.data ?? []) as Array<{ customer_id: string; product_id: string; packs_per_case?: number | null }>).map((r) => [
      `${r.customer_id}:${r.product_id}`,
      r,
    ]),
  )
  if (packsRes.error) console.error('[api/concierge] 入数用の荷姿の取得に失敗（品目の標準・既定で数えます）:', packsRes.error.message)
  const packRows = (packsRes.data ?? []) as Array<{
    id: string
    product_id: string
    customer_id: string | null
    base_per_selling: number | null
    is_active: boolean | null
  }>
  const packById = new Map(packRows.map((p) => [p.id, p]))
  const capacityById = new Map(
    ((prodRes.data ?? []) as Array<{ id: string; container_capacity?: number | null }>).map((p) => [p.id, p.container_capacity]),
  )

  const tomorrowOrderSummary: ConciergeContextData['tomorrowOrderSummary'] = []
  for (const o of ordersRes.data ?? []) {
    const cName = custMap.get(o.customer_id) ?? '—'
    const dName = o.destination_id ? destMap.get(o.destination_id) ?? cName : cName
    const rawItems = Array.isArray(o.order_items) ? o.order_items : []
    for (const it of rawItems as Array<{ product_id?: string; product_name?: string; quantity?: number; pack_config_id?: string | null }>) {
      const q = Number(it.quantity) || 0
      if (q > 0) {
        const pid = it.product_id ?? ''
        const { customerPacks, sharedPacks } = splitPacksForCustomer(packRows, o.customer_id, pid)
        const ppc = resolvePacksPerCase({
          rule: ruleByPair.get(`${o.customer_id}:${pid}`) ?? null,
          packConfig: it.pack_config_id ? packById.get(it.pack_config_id) ?? null : null,
          customerPacks,
          sharedPacks,
          product: { container_capacity: capacityById.get(pid) },
        }).value
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
  const rawDeterministic = buildDeterministicConciergeResponse(message, ctx)
  const deterministic = rawDeterministic
    ? { ...rawDeterministic, proposals: sanitizeProposals(rawDeterministic.proposals, role) }
    : null
  if (deterministic && (!apiKey || message.length <= 60)) {
    return NextResponse.json(deterministic)
  }

  // 2. Gemini: 必要なら道具（読み取り専用ツール）で実データを調べてから、返答＋実行ボタンの提案を作る
  if (apiKey) {
    const genAI = new GoogleGenerativeAI(apiKey)
    const tryModels = modelTryOrder(configuredModel || DEFAULT_MAIN_GEMINI_MODEL)
    const systemInstruction = `${buildConciergeSystemPrompt(ctx)}\n${toolRules(role)}`
    const toolCtx: ToolContext = { admin, role, customers, destinations, customerPpc: rulePpcMap }

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
          tools: [{ functionDeclarations: conciergeToolDeclarations(role) }],
          generationConfig: { temperature: 0.2 },
        })
        const chat = model.startChat()
        let result = await chat.sendMessage(userPrompt)
        const usedTools: string[] = []
        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
          const calls = result.response.functionCalls() ?? []
          if (calls.length === 0) break
          const responses: Part[] = await Promise.all(
            calls.map(async (c) => {
              usedTools.push(c.name)
              const out = await runConciergeTool(c.name, (c.args ?? {}) as Record<string, unknown>, toolCtx)
              return { functionResponse: { name: c.name, response: out } }
            }),
          )
          result = await chat.sendMessage(responses)
        }

        const rawText = result.response.text()
        const json = parseLooseJson(rawText) as Partial<ConciergeResponse> | null
        const reply = typeof json?.reply === 'string' && json.reply.trim() ? json.reply.trim() : rawText.trim()
        if (reply) {
          return NextResponse.json({
            reply,
            proposals: sanitizeProposals(json?.proposals ?? deterministic?.proposals ?? [], role),
            followUpSuggestions: Array.isArray(json?.followUpSuggestions)
              ? json!.followUpSuggestions.filter((x): x is string => typeof x === 'string').slice(0, 4)
              : ['明日の注文状況を教えて', '何が終わっていない？', '先週と比べて今週はどう？'],
            usedTools,
          } satisfies ConciergeResponse & { usedTools: string[] })
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
