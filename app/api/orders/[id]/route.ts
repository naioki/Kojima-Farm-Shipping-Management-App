import { NextResponse } from 'next/server'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { writeAudit } from '@/lib/audit/log'

export const runtime = 'nodejs'

/**
 * 受注（注文）の削除（admin のみ・誤登録の取消）。
 * 安全ガード：請求確定済み・出荷済み明細を含む注文は削除不可（履歴/税務保護・tax.md）。
 * 明細→注文の順で物理削除し、操作は audit_log に記録する。紐づく収穫タスクは FK CASCADE で消える。
 */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const supabase = createClient()
  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).maybeSingle()
  if (profile?.role !== 'admin') {
    return NextResponse.json({ error: '受注の削除は管理者のみです' }, { status: 403 })
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

  // 税務・履歴保護：請求済み／出荷済み／価格確定済みは削除不可
  if (order.status === 'invoiced') {
    return NextResponse.json({ error: '請求済みの受注は削除できません' }, { status: 409 })
  }
  if (items.some((it) => it.field_status === 'shipped' || it.shipped_at != null)) {
    return NextResponse.json({ error: '出荷済みの明細を含むため削除できません' }, { status: 409 })
  }
  if (items.some((it) => it.price_status === 'confirmed')) {
    return NextResponse.json({ error: '請求確定済みの明細を含むため削除できません' }, { status: 409 })
  }

  // 明細 → 注文の順で削除
  const { error: itemsErr } = await admin.from('order_items').delete().eq('order_id', params.id)
  if (itemsErr) return NextResponse.json({ error: itemsErr.message }, { status: 500 })
  const { error: orderErr } = await admin.from('orders').delete().eq('id', params.id)
  if (orderErr) return NextResponse.json({ error: orderErr.message }, { status: 500 })

  // 監査（埋め込んだ明細配列を除いたスナップショット＋件数）
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
