import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { noteSideEffectFailure, runSideEffect, withWarnings, writeAuditAfterSuccess } from '@/lib/api/side-effects'
import { requireStaffApi } from '@/lib/auth/api-guard'

export const runtime = 'nodejs'

const rejectSchema = z.object({
  reason: z.string().max(200).optional(),
})

/**
 * 承認待ち注文の「承認しない（却下・キャンセル）」API。
 * 受信ボックスで不要な注文や誤判定、重複FAXを承認せずに却下する。
 * orders.status を 'cancelled' に更新し、紐づく order_receipts を 'dismissed' に更新する。
 * 紐づく harvest_tasks（収穫タスク）もクリーンアップして現場のゴースト作業を防止する。
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const guard = await requireStaffApi()
  if (!guard.ok) return guard.response
  const user = guard.user
  if (!z.string().uuid().safeParse(params.id).success) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 })
  }

  const admin = createAdminClient()

  const body = await req.json().catch(() => ({}))
  const parsed = rejectSchema.safeParse(body)
  const reasonText = parsed.success && parsed.data.reason ? parsed.data.reason : '未指定（手動却下）'

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

  // 2〜4 は本体（注文の却下）成功後の付随更新。失敗しても 500 にせず警告で返す
  const warnings: string[] = []

  // 2. 収穫タスクのクリーンアップ（現場のゴースト収穫作業を防止）
  const { data: cancelledItems, error: itemsErr } = await admin
    .from('order_items')
    .select('id')
    .eq('order_id', params.id)
  const HARVEST_WARNING =
    '注文は却下しましたが、収穫・パックの作業一覧から外せませんでした。収穫一覧に残っていないか確認してください'
  if (itemsErr) {
    noteSideEffectFailure(warnings, '[reject] 収穫タスク削除対象の order_items の読み込みに失敗', itemsErr, HARVEST_WARNING)
  } else if (cancelledItems && cancelledItems.length > 0) {
    await runSideEffect(warnings, '[reject] harvest_tasks の削除に失敗', HARVEST_WARNING, () =>
      admin
        .from('harvest_tasks')
        .delete()
        .in('order_item_id', cancelledItems.map((i) => i.id)),
    )
  }

  // 3. 紐づく order_receipts を dismissed に更新（受信ボックスに残らないようにする）
  await runSideEffect(
    warnings,
    '[reject] order_receipts を dismissed に更新できませんでした',
    '注文は却下しましたが、受信箱の表示を片付けられませんでした。受信箱に残っている場合は手動で片付けてください',
    () => admin.from('order_receipts').update({ status: 'dismissed' }).eq('order_id', params.id),
  )

  // 4. 監査ログ
  await writeAuditAfterSuccess(
    admin,
    {
      entityType: 'orders',
      entityId: params.id,
      action: 'UPDATE',
      oldValues: { status: order.status, note: order.note },
      newValues: { status: 'cancelled', note: newNote, reject_reason: reasonText },
      userId: user.id,
    },
    '[reject] 監査ログの記録に失敗',
  )

  return NextResponse.json(withWarnings({ ok: true, orderId: params.id }, warnings))
}
