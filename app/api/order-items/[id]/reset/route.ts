import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { fieldStatusResetSchema } from '@/types/database'
import { resetOneStep } from '@/lib/field/tap-loop'
import { writeAudit } from '@/lib/audit/log'
import { requireStaffApi } from '@/lib/auth/api-guard'

export const runtime = 'nodejs'

/**
 * field_status を1段だけ戻す（features.md §7）。
 * 通常タップ（前進）からは決して呼ばない。UI 側で確認ダイアログを挟んでから叩く。
 *   shipped → packed → not_started（一気に not_started へは戻さない）
 * shipped を抜けるときは出荷実績（shipped_at/shipped_qty）をクリアする。
 * 楽観ロック（version 一致時のみ更新）と監査記録は前進タップと同じ規約。
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const guard = await requireStaffApi()
  if (!guard.ok) return guard.response
  const user = guard.user

  const body = await req.json().catch(() => null)
  const parsed = fieldStatusResetSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid', detail: parsed.error.flatten() }, { status: 400 })
  }
  const supabase = createAdminClient()

  const { data: current, error: readErr } = await supabase
    .from('order_items')
    .select('*')
    .eq('id', params.id)
    .maybeSingle()
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 })
  if (!current) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const target = resetOneStep(current.field_status)
  if (target === current.field_status) {
    // not_started からは戻せない
    return NextResponse.json({ error: 'cannot_reset', current: current.field_status }, { status: 409 })
  }

  const updates: Record<string, unknown> = { field_status: target }
  if (current.field_status === 'shipped') {
    // 出荷済みを取り消す → 実績をクリア
    updates.shipped_at = null
    updates.shipped_qty = null
  }

  const { data: updated, error: updErr } = await supabase
    .from('order_items')
    .update({ ...updates, version: current.version + 1 })
    .eq('id', params.id)
    .select()
    .maybeSingle()
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })
  if (!updated) {
    return NextResponse.json({ error: 'conflict', currentVersion: current.version }, { status: 409 })
  }

  // shipped から戻した場合は orders.status と deliveries.status も planned/approved に整合させる（#9-08）
  if (current.field_status === 'shipped' && current.order_id) {
    try {
      const { data: ord } = await supabase
        .from('orders')
        .select('id, customer_id, destination_id, delivery_date, status')
        .eq('id', current.order_id)
        .maybeSingle()
      if (ord) {
        if (ord.status === 'shipped') {
          await supabase.from('orders').update({ status: 'approved' }).eq('id', ord.id)
        }
        let delQuery = supabase
          .from('deliveries')
          .update({ status: 'planned', checked_at: null, checked_by: null })
          .eq('delivery_date', ord.delivery_date)
          .eq('customer_id', ord.customer_id)
        delQuery = ord.destination_id ? delQuery.eq('destination_id', ord.destination_id) : delQuery.is('destination_id', null)
        await delQuery
      }
    } catch {}
  }

  await writeAudit(supabase, {
    entityType: 'order_items',
    entityId: params.id,
    action: 'undo',
    oldValues: current,
    newValues: updated,
    userId: user.id,
  })

  return NextResponse.json({ item: updated })
}
