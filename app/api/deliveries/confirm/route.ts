import { NextResponse } from 'next/server'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { deliveryConfirmSchema, type DeliveryStatus } from '@/types/database'

export const runtime = 'nodejs'

/** 許可される状態遷移（前進のみ。もどすは revert で1段階ずつ・タップループ安全版と同方針） */
const FORWARD: Record<'loaded' | 'delivered', DeliveryStatus> = {
  loaded: 'planned', // planned → loaded
  delivered: 'loaded', // loaded → delivered
}
const REVERT: Partial<Record<DeliveryStatus, DeliveryStatus>> = {
  delivered: 'loaded',
  loaded: 'planned',
}

/**
 * 配送チェックの記録（配送 Phase 1）。
 *   - 配送単位（取引先×納入先×配送日）の deliveries 行を upsert し、状態を遷移させる
 *   - loaded: 出発前ダブルチェックOK（checked_by/at を記録）
 *   - delivered: 配送完了（delivered_by/at を記録。荷造り場で完結する運用）
 *   - revert: 誤タップの1段階もどし（記録者情報もクリア）
 *   - すべて delivery_events に append-only で記録（クレーム原因分析・誤配送0%の監査証跡）
 */
export async function POST(req: Request) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const parsed = deliveryConfirmSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid', detail: parsed.error.flatten() }, { status: 400 })
  }
  const { delivery_date, customer_id, destination_id, action, items } = parsed.data
  const supabase = createClient()

  // 配送単位の行を取得（無ければ planned で作成）。UNIQUE(uq_delivery_unit) が二重作成を防ぐ。
  let query = supabase
    .from('deliveries')
    .select('id, status')
    .eq('delivery_date', delivery_date)
    .eq('customer_id', customer_id)
  query = destination_id ? query.eq('destination_id', destination_id) : query.is('destination_id', null)
  const { data: existing, error: findErr } = await query.maybeSingle()
  if (findErr) return NextResponse.json({ error: findErr.message }, { status: 500 })

  let deliveryId = existing?.id
  let currentStatus: DeliveryStatus = (existing?.status as DeliveryStatus) ?? 'planned'
  if (!deliveryId) {
    const { data: created, error: createErr } = await supabase
      .from('deliveries')
      .insert({ delivery_date, customer_id, destination_id })
      .select('id, status')
      .single()
    if (createErr) return NextResponse.json({ error: createErr.message }, { status: 500 })
    deliveryId = created.id
    currentStatus = created.status as DeliveryStatus
  }

  // 遷移の決定と検証（画面が古い場合は 409 で再読込を促す。楽観ロックと同方針）
  const now = new Date().toISOString()
  let nextStatus: DeliveryStatus
  const updates: Record<string, unknown> = {}
  if (action === 'revert') {
    const back = REVERT[currentStatus]
    if (!back) return NextResponse.json({ error: 'conflict', current: currentStatus }, { status: 409 })
    nextStatus = back
    if (currentStatus === 'delivered') Object.assign(updates, { delivered_by: null, delivered_at: null })
    else Object.assign(updates, { checked_by: null, checked_at: null })
  } else {
    if (currentStatus !== FORWARD[action]) {
      return NextResponse.json({ error: 'conflict', current: currentStatus }, { status: 409 })
    }
    nextStatus = action
    if (action === 'loaded') Object.assign(updates, { checked_by: user.id, checked_at: now })
    else Object.assign(updates, { delivered_by: user.id, delivered_at: now })
  }
  updates.status = nextStatus

  // 状態の同時更新に耐えるよう WHERE status=現在値 で更新（0件なら競合）
  const { data: updated, error: updErr } = await supabase
    .from('deliveries')
    .update(updates)
    .eq('id', deliveryId)
    .eq('status', currentStatus)
    .select('id, status')
    .maybeSingle()
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })
  if (!updated) return NextResponse.json({ error: 'conflict' }, { status: 409 })

  // append-only イベント（明細スナップショット付き。誤配送クレーム時の一次証跡）
  const { error: evErr } = await supabase.from('delivery_events').insert({
    delivery_id: deliveryId,
    actor: user.id,
    action,
    before: { status: currentStatus },
    after: { status: nextStatus, items: items ?? null },
  })
  if (evErr) return NextResponse.json({ error: evErr.message }, { status: 500 })

  return NextResponse.json({ id: deliveryId, status: nextStatus })
}
