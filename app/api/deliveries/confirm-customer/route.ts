import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import type { DeliveryStatus } from '@/types/database'
import { requireStaffApi } from '@/lib/auth/api-guard'
import { noteSideEffectFailure, runSideEffect, withWarnings } from '@/lib/api/side-effects'

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
  const guard = await requireStaffApi('forbidden')
  if (!guard.ok) return guard.response
  const user = guard.user

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

  const warnings: string[] = []
  const SYNC_WARNING =
    '積込状態は保存しましたが、出荷状況（パック・出荷の表示）の同期に失敗しました。画面を読み込み直して確認してください'
  /** 本体（deliveries）の読み書きに失敗したときの 500。先に処理した納品先は更新済みのことがある。 */
  const mainFailure = (logTag: string, err: unknown, doneCount: number) => {
    noteSideEffectFailure(null, logTag, err)
    const partial = doneCount > 0 ? '（一部の納品先は更新済みの可能性があります）' : ''
    return NextResponse.json(
      { error: `積込状態を保存できませんでした${partial}。画面を読み込み直してからもう一度お試しください` },
      { status: 500 },
    )
  }

  let done = 0
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
    if (findErr) return mainFailure('[confirm-customer] deliveries の読み込みに失敗', findErr, done)

    const existing = existingRows?.[0]
    let deliveryId = existing?.id
    if (!deliveryId) {
      const { data: created, error: createErr } = await admin
        .from('deliveries')
        .insert({ delivery_date, customer_id, destination_id: destId, status: 'planned' })
        .select('id, status')
        .single()
      if (createErr || !created) {
        return mainFailure('[confirm-customer] deliveries の作成に失敗', createErr ?? 'no row', done)
      }
      deliveryId = created.id
    }

    const nextStatus: DeliveryStatus = action === 'loaded' ? 'loaded' : 'planned'
    const updates: Record<string, unknown> = {
      status: nextStatus,
      checked_by: action === 'loaded' ? user.id : null,
      checked_at: action === 'loaded' ? now : null,
    }

    // 同一 (delivery_date, customer_id, destination_id) の全レコードを一括同期（本体）
    let updQuery = admin
      .from('deliveries')
      .update(updates)
      .eq('delivery_date', delivery_date)
      .eq('customer_id', customer_id)
    updQuery = destId ? updQuery.eq('destination_id', destId) : updQuery.is('destination_id', null)
    const { error: updErr } = await updQuery
    if (updErr) return mainFailure('[confirm-customer] deliveries の更新に失敗', updErr, done)
    done++

    // 監査イベント追記（記録のみ。現場は対処できないのでサーバーログに残す）
    await runSideEffect(null, '[confirm-customer] delivery_events の記録に失敗', undefined, () =>
      admin.from('delivery_events').insert({
        delivery_id: deliveryId,
        actor: user.id,
        action: action === 'loaded' ? 'loaded' : 'revert',
        before: { status: existing?.status ?? 'planned' },
        after: { status: nextStatus },
      }),
    )

    // 収穫・パックボード / 週間マトリックスとの完全連動（付随更新。失敗は警告で返す）：
    // 積込OK ('loaded') 時は該当する order_items の field_status を 'shipped' へ、
    // 戻し ('revert') 時は 'packed' へ同期する（手動変更時も version を +1 する）
    let ordQuery = admin
      .from('orders')
      .select('id')
      .eq('customer_id', customer_id)
      .eq('delivery_date', delivery_date)
      .in('status', ['approved', 'shipped', 'invoiced'])
    ordQuery = destId ? ordQuery.eq('destination_id', destId) : ordQuery.is('destination_id', null)
    const { data: matchingOrders, error: ordErr } = await ordQuery
    if (ordErr) {
      noteSideEffectFailure(warnings, '[confirm-customer] 同期対象の orders の読み込みに失敗', ordErr, SYNC_WARNING)
      continue
    }
    const ordIds = (matchingOrders ?? []).map((o) => o.id)
    if (ordIds.length === 0) continue
    const targetFieldStatus = action === 'loaded' ? 'shipped' : 'packed'
    const { data: itemsToSync, error: itemsErr } = await admin
      .from('order_items')
      .select('id, version, field_status')
      .in('order_id', ordIds)
    if (itemsErr) {
      noteSideEffectFailure(warnings, '[confirm-customer] 同期対象の order_items の読み込みに失敗', itemsErr, SYNC_WARNING)
    }
    for (const it of itemsToSync ?? []) {
      if (action === 'loaded' && it.field_status !== 'shipped') {
        await runSideEffect(warnings, '[confirm-customer] order_items.field_status の同期に失敗', SYNC_WARNING, () =>
          admin
            .from('order_items')
            .update({ field_status: targetFieldStatus, version: (Number(it.version) || 1) + 1 })
            .eq('id', it.id),
        )
      } else if (action === 'revert' && it.field_status === 'shipped') {
        await runSideEffect(warnings, '[confirm-customer] order_items.field_status の戻しに失敗', SYNC_WARNING, () =>
          admin
            .from('order_items')
            .update({ field_status: 'packed', shipped_at: null, version: (Number(it.version) || 1) + 1 })
            .eq('id', it.id),
        )
      }
    }
    // #23 orders.status も積込完了時は shipped、戻し時は approved（invoiced以外）へ整合同期
    if (action === 'loaded') {
      await runSideEffect(warnings, '[confirm-customer] orders.status の同期に失敗', SYNC_WARNING, () =>
        admin.from('orders').update({ status: 'shipped' }).in('id', ordIds).eq('status', 'approved'),
      )
    } else {
      await runSideEffect(warnings, '[confirm-customer] orders.status の戻しに失敗', SYNC_WARNING, () =>
        admin.from('orders').update({ status: 'approved' }).in('id', ordIds).eq('status', 'shipped'),
      )
    }
  }

  return NextResponse.json(withWarnings({ ok: true, action }, warnings))
}
