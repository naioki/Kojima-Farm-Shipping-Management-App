import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthedUser } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isStaffUser } from '@/lib/auth/is-staff-user'
import type { DeliveryStatus } from '@/types/database'

export const runtime = 'nodejs'

const schema = z.object({
  delivery_date: z.string(),
  customer_id: z.string().uuid(),
  destination_ids: z.array(z.string().uuid().nullable()),
  action: z.enum(['loaded', 'revert']),
})

/**
 * 取引先単位の一括積込確認API（手書き伝票思想の取引先ワンボックス集約用）。
 * 指定した取引先の全納品先 deliveries レコードを一括で loaded（積込OK）または planned（戻し）に更新する。
 */
export async function POST(req: Request) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!(await isStaffUser(user.id))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid', detail: parsed.error.flatten() }, { status: 400 })
  }

  const { delivery_date, customer_id, destination_ids, action } = parsed.data
  const admin = createAdminClient()
  const now = new Date().toISOString()

  // 納品先リストが空の場合は [null]（単一配送）として扱う。重複キーを排除して無駄なクエリを防ぐ
  const rawTargets = destination_ids.length > 0 ? destination_ids : [null]
  const targetDestIds = Array.from(new Set(rawTargets))

  for (const destId of targetDestIds) {
    // 既存行を取得または作成（同一キーで複数行ある場合も limit(1) で確実にヒットさせエラーを防ぐ）
    let query = admin
      .from('deliveries')
      .select('id, status')
      .eq('delivery_date', delivery_date)
      .eq('customer_id', customer_id)
    query = destId ? query.eq('destination_id', destId) : query.is('destination_id', null)

    const { data: existingRows, error: findErr } = await query
      .order('created_at', { ascending: false })
      .limit(1)
    if (findErr) continue

    const existing = existingRows?.[0]
    let deliveryId = existing?.id
    if (!deliveryId) {
      const { data: created, error: createErr } = await admin
        .from('deliveries')
        .insert({ delivery_date, customer_id, destination_id: destId, status: 'planned' })
        .select('id, status')
        .single()
      if (createErr || !created) continue
      deliveryId = created.id
    }

    const nextStatus: DeliveryStatus = action === 'loaded' ? 'loaded' : 'planned'
    const updates: Record<string, unknown> = {
      status: nextStatus,
      checked_by: action === 'loaded' ? user.id : null,
      checked_at: action === 'loaded' ? now : null,
    }

    // 同一 (delivery_date, customer_id, destination_id) の全レコードを一括同期
    let updQuery = admin
      .from('deliveries')
      .update(updates)
      .eq('delivery_date', delivery_date)
      .eq('customer_id', customer_id)
    updQuery = destId ? updQuery.eq('destination_id', destId) : updQuery.is('destination_id', null)
    await updQuery

    // 監査イベント追記
    await admin.from('delivery_events').insert({
      delivery_id: deliveryId,
      actor: user.id,
      action: action === 'loaded' ? 'loaded' : 'revert',
      before: { status: existing?.status ?? 'planned' },
      after: { status: nextStatus },
    })
  }

  return NextResponse.json({ ok: true, action })
}
