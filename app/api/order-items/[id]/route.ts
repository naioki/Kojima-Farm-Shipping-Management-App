import { NextResponse } from 'next/server'
import { getAuthedUser } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { writeDroppingMissingColumns } from '@/lib/supabase/missing-column'
import { orderItemPatchSchema, fieldStatusPatchSchema } from '@/types/database'
import { writeAudit } from '@/lib/audit/log'
import { nextFieldStatus } from '@/lib/field/tap-loop'
import { recordMistakeFeedback } from '@/lib/ai/learning-loop'

export const runtime = 'nodejs'

function parsePatch(body: unknown) {
  const isFieldTap =
    typeof body === 'object' && body !== null && 'field_status' in body
  return isFieldTap ? fieldStatusPatchSchema.safeParse(body) : orderItemPatchSchema.safeParse(body)
}

/**
 * 数量変更・タップ更新・現場仕様更新（#09 注文数の直接変更, #10 シール・袋種別の変更対応）。
 */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('users')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()

  if (profile?.role !== 'admin' && profile?.role !== 'staff') {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  const parsed = parsePatch(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid', detail: parsed.error.flatten() }, { status: 400 })
  }
  const input = parsed.data

  const { data: current, error: readErr } = await admin
    .from('order_items')
    .select('*')
    .eq('id', params.id)
    .maybeSingle()
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 })
  if (!current) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const updates: Record<string, unknown> = {}
  if ('field_status' in input) {
    const expected = nextFieldStatus(current.field_status)
    if (input.field_status !== expected && input.field_status !== current.field_status) {
      return NextResponse.json(
        { error: 'illegal_transition', expected },
        { status: 409 },
      )
    }
    updates.field_status = input.field_status
    if (input.shipped_qty != null) updates.shipped_qty = input.shipped_qty
    if (input.field_status === 'shipped') updates.shipped_at = new Date().toISOString()
  } else {
    if (input.quantity != null) {
      updates.quantity = input.quantity
      if (input.quantity !== current.quantity) {
        const oldQ = Number(current.quantity)
        const newQ = Number(input.quantity)
        const wasPacked = current.field_status === 'packed' || current.field_status === 'shipped'
        updates.field_status = 'not_started'
        updates.shipped_qty = wasPacked && newQ > oldQ ? oldQ : null
        updates.snap_total_packs = oldQ
        const changeToken =
          wasPacked && newQ > oldQ
            ? `🚨パック済(${oldQ}P)→${newQ}P(+${newQ - oldQ}P追加必要)`
            : `数量変更:${oldQ}→${newQ}P`
        const rawBaseNote: string =
          input.line_note !== undefined
            ? String(input.line_note ?? '')
            : typeof current.line_note === 'string'
            ? current.line_note
            : ''
        const cleanedBase = rawBaseNote
          .split(/\s*\/\s*/)
          .filter((t: string) => t && !/^(?:数量変更:|🚨パック済|★?新規追加)/.test(t.trim()))
          .join(' / ')
        updates.line_note = [changeToken, cleanedBase].filter(Boolean).join(' / ')
      }
    }
    if (input.unit_price != null) updates.unit_price = input.unit_price
    if (input.tax_rate != null) updates.tax_rate = input.tax_rate
    if (input.fraction_note !== undefined) updates.fraction_note = input.fraction_note
    if (input.spec !== undefined) updates.spec = input.spec
    if (input.container_type !== undefined) updates.container_type = input.container_type
    if (input.has_card !== undefined) updates.has_card = input.has_card
    if (input.has_seal !== undefined) updates.has_seal = input.has_seal
    if (input.seal_text !== undefined) updates.seal_text = input.seal_text
    if (input.bag_type !== undefined) updates.bag_type = input.bag_type
    if (input.line_note !== undefined && updates.line_note === undefined) updates.line_note = input.line_note
    if (input.pack_config_id !== undefined) updates.pack_config_id = input.pack_config_id
    if (input.shipped_qty !== undefined) updates.shipped_qty = input.shipped_qty
    if (input.field_note !== undefined) updates.field_note = input.field_note
    updates.is_manual_modified = true
  }

  // 楽観ロック（CLAUDE.md: WHERE id=$ AND version=$expected、0件なら409）。
  // - 数量・単価・税率（請求・出荷数に直結）: 画面が見ていた version と一致しなければ 409。
  //   他の人の変更を黙って上書きしない。
  // - 作業ステータス: 遷移の正当性は直前に読んだ最新状態で検証済みなので、その version で照合する
  //   （連続タップで画面側の version が一瞬古くても自己競合にしない。#9-01）。
  // - 資材・メモ等（数量に依存しない独立した項目）: 最新 version で照合し、間に別の更新が
  //   挟まった場合は読み直して1回だけ再試行する。
  const isMoneyOrQtyChange =
    !('field_status' in input) &&
    ((input.quantity != null && input.quantity !== current.quantity) ||
      (input.unit_price != null && input.unit_price !== current.unit_price) ||
      (input.tax_rate != null && input.tax_rate !== current.tax_rate))
  if (isMoneyOrQtyChange && input.version !== current.version) {
    return NextResponse.json({ error: 'conflict', currentVersion: current.version }, { status: 409 })
  }

  const casUpdate = (expectedVersion: number) =>
    writeDroppingMissingColumns({ ...updates, version: expectedVersion + 1 }, (p) =>
      admin.from('order_items').update(p).eq('id', params.id).eq('version', expectedVersion).select().maybeSingle(),
    )

  let { data: updated, error: updErr } = await casUpdate(current.version)
  if (!updated && !updErr && !isMoneyOrQtyChange && !('field_status' in input)) {
    const { data: fresh, error: freshErr } = await admin
      .from('order_items')
      .select('version')
      .eq('id', params.id)
      .maybeSingle()
    if (freshErr) return NextResponse.json({ error: freshErr.message }, { status: 500 })
    if (fresh) {
      const retry = await casUpdate(fresh.version)
      updated = retry.data
      updErr = retry.error
    }
  }
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })
  if (!updated) {
    return NextResponse.json({ error: 'conflict', currentVersion: current.version }, { status: 409 })
  }

  if ('quantity' in input && input.quantity != null && input.quantity !== current.quantity) {
    try {
      await admin
        .from('harvest_tasks')
        .update({ required_qty: input.quantity })
        .eq('order_item_id', params.id)
    } catch (htErr) {
      console.warn('[order-items] harvest_tasks 数量同期警告:', htErr)
    }
  }

  // ⚡ 現場カードでの「規格」「荷姿（コンテナ）」「カード有無」「シール」「袋」手動修正を自動学習ループ & 取引先×品目ルール＋納入先マスタへ自動蓄積（#3-01〜#3-05）
  if (
    !('field_status' in input) &&
    ((input.spec !== undefined && input.spec !== current.spec && input.spec) ||
      (input.container_type !== undefined && input.container_type !== current.container_type && input.container_type) ||
      (input.has_card !== undefined && input.has_card !== current.has_card) ||
      (input.has_seal !== undefined && input.has_seal !== current.has_seal) ||
      (input.bag_type !== undefined && input.bag_type !== current.bag_type && input.bag_type))
  ) {
    try {
      const { data: ord } = await admin
        .from('orders')
        .select('customer_id, destination_id')
        .eq('id', current.order_id)
        .maybeSingle()
      if (ord?.customer_id) {
        const [{ data: cust }, { data: destRow }] = await Promise.all([
          admin.from('customers').select('name').eq('id', ord.customer_id).maybeSingle(),
          ord.destination_id
            ? admin.from('delivery_destinations').select('id, code, full_name').eq('id', ord.destination_id).maybeSingle()
            : Promise.resolve({ data: null }),
        ])
        const clientName = cust?.name || '共通'
        const destLabel = destRow?.code || destRow?.full_name || ''

        // 【#3-02 解消】納入先（destination_id）が紐づいている場合、納入先ごとの既定コンテナ（default_container_type）も自動更新
        if (ord.destination_id && input.container_type && input.container_type !== current.container_type) {
          await writeDroppingMissingColumns(
            { default_container_type: input.container_type },
            (p) => admin.from('delivery_destinations').update(p).eq('id', ord.destination_id!),
          )
        }

        const rulePatch: Record<string, unknown> = {}
        if (input.spec && input.spec !== current.spec) {
          rulePatch.label_spec = input.spec
          rulePatch.spec = input.spec
          const m = input.spec.normalize('NFKC').match(/(?:入数|1箱|1ケース)\s*(\d+)|(\d+)\s*(?:P入|パック入|袋入|入)/i)
          if (m) {
            const pNum = Number(m[1] || m[2])
            if (pNum >= 10 && pNum <= 200) rulePatch.packs_per_case = pNum
          }
        }
        // 【#3-01 解消】customer_product_rules の正しいカラム名 container_type に保存
        if (input.container_type && input.container_type !== current.container_type) {
          rulePatch.container_type = input.container_type
        }
        // 【#3-04 解消】has_card（カード有無）も取引先ルールに自動記憶
        if (input.has_card !== undefined && input.has_card !== current.has_card && input.has_card !== null) {
          rulePatch.has_card = input.has_card
        }
        if (input.has_seal !== undefined && input.has_seal !== current.has_seal) {
          rulePatch.has_seal = input.has_seal
        }
        if (input.seal_text !== undefined) {
          rulePatch.seal_text = input.seal_text
        }
        if (input.bag_type && input.bag_type !== current.bag_type) {
          rulePatch.bag_type = input.bag_type
        }
        // 【#3-03 解消】既存ルール行が無い取引先でも upsert / insert で確実に記憶
        if (Object.keys(rulePatch).length > 0 && current.product_id) {
          const { data: existingRule } = await admin
            .from('customer_product_rules')
            .select('id')
            .eq('customer_id', ord.customer_id)
            .eq('product_id', current.product_id)
            .maybeSingle()
          if (existingRule) {
            await writeDroppingMissingColumns(rulePatch, (p) =>
              admin.from('customer_product_rules').update(p).eq('id', existingRule.id),
            )
          } else {
            await writeDroppingMissingColumns(
              {
                customer_id: ord.customer_id,
                product_id: current.product_id,
                ...rulePatch,
              },
              (p) => admin.from('customer_product_rules').insert(p as never),
            )
          }
        }

        const contextNote = [destLabel, current.product_name].filter(Boolean).join(' / ')
        if (input.spec && input.spec !== current.spec) {
          await recordMistakeFeedback({
            clientName,
            correctedField: 'spec',
            correctedValue: input.spec,
            originalAiValue: current.spec,
            note: contextNote,
          })
        }
        if (input.container_type && input.container_type !== current.container_type) {
          await recordMistakeFeedback({
            clientName,
            correctedField: 'container',
            correctedValue: input.container_type,
            originalAiValue: current.container_type,
            note: contextNote,
          })
        }
        if (input.has_card !== undefined && input.has_card !== current.has_card && input.has_card !== null) {
          await recordMistakeFeedback({
            clientName,
            correctedField: 'has_card',
            correctedValue: input.has_card ? 'カードあり' : 'カードなし',
            originalAiValue: current.has_card ? 'カードあり' : 'カードなし',
            note: contextNote,
          })
        }
        if (input.has_seal !== undefined && input.has_seal !== current.has_seal && input.has_seal !== null) {
          await recordMistakeFeedback({
            clientName,
            correctedField: 'has_seal',
            correctedValue: input.has_seal ? (input.seal_text || 'シールあり') : 'シールなし',
            originalAiValue: current.has_seal ? 'シールあり' : 'シールなし',
            note: contextNote,
          })
        }
        if (input.bag_type && input.bag_type !== current.bag_type) {
          await recordMistakeFeedback({
            clientName,
            correctedField: 'bag_type',
            correctedValue: input.bag_type,
            originalAiValue: current.bag_type,
            note: contextNote,
          })
        }
      }
    } catch (learnErr) {
      console.warn('[order-items] 現場修正からの自動学習ループ同期警告:', learnErr)
    }
  }

  await writeAudit(admin, {
    entityType: 'order_items',
    entityId: params.id,
    action: 'UPDATE',
    oldValues: current,
    newValues: updated,
    userId: user.id,
  })

  return NextResponse.json({ item: updated })
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('users')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()

  if (profile?.role !== 'admin' && profile?.role !== 'staff') {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 })
  }

  const { data: item, error: itemErr } = await admin
    .from('order_items')
    .select('*, orders!inner(status)')
    .eq('id', params.id)
    .maybeSingle()

  if (itemErr) return NextResponse.json({ error: itemErr.message }, { status: 500 })
  if (!item) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const orderStatus = (item.orders as unknown as { status: string }).status
  if (item.field_status === 'shipped' || item.shipped_at != null) {
    return NextResponse.json({ error: '出荷済みの明細は削除できません' }, { status: 409 })
  }
  if (item.price_status === 'confirmed' || orderStatus === 'invoiced') {
    return NextResponse.json({ error: '請求確定済みのため削除できません' }, { status: 409 })
  }

  await admin.from('harvest_tasks').delete().eq('order_item_id', params.id)

  const { error } = await admin.from('order_items').delete().eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const snapshot: Record<string, unknown> = { ...(item as Record<string, unknown>) }
  delete snapshot.orders
  await writeAudit(admin, {
    entityType: 'order_items',
    entityId: params.id,
    action: 'DELETE',
    oldValues: snapshot,
    userId: user.id,
  })

  return NextResponse.json({ deleted: true })
}
