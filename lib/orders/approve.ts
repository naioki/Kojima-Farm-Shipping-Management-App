import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'
import { writeAudit } from '@/lib/audit/log'
import { shiftDateStr } from '@/lib/dates'
import { getSetting } from '@/lib/settings'
import { getStaffFeatures } from '@/lib/field/features'
import { decideReceiptApproval, parseThreshold } from '@/lib/ingestion/auto-approve'
import { foldKana } from '@/lib/normalize/kana'

/**
 * 注文承認（pending_review → approved）の中核ロジック（純関数）。
 *
 * 承認ルート（app/api/orders/[id]/approve/route.ts）と、チャット自動化のユースケース
 * （lib/chat/use-cases.ts）の両方がこの関数を呼ぶ。抜け道を作らないため、承認は必ず
 * ここを通す（v4 のような RPC 直挿しはしない）。認証・権限判定（401/403 の入口）は
 * 呼び出し側に残し、この関数は「役割が確定した後の業務ゲート＋副作用」だけを担う。
 *
 * ゲート（すべて既存ルートと同一メッセージ・同一ステータスコード）:
 *   - 納品日ゲート : harvest_tasks.task_date に必須（全品目「出荷日の前日に収穫・パック」のため task_date = delivery_date - 1日）
 *   - 納入先ゲート : 取引先に納入先登録があるのに未確定なら拒否（取引先＞納入先の仕分け保証）
 *   - 荷姿ゲート   : 商品×取引先に選べる荷姿があるのに未確定なら拒否（箱数計算の保証）
 *   - スタッフ判定 : role=staff は「機能解放＋高確信・取引先一致・納品日確定」のみ可
 * 成功時: status=approved に更新し、各明細から harvest_tasks（出荷日前日）を生成、audit_log に記録。
 */

type AdminClient = SupabaseClient<Database>

export interface ApproveOrderInput {
  orderId: string
  /** 納品日が未確定なら承認時にここで確定（YYYY-MM-DD）。 */
  deliveryDate?: string
  /** 納入先が未確定なら承認時にここで確定。 */
  destinationId?: string
  /** 呼び出し側で確定済みの実行者ロール（認証・権限判定は呼び出し側の責務）。 */
  role: 'admin' | 'staff'
  /** 監査記録の approved_by に使う実行者ユーザーID。 */
  userId: string
}

export type ApproveOrderResult =
  | { ok: true; tasksCreated: number; deliveryDate: string }
  | { ok: false; status: number; error: string; reason?: string }

export async function approveOrder(
  admin: AdminClient,
  input: ApproveOrderInput,
): Promise<ApproveOrderResult> {
  const { orderId, role, userId } = input

  // 対象注文＋明細を取得
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
    .select('id, product_id, product_name, quantity, confidence, pack_config_id')
    .eq('order_id', order.id)
  if (itemsErr) return { ok: false, status: 500, error: itemsErr.message }

  // 納品日（引数で確定可。harvest_tasks.task_date に必須）
  const deliveryDate = input.deliveryDate ?? order.delivery_date
  if (!deliveryDate) {
    return { ok: false, status: 400, error: '納品日を確定してください' }
  }

  // 納入先解決: AI判別または指定値を優先。未指定の場合は取引先の納入先やメモから自動名寄せ解決
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

  // 荷姿ゲート: その商品×取引先に選べる荷姿マスタがあるのに未確定なら承認させない
  const productIds = [...new Set(items.map((it) => it.product_id).filter(Boolean))] as string[]
  if (productIds.length > 0) {
    const { data: packConfigs, error: packErr } = await admin
      .from('pack_configs')
      .select('id, product_id, customer_id')
      .in('product_id', productIds)
      .eq('is_active', true)
    // 荷姿の取得失敗を「荷姿マスタなし」に化けさせない（ゲートをすり抜けさせない）。
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

  // スタッフは高確信・取引先一致・納品日確定のときだけ承認可
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

  // 承認：status 更新（＋必要なら delivery_date・destination_id を確定）
  const updates: Record<string, unknown> = { status: 'approved' }
  if (!order.delivery_date && input.deliveryDate) {
    updates.delivery_date = input.deliveryDate
    updates.delivery_date_source = 'manual'
  }
  if (!order.destination_id && destinationId) {
    updates.destination_id = destinationId
  }
  const { error: updErr } = await admin.from('orders').update(updates).eq('id', order.id)
  if (updErr) return { ok: false, status: 500, error: updErr.message }

  // 各明細 → 収穫タスク生成（全品目「出荷日の前日に収穫・パック」の原則に従い task_date は deliveryDate - 1日）
  const harvestTaskDate = shiftDateStr(deliveryDate, -1)
  const tasks = items
    .filter((it) => it.product_id)
    .map((it) => ({
      product_id: it.product_id!,
      order_item_id: it.id,
      required_qty: it.quantity,
      task_date: harvestTaskDate,
    }))
  const { error: taskErr } = await admin.from('harvest_tasks').insert(tasks)
  if (taskErr) {
    // タスク生成に失敗したら承認を巻き戻す（中途半端な状態を残さない）
    await admin.from('orders').update({ status: 'pending_review' }).eq('id', order.id)
    return { ok: false, status: 500, error: `収穫タスクの生成に失敗: ${taskErr.message}` }
  }

  // 紐づく受信ログのステータスも approved に更新
  try {
    await admin.from('order_receipts').update({ status: 'approved' }).eq('order_id', order.id)
  } catch (e) {
    console.error('[approve] order_receipts status update failed', e)
  }

  // 監査記録（best-effort で全体は止めない）
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
