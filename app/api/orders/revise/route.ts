import { shiftDateStr } from '@/lib/dates'
import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  invalidateAiRulesCache,
  reviseOrdersWithInstruction,
  type ParsedOrder,
} from '@/lib/gemini/analyze'
import { isGenericOrInvalidContainer } from '@/lib/pipeline/schemas'
import { requireStaffApi } from '@/lib/auth/api-guard'
import { writeDroppingMissingColumns } from '@/lib/supabase/missing-column'
import { runSideEffect, withWarnings } from '@/lib/api/side-effects'

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
  const guard = await requireStaffApi()
  if (!guard.ok) return guard.response

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
    const warnings: string[] = []
    if (body.orderId && result.orders[0]) {
      const revOrder = result.orders[0]
      if (revOrder.delivery_date) {
        const { error: dateErr } = await admin
          .from('orders')
          .update({ delivery_date: revOrder.delivery_date })
          .eq('id', body.orderId)
        if (dateErr) {
          console.error('[orders/revise] orders.delivery_date の更新に失敗:', dateErr.message)
          return NextResponse.json(
            { error: '修正内容を注文に保存できませんでした（納品日の更新に失敗）。もう一度お試しください' },
            { status: 500 },
          )
        }
      }
      const { data: existingItems, error: itemsErr } = await admin
        .from('order_items')
        .select('id, product_name, quantity, version')
        .eq('order_id', body.orderId)
        .order('id', { ascending: true })
      if (itemsErr) {
        console.error('[orders/revise] order_items の読み込みに失敗:', itemsErr.message)
        return NextResponse.json(
          {
            error: revOrder.delivery_date
              ? '注文の明細を読み込めず、数量の修正を保存できませんでした（納品日は保存済みです）。画面を再読み込みして確認してください'
              : '注文の明細を読み込めず、数量の修正を保存できませんでした。もう一度お試しください',
          },
          { status: 500 },
        )
      }

      if (existingItems && existingItems.length > 0) {
        let savedCount = 0
        for (let i = 0; i < Math.min(existingItems.length, revOrder.items.length); i++) {
          const dbItem = existingItems[i]!
          const newItem = revOrder.items[i]!
          const newQty = Number(newItem.quantity)
          if (Number.isFinite(newQty) && newQty > 0) {
            const payload: Record<string, unknown> = {
              quantity: newQty,
              version: (Number((dbItem as { version?: number }).version) || 1) + 1,
              quantity_raw: newItem.quantity_case_text ?? newItem.quantity,
              spec: newItem.spec ?? undefined,
              container_type:
                newItem.container_type && !isGenericOrInvalidContainer(newItem.container_type)
                  ? newItem.container_type
                  : undefined,
              has_card: typeof newItem.has_card === 'boolean' ? newItem.has_card : undefined,
              // has_seal / bag_type は本番に列が無い（engineering.md §1）。列が無いエラーなら落として再試行する
              has_seal: typeof newItem.has_seal === 'boolean' ? newItem.has_seal : undefined,
              bag_type: newItem.bag_type ?? undefined,
              confidence: 1.0,
            }
            for (const k of Object.keys(payload)) if (payload[k] === undefined) delete payload[k]
            const upd = await writeDroppingMissingColumns(payload, (p) =>
              admin.from('order_items').update(p).eq('id', dbItem.id),
            )
            if (upd.droppedColumns.length > 0) {
              console.warn('[orders/revise] 未適用の列を除いて保存しました:', upd.droppedColumns.join(', '))
            }
            if (upd.error) {
              console.error('[orders/revise] order_items の更新に失敗:', upd.error.message)
              return NextResponse.json(
                {
                  error:
                    savedCount > 0 || revOrder.delivery_date
                      ? '修正内容の保存が途中で失敗しました（一部の明細・納品日は保存済みの可能性があります）。画面を再読み込みして内容を確認してください'
                      : '修正内容を注文に保存できませんでした。もう一度お試しください',
                },
                { status: 500 },
              )
            }
            savedCount++
            const htPatch: Record<string, unknown> = { required_qty: newQty }
            if (revOrder.delivery_date) {
              htPatch.task_date = shiftDateStr(revOrder.delivery_date, -1)
            }
            await runSideEffect(
              warnings,
              '[orders/revise] harvest_tasks の同期に失敗',
              '注文の修正は保存しましたが、収穫・パックの必要数を更新できませんでした。収穫画面の数が古い可能性があります。この注文の数量をもう一度保存してください',
              () => admin.from('harvest_tasks').update(htPatch).eq('order_item_id', dbItem.id),
            )
          }
        }
      }
    }

    return NextResponse.json(
      withWarnings(
        {
          ok: true,
          orders: result.orders,
          aiLearnedRuleCandidate: result.aiLearnedRuleCandidate,
          ruleSaved,
          revisionSummary: result.revisionSummary,
          usedModel: result.usedModel,
        },
        warnings,
      ),
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: `AI対話修正に失敗しました: ${msg}` }, { status: 502 })
  }
}
