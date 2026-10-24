import { NextResponse } from 'next/server'
import { getAuthedUser } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { orderItemPatchSchema, fieldStatusPatchSchema } from '@/types/database'
import { writeAudit } from '@/lib/audit/log'
import { nextFieldStatus } from '@/lib/field/tap-loop'
import { recordMistakeFeedback } from '@/lib/ai/learning-loop'

export const runtime = 'nodejs'

// quantity/価格変更（admin）と field_status タップ（圃場）を同じ PATCH で受ける。
function parsePatch(body: unknown) {
  const isFieldTap =
    typeof body === 'object' && body !== null && 'field_status' in body
  return isFieldTap ? fieldStatusPatchSchema.safeParse(body) : orderItemPatchSchema.safeParse(body)
}

/**
 * 数量変更・タップ更新（features.md §6/§7）。楽観ロック必須。
 * RLSによるスタッフ操作遮断を防ぐため createAdminClient を使用。
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

  // 現在値を取得（楽観ロックの比較と監査の old_values 用）
  const { data: current, error: readErr } = await admin
    .from('order_items')
    .select('*')
    .eq('id', params.id)
    .maybeSingle()
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 })
  if (!current) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  // field_status は前進のみ（安全版タップループ）。要求値が前進先と一致するか検証。
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
      // 数量変更時: GAS版二重ガードに従い、誤出荷防止のためステータスを未着手に自動リセット
      if (input.quantity !== current.quantity) {
        updates.field_status = 'not_started'
        updates.shipped_qty = null
      }
    }
    if (input.unit_price != null) updates.unit_price = input.unit_price
    if (input.tax_rate != null) updates.tax_rate = input.tax_rate
    if (input.fraction_note !== undefined) updates.fraction_note = input.fraction_note
    if (input.spec !== undefined) updates.spec = input.spec
    if (input.container_type !== undefined) updates.container_type = input.container_type
    if (input.has_card !== undefined) updates.has_card = input.has_card
    if (input.line_note !== undefined) updates.line_note = input.line_note
    if (input.pack_config_id !== undefined) updates.pack_config_id = input.pack_config_id
    // 現場の記録（中断時の部分完了数・現場メモ）
    if (input.shipped_qty !== undefined) updates.shipped_qty = input.shipped_qty
    if (input.field_note !== undefined) updates.field_note = input.field_note
    // 手動修正保護マーク（FAX再送時の誤上書き防止）
    updates.is_manual_modified = true
  }

  // 楽観ロック：version 一致時のみ更新。version++ も同時に行う。
  let { data: updated, error: updErr } = await admin
    .from('order_items')
    .update({ ...updates, version: current.version + 1 })
    .eq('id', params.id)
    .eq('version', input.version)
    .select()
    .maybeSingle()
  if (updErr && 'is_manual_modified' in updates) {
    const fallbackUpdates = { ...updates }
    delete fallbackUpdates.is_manual_modified
    const retry = await admin
      .from('order_items')
      .update({ ...fallbackUpdates, version: current.version + 1 })
      .eq('id', params.id)
      .eq('version', input.version)
      .select()
      .maybeSingle()
    updated = retry.data
    updErr = retry.error
  }
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })
  if (!updated) {
    // 0件 = version 不一致（競合）。UI に再読込させる。
    return NextResponse.json({ error: 'conflict', currentVersion: current.version }, { status: 409 })
  }

  // 数量が変更された場合は harvest_tasks の必要数も自動同期
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

  // ⚡ 現場カードでの「規格」「荷姿（コンテナ）」手動修正を自動学習ループ & 取引先×品目ルールへ自動蓄積
  if (
    !('field_status' in input) &&
    ((input.spec !== undefined && input.spec !== current.spec && input.spec) ||
      (input.container_type !== undefined && input.container_type !== current.container_type && input.container_type))
  ) {
    try {
      const { data: ord } = await admin
        .from('orders')
        .select('customer_id')
        .eq('id', current.order_id)
        .maybeSingle()
      if (ord?.customer_id) {
        const { data: cust } = await admin
          .from('customers')
          .select('name')
          .eq('id', ord.customer_id)
          .maybeSingle()
        const clientName = cust?.name || '共通'

        // 1. 取引先×品目マスタ（customer_product_rules）へも自動反映して次回以降のデフォルト化
        const rulePatch: Record<string, unknown> = {}
        if (input.spec && input.spec !== current.spec) {
          rulePatch.label_spec = input.spec
          const m = input.spec.normalize('NFKC').match(/(?:入数|1箱|1ケース)\s*(\d+)|(\d+)\s*(?:入|パック|P)/i)
          if (m) {
            const pNum = Number(m[1] || m[2])
            if (pNum > 0 && pNum <= 200) rulePatch.packs_per_case = pNum
          }
        }
        if (input.container_type && input.container_type !== current.container_type) {
          rulePatch.default_container_type = input.container_type
        }
        if (Object.keys(rulePatch).length > 0 && current.product_id) {
          const { data: existingRule } = await admin
            .from('customer_product_rules')
            .select('id')
            .eq('customer_id', ord.customer_id)
            .eq('product_id', current.product_id)
            .maybeSingle()
          if (existingRule) {
            await admin.from('customer_product_rules').update(rulePatch).eq('id', existingRule.id)
          }
        }

        // 2. AI自動学習ループ（ai_rules）へ蓄積
        if (input.spec && input.spec !== current.spec) {
          await recordMistakeFeedback({
            clientName,
            correctedField: 'spec',
            correctedValue: input.spec,
            originalAiValue: current.spec,
            note: current.product_name,
          })
        }
        if (input.container_type && input.container_type !== current.container_type) {
          await recordMistakeFeedback({
            clientName,
            correctedField: 'container',
            correctedValue: input.container_type,
            originalAiValue: current.container_type,
            note: current.product_name,
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

/**
 * 明細の削除（出荷一覧の詳細から・誤追加の取消）。admin/staff 可。
 * 安全ガード：出荷済み・価格確定済み・請求済み注文の明細は削除不可（履歴/税務保護）。
 * 紐づく収穫タスクはクリーンアップまたは FK の ON DELETE CASCADE で安全に連動。
 */
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

  // 収穫タスクを明示的に事前クリーンアップ
  await admin.from('harvest_tasks').delete().eq('order_item_id', params.id)

  const { error } = await admin.from('order_items').delete().eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // 監査用スナップショット（埋め込んだ orders を除く）
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
