import 'server-only'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { writeAudit } from '@/lib/audit/log'
import { getSetting } from '@/lib/settings'
import { getStaffFeatures } from '@/lib/field/features'
import { decideReceiptApproval, parseThreshold } from '@/lib/ingestion/auto-approve'

export const runtime = 'nodejs'

const bodySchema = z.object({
  /** 納品日が未確定なら承認時にここで確定（harvest_tasks.task_date に必須）。 */
  delivery_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

/**
 * 注文の承認（pending_review → approved）。
 * 承認すると各明細から収穫タスク(harvest_tasks)を生成する。変更は audit_log に記録。
 * 権限:
 *   - 管理者: 常に可
 *   - スタッフ: 設定 STAFF_CAN_APPROVE が ON かつ「取引先一致・納品日確定・全明細が高確信」のみ可
 *     （低確信・未紐付け・納品日未定は管理者専用。決して安全性を緩めない）
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 })

  const supabase = createClient()
  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).maybeSingle()
  const role = profile?.role
  if (role !== 'admin' && role !== 'staff') {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 })
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: '入力値が不正です' }, { status: 400 })
  }

  const admin = createAdminClient()

  // 対象注文＋明細を取得
  const { data: order, error: orderErr } = await admin
    .from('orders')
    .select('id, customer_id, status, delivery_date')
    .eq('id', params.id)
    .maybeSingle()
  if (orderErr) return NextResponse.json({ error: orderErr.message }, { status: 500 })
  if (!order) return NextResponse.json({ error: '注文が見つかりません' }, { status: 404 })
  if (order.status !== 'pending_review') {
    return NextResponse.json({ error: 'この注文は承認待ちではありません' }, { status: 409 })
  }

  const { data: items, error: itemsErr } = await admin
    .from('order_items')
    .select('id, product_id, quantity, confidence')
    .eq('order_id', order.id)
  if (itemsErr) return NextResponse.json({ error: itemsErr.message }, { status: 500 })
  if (!items || items.length === 0) {
    return NextResponse.json({ error: '明細がありません' }, { status: 400 })
  }

  // 納品日（body で確定可。harvest_tasks.task_date に必須）
  const deliveryDate = parsed.data.delivery_date ?? order.delivery_date
  if (!deliveryDate) {
    return NextResponse.json({ error: '納品日を確定してください' }, { status: 400 })
  }

  // スタッフは高確信・取引先一致・納品日確定のときだけ承認可
  if (role === 'staff') {
    const features = await getStaffFeatures()
    if (!features.approve) {
      return NextResponse.json({ error: 'スタッフの承認は許可されていません' }, { status: 403 })
    }
    const threshold = parseThreshold(await getSetting('AUTO_APPROVE_THRESHOLD'))
    const decision = decideReceiptApproval({
      enabled: true,
      threshold,
      items: items.map((it) => ({ confidence: it.confidence, productMatched: Boolean(it.product_id) })),
      customerMatched: Boolean(order.customer_id),
      deliveryDateKnown: Boolean(deliveryDate),
    })
    if (decision.action !== 'auto_approve') {
      return NextResponse.json(
        { error: 'この注文はスタッフでは承認できません（管理者に依頼してください）', reason: decision.reason },
        { status: 403 },
      )
    }
  }

  // 承認：status 更新（＋必要なら delivery_date 確定）
  const updates: Record<string, unknown> = { status: 'approved' }
  if (!order.delivery_date && parsed.data.delivery_date) {
    updates.delivery_date = parsed.data.delivery_date
    updates.delivery_date_source = 'manual'
  }
  const { error: updErr } = await admin.from('orders').update(updates).eq('id', order.id)
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

  // 各明細 → 収穫タスク生成（必要数＝注文数、task_date＝納品日）
  const tasks = items.map((it) => ({
    product_id: it.product_id,
    order_item_id: it.id,
    required_qty: it.quantity,
    task_date: deliveryDate,
  }))
  const { error: taskErr } = await admin.from('harvest_tasks').insert(tasks)
  if (taskErr) {
    // タスク生成に失敗したら承認を巻き戻す（中途半端な状態を残さない）
    await admin.from('orders').update({ status: 'pending_review' }).eq('id', order.id)
    return NextResponse.json({ error: `収穫タスクの生成に失敗: ${taskErr.message}` }, { status: 500 })
  }

  // 監査記録（best-effort で全体は止めない）
  try {
    await writeAudit(admin, {
      entityType: 'orders',
      entityId: order.id,
      action: 'UPDATE',
      oldValues: { status: 'pending_review' },
      newValues: { status: 'approved', approved_by: user.id },
      userId: user.id,
    })
  } catch (e) {
    console.error('[approve] audit write failed', e)
  }

  return NextResponse.json({ ok: true, tasksCreated: tasks.length })
}
