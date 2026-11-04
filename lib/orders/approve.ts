import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'
import { writeAudit } from '@/lib/audit/log'
import { writeDroppingMissingColumns } from '@/lib/supabase/missing-column'
import { shiftDateStr } from '@/lib/dates'
import { getSetting } from '@/lib/settings'
import { getStaffFeatures } from '@/lib/field/features'
import { decideReceiptApproval, parseThreshold } from '@/lib/ingestion/auto-approve'
import { foldKana } from '@/lib/normalize/kana'

type AdminClient = SupabaseClient<Database>

export interface ApproveOrderInput {
  orderId: string
  deliveryDate?: string
  destinationId?: string
  role: 'admin' | 'staff'
  userId: string
}

export type ApproveOrderResult =
  | { ok: true; tasksCreated: number; deliveryDate: string; mergedIntoOrderId?: string }
  | { ok: false; status: number; error: string; reason?: string }

/**
 * 注文承認（pending_review → approved）の中核ロジック。
 * - #36: 同一 (customer_id, destination_id, delivery_date) に既に承認済（approved/shipped）の注文が存在する場合、
 *   カードが2枚に分裂しないよう既存注文へ明細を自動統合し、重複注文シェルをクリーンアップする。
 */
export async function approveOrder(
  admin: AdminClient,
  input: ApproveOrderInput,
): Promise<ApproveOrderResult> {
  const { orderId, role, userId } = input

  const { data: order, error: orderErr } = await admin
    .from('orders')
    .select('id, customer_id, status, delivery_date, destination_id, note')
    .eq('id', orderId)
    .maybeSingle()
  if (orderErr) return { ok: false, status: 500, error: orderErr.message }
  if (!order) return { ok: false, status: 404, error: '注文が見つかりません' }
  if (order.status !== 'pending_review') {
    return { ok: false, status: 409, error: 'この注文は承認待ちではありません' }
  }

  const { data: items, error: itemsErr } = await admin
    .from('order_items')
    .select('id, product_id, product_name, quantity, confidence, pack_config_id, spec, container_type, has_card, line_note')
    .eq('order_id', order.id)
  if (itemsErr) return { ok: false, status: 500, error: itemsErr.message }

  const deliveryDate = input.deliveryDate ?? order.delivery_date
  if (!deliveryDate) {
    return { ok: false, status: 400, error: '納品日を確定してください' }
  }

  // 指定された納入先は、この注文の取引先のものに限る（他社の納入先を紐付けない）
  if (!order.destination_id && input.destinationId) {
    const { data: destRow, error: destErr } = await admin
      .from('delivery_destinations')
      .select('id')
      .eq('id', input.destinationId)
      .eq('customer_id', order.customer_id ?? '')
      .maybeSingle()
    if (destErr) return { ok: false, status: 500, error: `納入先の確認に失敗しました: ${destErr.message}` }
    if (!destRow) return { ok: false, status: 400, error: '指定された納入先はこの取引先のものではありません' }
  }

  let destinationId = order.destination_id ?? input.destinationId ?? null
  if (!destinationId && order.customer_id) {
    const { data: customerDests } = await admin
      .from('delivery_destinations')
      .select('id, code, full_name, aliases')
      .eq('customer_id', order.customer_id)
      .eq('is_active', true)

    if (customerDests && customerDests.length > 0) {
      if (customerDests.length === 1 && customerDests[0]) {
        destinationId = customerDests[0].id
      } else {
        const noteText = foldKana(
          `${order.note ?? ''} ${(items ?? []).map((it) => it.product_name).join(' ')}`
            .normalize('NFKC')
            .toLowerCase(),
        )
        const matched = customerDests.find((d) => {
          const cands = [d.code, d.full_name, ...(d.aliases ?? [])]
            .filter(Boolean)
            .map((s) => foldKana(s!.normalize('NFKC').toLowerCase()))
          return cands.some((c) => c && c.length >= 3 && noteText.includes(c))
        })
        if (matched) {
          destinationId = matched.id
        }
      }
    }
  }

  const productIds = [...new Set(items.map((it) => it.product_id).filter(Boolean))] as string[]
  if (productIds.length > 0) {
    const { data: packConfigs, error: packErr } = await admin
      .from('pack_configs')
      .select('id, product_id, customer_id')
      .in('product_id', productIds)
      .eq('is_active', true)
    if (packErr) return { ok: false, status: 500, error: `荷姿マスタの確認に失敗しました: ${packErr.message}` }
    for (const it of items) {
      if (it.pack_config_id || !it.product_id) continue
      const hasOption = (packConfigs ?? []).some(
        (pc) => pc.product_id === it.product_id && (pc.customer_id === order.customer_id || pc.customer_id === null),
      )
      if (hasOption) {
        return { ok: false, status: 400, error: `荷姿を選択してください（${it.product_name}）` }
      }
    }
  }

  if (role === 'staff') {
    const features = await getStaffFeatures()
    if (!features.approve) {
      return { ok: false, status: 403, error: 'スタッフの承認は許可されていません' }
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
      return {
        ok: false,
        status: 403,
        error: 'この注文はスタッフでは承認できません（管理者に依頼してください）',
        reason: decision.reason,
      }
    }
  }

  const harvestTaskDate = shiftDateStr(deliveryDate, -1)

  // 二重承認防止: pending_review のときだけ approved に切り替える（同時に2人が押しても1回だけ通る）。
  // 収穫タスクの日付と注文の納品日がずれないよう、承認に使った納品日を注文にも反映する。
  const updates: Record<string, unknown> = { status: 'approved' }
  if (order.delivery_date !== deliveryDate) {
    updates.delivery_date = deliveryDate
    updates.delivery_date_source = 'manual'
  }
  if (!order.destination_id && destinationId) {
    updates.destination_id = destinationId
  }
  const { data: claimed, error: updErr } = await admin
    .from('orders')
    .update(updates)
    .eq('id', order.id)
    .eq('status', 'pending_review')
    .select('id')
    .maybeSingle()
  if (updErr) return { ok: false, status: 500, error: updErr.message }
  if (!claimed) return { ok: false, status: 409, error: 'この注文は既に承認されたか、状態が変わりました。再読み込みしてください' }
  const revertClaim = async () => {
    const { error } = await admin
      .from('orders')
      .update({ status: 'pending_review', delivery_date: order.delivery_date, destination_id: order.destination_id })
      .eq('id', order.id)
    if (error) console.error('[approve] 承認の取り消しに失敗:', error.message)
  }

  // #36 既に同じ (customer_id, destination_id, delivery_date) の承認済み注文があるかチェックし、あれば統合する
  // ※ ただしサンプル注文（note に「サンプル」を含む場合）は別口のサンプル依頼または通常大口便と混ざらないよう自動統合しない
  const isCurrentSample = Boolean(order.note && order.note.includes('サンプル'))
  if (order.customer_id && !isCurrentSample) {
    let dupQuery = admin
      .from('orders')
      .select('id, note')
      .eq('customer_id', order.customer_id)
      .eq('delivery_date', deliveryDate)
      .in('status', ['approved', 'shipped'])
      .neq('id', order.id)
    dupQuery = destinationId ? dupQuery.eq('destination_id', destinationId) : dupQuery.is('destination_id', null)
    const { data: existingOrders } = await dupQuery.order('created_at', { ascending: false }).limit(1)
    const targetExistingOrder = (existingOrders ?? []).find((eo) => !(eo.note && eo.note.includes('サンプル')))

    if (targetExistingOrder) {
      const { data: existingItems } = await admin
        .from('order_items')
        .select('id, product_id, product_name, quantity, version, field_status, line_note, shipped_qty')
        .eq('order_id', targetExistingOrder.id)

      let tasksCreated = 0
      const mergeErrors: string[] = []
      const check = (label: string, r: { error: { message: string } | null }) => {
        if (r.error) mergeErrors.push(`${label}: ${r.error.message}`)
      }
      for (const it of items) {
        // 出荷済みの明細には統合しない（数量を上書きして「未着手」に戻すと出荷実績が消えるため）。
        // その場合は別行として既存注文に移す。
        const matchExisting = (existingItems ?? []).find(
          (ex) =>
            ex.field_status !== 'shipped' &&
            ((it.product_id && ex.product_id === it.product_id) ||
              (!it.product_id && ex.product_name === it.product_name)),
        )
        if (matchExisting) {
          // 追加FAX（丸ごと再送）は数量を「上書き」する。変更履歴は2か所に残す:
          //  - audit_log（旧値→新値。Undo で元に戻せる）
          //  - 明細メモ（現場カードに「数量変更:50→58P」と表示。通常の数量変更と同じ表記）
          const newQty = Number(it.quantity) || 0
          const oldQty = Number(matchExisting.quantity) || 0
          const qtyChanged = newQty !== oldQty
          const wasPacked = matchExisting.field_status === 'packed'
          const baseNote = (it.line_note ?? matchExisting.line_note ?? '')
            .split(/\s*\/\s*/)
            .filter((t: string) => t && !/^(?:数量変更:|🚨パック済|★?新規追加)/.test(t.trim()))
            .join(' / ')
          const changeToken = !qtyChanged
            ? null
            : wasPacked && newQty > oldQty
              ? `🚨パック済(${oldQty}P)→${newQty}P(+${newQty - oldQty}P追加必要)`
              : `数量変更:${oldQty}→${newQty}P`
          const nextLineNote = [changeToken, baseNote].filter(Boolean).join(' / ') || null
          const mergePatch: Record<string, unknown> = {
            quantity: newQty,
            quantity_raw: String(newQty),
            spec: it.spec ?? undefined,
            container_type: it.container_type ?? undefined,
            line_note: nextLineNote,
            version: (Number(matchExisting.version) || 1) + 1,
          }
          // 数量が変わったときだけ作業状態を戻す（同じ内容の再送で梱包済みの進捗を消さない）
          if (qtyChanged) {
            mergePatch.field_status = 'not_started'
            mergePatch.shipped_qty = wasPacked && newQty > oldQty ? oldQty : null
            mergePatch.snap_total_packs = oldQty
          }
          const updRes = await writeDroppingMissingColumns(mergePatch, (p) =>
            admin.from('order_items').update(p).eq('id', matchExisting.id),
          )
          check(`明細更新(${it.product_name})`, updRes)
          if (!updRes.error && qtyChanged) {
            await writeAudit(admin, {
              entityType: 'order_items',
              entityId: matchExisting.id,
              action: 'UPDATE',
              oldValues: {
                quantity: matchExisting.quantity,
                field_status: matchExisting.field_status,
                shipped_qty: matchExisting.shipped_qty,
                line_note: matchExisting.line_note,
              },
              newValues: {
                quantity: newQty,
                field_status: mergePatch.field_status,
                shipped_qty: mergePatch.shipped_qty,
                line_note: nextLineNote,
                reason: '追加FAX（再送）による数量上書き',
                merged_from_order_id: order.id,
              },
              userId,
            }).catch((e) => console.error('[approve] 統合の監査記録に失敗', e))
          }
          check(
            `収穫タスク更新(${it.product_name})`,
            await admin
              .from('harvest_tasks')
              .update({ required_qty: newQty, task_date: harvestTaskDate })
              .eq('order_item_id', matchExisting.id),
          )
          check(`重複明細削除(${it.product_name})`, await admin.from('order_items').delete().eq('id', it.id))
        } else {
          check(
            `明細移動(${it.product_name})`,
            await admin.from('order_items').update({ order_id: targetExistingOrder.id }).eq('id', it.id),
          )
          if (it.product_id) {
            const taskRes = await admin.from('harvest_tasks').insert({
              product_id: it.product_id,
              order_item_id: it.id,
              required_qty: it.quantity,
              task_date: harvestTaskDate,
            })
            check(`収穫タスク作成(${it.product_name})`, taskRes)
            if (!taskRes.error) tasksCreated++
          }
        }
      }

      if (mergeErrors.length > 0) {
        // 途中まで統合済みのため自動では巻き戻さない。元注文は残し、内容を返して人が確認できるようにする。
        console.error('[approve] 既存注文への統合で一部失敗:', mergeErrors)
        return {
          ok: false,
          status: 500,
          error: `既存注文への統合の一部に失敗しました（統合先: ${targetExistingOrder.id}）。注文内容を確認してください: ${mergeErrors.join(' / ')}`,
        }
      }

      try {
        await admin
          .from('order_receipts')
          .update({ order_id: targetExistingOrder.id, status: 'approved' })
          .eq('order_id', order.id)
      } catch {}

      const { error: delErr } = await admin.from('orders').delete().eq('id', order.id)
      if (delErr) console.error('[approve] 統合元の注文の削除に失敗:', delErr.message)

      try {
        await writeAudit(admin, {
          entityType: 'orders',
          entityId: targetExistingOrder.id,
          action: 'UPDATE',
          oldValues: { merged_from_order_id: order.id },
          newValues: { status: 'approved', approved_by: userId },
          userId,
        })
      } catch {}

      return { ok: true, tasksCreated, deliveryDate, mergedIntoOrderId: targetExistingOrder.id }
    }
  }

  // 既存の重複注文がない場合は、上で approved に切り替え済み。収穫タスクを生成する。
  const tasks = items
    .filter((it) => it.product_id)
    .map((it) => ({
      product_id: it.product_id!,
      order_item_id: it.id,
      required_qty: it.quantity,
      task_date: harvestTaskDate,
    }))
  if (tasks.length > 0) {
    const { error: taskErr } = await admin.from('harvest_tasks').insert(tasks)
    if (taskErr) {
      await revertClaim()
      return { ok: false, status: 500, error: `収穫タスクの生成に失敗: ${taskErr.message}` }
    }
  }

  try {
    await admin.from('order_receipts').update({ status: 'approved' }).eq('order_id', order.id)
  } catch (e) {
    console.error('[approve] order_receipts status update failed', e)
  }

  try {
    await writeAudit(admin, {
      entityType: 'orders',
      entityId: order.id,
      action: 'UPDATE',
      oldValues: { status: 'pending_review' },
      newValues: { status: 'approved', approved_by: userId },
      userId,
    })
  } catch (e) {
    console.error('[approve] audit write failed', e)
  }

  return { ok: true, tasksCreated: tasks.length, deliveryDate }
}
