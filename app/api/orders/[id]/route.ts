import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { writeAudit } from '@/lib/audit/log'
import { shiftDateStr } from '@/lib/dates'
import { requireAdminApi, requireStaffApi } from '@/lib/auth/api-guard'
import { noteSideEffectFailure, runSideEffect, withWarnings } from '@/lib/api/side-effects'

export const runtime = 'nodejs'

const orderPatchSchema = z.object({
  delivery_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  destination_id: z.string().uuid().nullish(),
  note: z.string().nullish(),
  status: z.enum(['pending_review', 'approved', 'shipped', 'invoiced', 'cancelled']).optional(),
})

/**
 * 受注ヘッダー（納品日・納入先・備考・ステータス）の更新（#38 注文詳細画面からのインライン編集用）。
 */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const guard = await requireStaffApi()
  if (!guard.ok) return guard.response
  const user = guard.user
  if (!z.string().uuid().safeParse(params.id).success) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 })
  }

  const admin = createAdminClient()

  const body = await req.json().catch(() => null)
  const parsed = orderPatchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid', detail: parsed.error.flatten() }, { status: 400 })
  }

  const { data: current, error: readErr } = await admin
    .from('orders')
    .select('*')
    .eq('id', params.id)
    .maybeSingle()
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 })
  if (!current) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const updates: Record<string, unknown> = {}
  const d = parsed.data
  if (d.delivery_date !== undefined) {
    updates.delivery_date = d.delivery_date
    updates.delivery_date_source = 'manual'
  }
  if (d.destination_id !== undefined) updates.destination_id = d.destination_id
  if (d.note !== undefined) updates.note = d.note?.trim() || null
  if (d.status !== undefined) updates.status = d.status

  const { data: updated, error: updErr } = await admin
    .from('orders')
    .update(updates)
    .eq('id', params.id)
    .select()
    .single()
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

  // 納品日が変更された場合は紐づく harvest_tasks の task_date（出荷日前日）も自動同期（付随更新。失敗は警告で返す）
  const warnings: string[] = []
  if (d.delivery_date && d.delivery_date !== current.delivery_date) {
    const HARVEST_DATE_WARNING = '納品日は変更しましたが、収穫・パックの作業日を移せませんでした。収穫一覧の日付を確認してください'
    const taskDate = shiftDateStr(d.delivery_date, -1)
    const { data: items, error: itemsErr } = await admin.from('order_items').select('id').eq('order_id', params.id)
    if (itemsErr) {
      noteSideEffectFailure(warnings, '[api/orders/[id]] harvest_tasks 日付同期用の明細読み込みに失敗', itemsErr, HARVEST_DATE_WARNING)
    }
    const itemIds = (items ?? []).map((i) => i.id)
    if (itemIds.length > 0) {
      await runSideEffect(warnings, '[api/orders/[id]] harvest_tasks の日付同期に失敗', HARVEST_DATE_WARNING, () =>
        admin.from('harvest_tasks').update({ task_date: taskDate }).in('order_item_id', itemIds),
      )
    }
  }

  await writeAudit(admin, {
    entityType: 'orders',
    entityId: params.id,
    action: 'UPDATE',
    oldValues: current,
    newValues: updated,
    userId: user.id,
  })

  return NextResponse.json(withWarnings({ order: updated }, warnings))
}

/**
 * 受注（注文）の削除（admin のみ・誤登録の取消）。
 */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdminApi('受注の削除は管理者のみです')
  if (!guard.ok) return guard.response
  const user = guard.user
  if (!z.string().uuid().safeParse(params.id).success) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: order, error: readErr } = await admin
    .from('orders')
    .select('*, order_items(id, field_status, shipped_at, price_status)')
    .eq('id', params.id)
    .maybeSingle()
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 })
  if (!order) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const items = (order.order_items ?? []) as { field_status: string | null; shipped_at: string | null; price_status: string | null }[]

  if (order.status === 'invoiced') {
    return NextResponse.json({ error: '請求済みの受注は削除できません' }, { status: 409 })
  }
  if (items.some((it) => it.field_status === 'shipped' || it.shipped_at != null)) {
    return NextResponse.json({ error: '出荷済みの明細を含むため削除できません' }, { status: 409 })
  }
  if (items.some((it) => it.price_status === 'confirmed')) {
    return NextResponse.json({ error: '請求確定済みの明細を含むため削除できません' }, { status: 409 })
  }

  const { error: unlinkErr } = await admin
    .from('order_receipts')
    .update({ order_id: null })
    .eq('order_id', params.id)
  if (unlinkErr) return NextResponse.json({ error: unlinkErr.message }, { status: 500 })

  const { error: itemsErr } = await admin.from('order_items').delete().eq('order_id', params.id)
  if (itemsErr) return NextResponse.json({ error: itemsErr.message }, { status: 500 })
  const { error: orderErr } = await admin.from('orders').delete().eq('id', params.id)
  if (orderErr) return NextResponse.json({ error: orderErr.message }, { status: 500 })

  const snapshot: Record<string, unknown> = { ...(order as Record<string, unknown>) }
  delete snapshot.order_items
  snapshot.deleted_item_count = items.length
  await writeAudit(admin, {
    entityType: 'orders',
    entityId: params.id,
    action: 'DELETE',
    oldValues: snapshot,
    userId: user.id,
  })

  return NextResponse.json({ deleted: true })
}
