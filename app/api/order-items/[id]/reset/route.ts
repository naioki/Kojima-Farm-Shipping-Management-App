import { NextResponse } from 'next/server'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { fieldStatusResetSchema } from '@/types/database'
import { resetOneStep } from '@/lib/field/tap-loop'
import { writeAudit } from '@/lib/audit/log'

export const runtime = 'nodejs'

/**
 * field_status を1段だけ戻す（features.md §7）。
 * 通常タップ（前進）からは決して呼ばない。UI 側で確認ダイアログを挟んでから叩く。
 *   shipped → packed → not_started（一気に not_started へは戻さない）
 * shipped を抜けるときは出荷実績（shipped_at/shipped_qty）をクリアする。
 * 楽観ロック（version 一致時のみ更新）と監査記録は前進タップと同じ規約。
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const parsed = fieldStatusResetSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid', detail: parsed.error.flatten() }, { status: 400 })
  }
  const supabase = createClient()

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
    .eq('version', parsed.data.version)
    .select()
    .maybeSingle()
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })
  if (!updated) {
    return NextResponse.json({ error: 'conflict', currentVersion: current.version }, { status: 409 })
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
