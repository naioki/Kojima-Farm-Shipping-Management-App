import { NextResponse } from 'next/server'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { orderItemPatchSchema, fieldStatusPatchSchema } from '@/types/database'
import { writeAudit } from '@/lib/audit/log'
import { nextFieldStatus } from '@/lib/field/tap-loop'

export const runtime = 'nodejs'

// quantity/価格変更（admin）と field_status タップ（圃場）を同じ PATCH で受ける。
// ※ z.union は先頭スキーマが緩い（全項目 optional）と field_status を持つ body も
//   orderItemPatchSchema 側で成立して field_status が落ちてしまう（タップが永続化されない）。
//   そのため body.field_status の有無で明示的に振り分ける。
function parsePatch(body: unknown) {
  const isFieldTap =
    typeof body === 'object' && body !== null && 'field_status' in body
  return isFieldTap ? fieldStatusPatchSchema.safeParse(body) : orderItemPatchSchema.safeParse(body)
}

/**
 * 数量変更・タップ更新（features.md §6/§7）。楽観ロック必須。
 *   WHERE id=$ AND version=$expected で更新。0件＝競合 → 409（UI再読込促す）。
 *   変更は audit_log に記録し version++。
 */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const parsed = parsePatch(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid', detail: parsed.error.flatten() }, { status: 400 })
  }
  const input = parsed.data
  const supabase = createClient()

  // 現在値を取得（楽観ロックの比較と監査の old_values 用）
  const { data: current, error: readErr } = await supabase
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
    if (input.quantity != null) updates.quantity = input.quantity
    if (input.unit_price != null) updates.unit_price = input.unit_price
    if (input.tax_rate != null) updates.tax_rate = input.tax_rate
    if (input.fraction_note !== undefined) updates.fraction_note = input.fraction_note
    if (input.spec !== undefined) updates.spec = input.spec
    if (input.container_type !== undefined) updates.container_type = input.container_type
    if (input.has_card !== undefined) updates.has_card = input.has_card
    if (input.line_note !== undefined) updates.line_note = input.line_note
    // 現場の記録（中断時の部分完了数・現場メモ）
    if (input.shipped_qty !== undefined) updates.shipped_qty = input.shipped_qty
    if (input.field_note !== undefined) updates.field_note = input.field_note
  }

  // 楽観ロック：version 一致時のみ更新。version++ も同時に行う。
  const { data: updated, error: updErr } = await supabase
    .from('order_items')
    .update({ ...updates, version: current.version + 1 })
    .eq('id', params.id)
    .eq('version', input.version)
    .select()
    .maybeSingle()
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })
  if (!updated) {
    // 0件 = version 不一致（競合）。UI に再読込させる。
    return NextResponse.json({ error: 'conflict', currentVersion: current.version }, { status: 409 })
  }

  await writeAudit(supabase, {
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
 * 紐づく収穫タスクは FK の ON DELETE CASCADE で消える。変更は audit_log に記録。
 */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const supabase = createClient()
  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).maybeSingle()
  if (profile?.role !== 'admin' && profile?.role !== 'staff') {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 })
  }

  const admin = createAdminClient()
  const { data: item } = await admin
    .from('order_items')
    .select('*, orders!inner(status)')
    .eq('id', params.id)
    .maybeSingle()
  if (!item) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const orderStatus = (item.orders as unknown as { status: string }).status
  if (item.field_status === 'shipped' || item.shipped_at != null) {
    return NextResponse.json({ error: '出荷済みの明細は削除できません' }, { status: 409 })
  }
  if (item.price_status === 'confirmed' || orderStatus === 'invoiced') {
    return NextResponse.json({ error: '請求確定済みのため削除できません' }, { status: 409 })
  }

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
