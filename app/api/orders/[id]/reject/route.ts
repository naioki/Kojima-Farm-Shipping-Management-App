import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { writeAudit } from '@/lib/audit/log'

export const runtime = 'nodejs'

const rejectSchema = z.object({
  reason: z.string().max(200).optional(),
})

/**
 * 承認待ち注文の「承認しない（却下・キャンセル）」API。
 * 受信ボックスで不要な注文や誤判定、重複FAXを承認せずに却下する。
 * orders.status を 'cancelled' に更新し、紐づく order_receipts を 'dismissed' に更新する。
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  if (!z.string().uuid().safeParse(params.id).success) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 })
  }

  const supabase = createClient()
  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()

  if (profile?.role !== 'admin' && profile?.role !== 'staff') {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const parsed = rejectSchema.safeParse(body)
  const reasonText = parsed.success && parsed.data.reason ? parsed.data.reason : '未指定（手動却下）'

  const admin = createAdminClient()
  const { data: order, error: readErr } = await admin
    .from('orders')
    .select('id, status, customer_id, note')
    .eq('id', params.id)
    .maybeSingle()

  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 })
  if (!order) return NextResponse.json({ error: '注文が見つかりません' }, { status: 404 })

  if (order.status === 'invoiced' || order.status === 'shipped') {
    return NextResponse.json({ error: '既に出荷または請求済みの注文は却下できません' }, { status: 409 })
  }

  const nowStr = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })
  const appendNote = `【却下: ${reasonText} (${nowStr})】`
  const newNote = order.note ? `${order.note}\n${appendNote}` : appendNote

  // 1. orders テーブルの status を cancelled に更新
  const { error: orderUpdateErr } = await admin
    .from('orders')
    .update({
      status: 'cancelled',
      note: newNote,
    })
    .eq('id', params.id)

  if (orderUpdateErr) return NextResponse.json({ error: orderUpdateErr.message }, { status: 500 })

  // 2. 紐づく order_receipts を dismissed に更新（受信ボックスに残らないようにする）
  await admin
    .from('order_receipts')
    .update({ status: 'dismissed' })
    .eq('order_id', params.id)

  // 3. 監査ログ
  await writeAudit(admin, {
    entityType: 'orders',
    entityId: params.id,
    action: 'UPDATE',
    oldValues: { status: order.status, note: order.note },
    newValues: { status: 'cancelled', note: newNote, reject_reason: reasonText },
    userId: user.id,
  })

  return NextResponse.json({ ok: true, orderId: params.id })
}
