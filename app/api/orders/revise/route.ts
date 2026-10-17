import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  invalidateAiRulesCache,
  reviseOrdersWithInstruction,
  type ParsedOrder,
} from '@/lib/gemini/analyze'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * POST /api/orders/revise
 *
 * 【ARCHITECTURE.md Ver 4.1 第1.3章・第5.3章 継承】
 * 旧パイプラインで Discord リプライが担っていた「自然言語での修正指示によるJSON再計算」と
 * 「恒久ルールの自動抽出・指示書（ai_rules）自己更新」を Web アプリ上で実行するエンドポイント。
 */
export async function POST(req: NextRequest) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'ログインが必要です' }, { status: 401 })

  const supabase = createClient()
  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).maybeSingle()
  if (profile?.role !== 'admin' && profile?.role !== 'staff') {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 })
  }

  let body: {
    orderId?: string
    currentOrders?: ParsedOrder[]
    instruction?: string
    clientName?: string
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: '不正なJSONリクエストです' }, { status: 400 })
  }

  const instruction = body.instruction?.trim()
  if (!instruction) {
    return NextResponse.json({ error: '修正指示テキストを入力してください' }, { status: 400 })
  }

  const currentOrders = Array.isArray(body.currentOrders) ? body.currentOrders : []
  if (currentOrders.length === 0) {
    return NextResponse.json({ error: '修正対象の注文データがありません' }, { status: 400 })
  }

  try {
    const result = await reviseOrdersWithInstruction({
      currentOrders,
      userInstruction: instruction,
      clientNameHint: body.clientName ?? currentOrders[0]?.customer_name ?? null,
    })

    const admin = createAdminClient()
    let ruleSaved = false

    // 恒久ルール（ai_learned_rule_candidate）が抽出された場合は ai_rules へ自動追記（自己更新機能）
    if (result.aiLearnedRuleCandidate) {
      const targetClient =
        body.clientName?.trim() ||
        result.orders[0]?.customer_name?.trim() ||
        currentOrders[0]?.customer_name?.trim() ||
        '共通'
      const { data: dup } = await admin
        .from('ai_rules')
        .select('id')
        .eq('client_name', targetClient)
        .eq('rule_text', result.aiLearnedRuleCandidate)
        .maybeSingle()

      if (!dup) {
        const { error: ruleErr } = await admin.from('ai_rules').insert({
          client_name: targetClient,
          rule_text: result.aiLearnedRuleCandidate,
          is_active: true,
          priority: 5,
          category: 'parsing',
          source: 'learned_from_correction',
        })
        if (!ruleErr) {
          ruleSaved = true
          invalidateAiRulesCache()
        }
      } else {
        ruleSaved = true
      }
    }

    // orderId が指定されている場合は承認待ち注文（orders / order_items）に反映
    if (body.orderId && result.orders[0]) {
      const revOrder = result.orders[0]
      if (revOrder.delivery_date) {
        await admin
          .from('orders')
          .update({ delivery_date: revOrder.delivery_date })
          .eq('id', body.orderId)
      }
      const { data: existingItems } = await admin
        .from('order_items')
        .select('id, product_name, quantity')
        .eq('order_id', body.orderId)
        .order('id', { ascending: true })

      if (existingItems && existingItems.length > 0) {
        for (let i = 0; i < Math.min(existingItems.length, revOrder.items.length); i++) {
          const dbItem = existingItems[i]!
          const newItem = revOrder.items[i]!
          const newQty = Number(newItem.quantity)
          if (Number.isFinite(newQty) && newQty > 0) {
            await admin
              .from('order_items')
              .update({
                quantity: newQty,
                quantity_raw: newItem.quantity_case_text ?? newItem.quantity,
                spec: newItem.spec ?? undefined,
                container_type: newItem.container_type ?? undefined,
                confidence: 1.0,
              })
              .eq('id', dbItem.id)
          }
        }
      }
    }

    return NextResponse.json({
      ok: true,
      orders: result.orders,
      aiLearnedRuleCandidate: result.aiLearnedRuleCandidate,
      ruleSaved,
      revisionSummary: result.revisionSummary,
      usedModel: result.usedModel,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: `AI対話修正に失敗しました: ${msg}` }, { status: 502 })
  }
}
