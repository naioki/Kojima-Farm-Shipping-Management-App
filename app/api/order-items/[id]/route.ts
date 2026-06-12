import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { orderItemPatchSchema, fieldStatusPatchSchema } from '@/types/database'
import { writeAudit } from '@/lib/audit/log'
import { nextFieldStatus } from '@/lib/field/tap-loop'

export const runtime = 'nodejs'

// quantity/価格変更（admin）と field_status タップ（圃場）を同じ PATCH で受ける。
const patchSchema = z.union([orderItemPatchSchema, fieldStatusPatchSchema])

/**
 * 数量変更・タップ更新（features.md §6/§7）。楽観ロック必須。
 *   WHERE id=$ AND version=$expected で更新。0件＝競合 → 409（UI再読込促す）。
 *   変更は audit_log に記録し version++。
 */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const parsed = patchSchema.safeParse(body)
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
