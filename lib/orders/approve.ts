import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'
import { writeAudit } from '@/lib/audit/log'
import { noteSideEffectFailure, runSideEffect, writeAuditAfterSuccess } from '@/lib/api/side-effects'
import { writeDroppingMissingColumns } from '@/lib/supabase/missing-column'
import { shiftDateStr } from '@/lib/dates'
import { getSetting } from '@/lib/settings'
import { getStaffFeatures } from '@/lib/field/features'
import { decideReceiptApproval, parseThreshold } from '@/lib/ingestion/auto-approve'
import { foldKana } from '@/lib/normalize/kana'
import { loadQuantityHistory } from './quantity-history'
import { detectQuantityAnomaly } from './quantity-anomaly'
import { skipsDestinationGate } from '@/lib/customers/settings'
import { decideMergeMode, MERGE_MODE_JA } from './merge-mode'
import { upsertHarvestTasks } from '@/lib/harvest/upsert-tasks'

type AdminClient = SupabaseClient<Database>

export interface ApproveOrderInput {
  orderId: string
  deliveryDate?: string
  destinationId?: string
  /** 「納入先なし（取引先あて）」を明示選択した。納入先が複数ある取引先でも納入先なしで承認する。 */
  noDestination?: boolean
  role: 'admin' | 'staff'
  userId: string
}

export type ApproveOrderResult =
  | {
      ok: true
      tasksCreated: number
      deliveryDate: string
      mergedIntoOrderId?: string
      /**
       * 承認自体は成功したが、付随する更新（受信票の付け替え・統合元の削除・監査ログ）に失敗したときの
       * 現場向けの文言。失敗の詳細は console.error に出す。警告が無いときはキーごと省く。
       */
      warnings?: string[]
    }
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
    .select('id, customer_id, status, delivery_date, destination_id, note, source, intake_channel')
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
  let activeDestCount = 0
  if (!destinationId && order.customer_id) {
    const { data: customerDests, error: destsErr } = await admin
      .from('delivery_destinations')
      .select('id, code, full_name, aliases')
      .eq('customer_id', order.customer_id)
      .eq('is_active', true)
    if (destsErr) return { ok: false, status: 500, error: `納入先マスタの確認に失敗しました: ${destsErr.message}` }
    activeDestCount = customerDests?.length ?? 0

    if (customerDests && customerDests.length > 0 && !input.noDestination) {
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

  // 取引先設定「納入先を指定しない」がオンなら、納入先が決まらなくても承認してよい
  let customerSkipsGate = false
  if (!destinationId && activeDestCount >= 2 && !input.noDestination && order.customer_id) {
    const { data: cust, error: custErr } = await admin
      .from('customers')
      .select('channel_identifiers')
      .eq('id', order.customer_id)
      .maybeSingle()
    if (custErr) return { ok: false, status: 500, error: `取引先設定の確認に失敗しました: ${custErr.message}` }
    customerSkipsGate = skipsDestinationGate(cust?.channel_identifiers)
  }

  // 納入先ゲート（CLAUDE.md）: 納入先が複数ある取引先で、どの納入先か決まらない注文は承認しない。
  // 出荷一覧で「取引先 ＞ 納入先」の仕分け・箱数が必ず出せる状態を保証するため。
  // 該当する納入先が無い場合は「納入先なし（取引先あて）」を明示選択すれば承認できる。
  if (!destinationId && activeDestCount >= 2 && !input.noDestination && !customerSkipsGate) {
    return {
      ok: false,
      status: 400,
      error: '納入先を選択してください（該当しない場合は「納入先なし」を選択）',
      reason: 'destination_required',
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
    // いつもと違う数量がある注文は管理者が原本を確かめる（承認画面の表示と同じ判定）
    if (order.customer_id) {
      const pids = [...new Set(items.map((it) => it.product_id).filter(Boolean))] as string[]
      const history = await loadQuantityHistory(admin as unknown as SupabaseClient, [order.customer_id], pids)
      const odd = items.find(
        (it) =>
          it.product_id &&
          detectQuantityAnomaly(Number(it.quantity), history.get(`${order.customer_id}:${it.product_id}`) ?? []).anomaly,
      )
      if (odd) {
        return {
          ok: false,
          status: 403,
          error: `「${odd.product_name}」の数量がいつもと大きく違うため、管理者の確認が必要です`,
          reason: 'quantity_anomaly',
        }
      }
    }
  }

  const harvestTaskDate = shiftDateStr(deliveryDate, -1)

  // 二重承認防止: pending_review のときだけ approved に切り替える（同時に2人が押しても1回だけ通る）。
  // 収穫タスクの日付と注文の納品日がずれないよう、承認に使った納品日を注文にも反映する。
  const updates: Record<string, unknown> = {
    status: 'approved',
    approved_at: new Date().toISOString(),
    approved_by: userId,
  }
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
      .update({
        status: 'pending_review',
        delivery_date: order.delivery_date,
        destination_id: order.destination_id,
        approved_at: null,
        approved_by: null,
      })
      .eq('id', order.id)
    if (error) console.error('[approve] 承認の取り消しに失敗:', error.message)
  }

  // 承認（本体）が成功した後の付随更新の失敗は、承認結果の warnings で返す（詳細は console.error）
  const warnings: string[] = []
  const AUDIT_WARN = '承認はしましたが、操作の記録（履歴）を残せませんでした。念のため開発担当に伝えてください'

  // #36 既に同じ (customer_id, destination_id, delivery_date) の承認済み注文があるかチェックし、あれば統合する
  // ※ ただしサンプル注文（note に「サンプル」を含む場合）は別口のサンプル依頼または通常大口便と混ざらないよう自動統合しない
  // 同じ品目の数量は、統合元（この注文）の受け方で「上書き」か「加算」かを決める（lib/orders/merge-mode.ts）:
  //   FAX・メールの取り込み（丸ごと再送） → 上書き ／ ポータル・手入力など別口の追加注文 → 加算
  //   判断できないとき → 統合せず、別の注文として承認する（数量を勝手に上書き・加算しない）。警告と監査記録に残す。
  const isCurrentSample = Boolean(order.note && order.note.includes('サンプル'))
  const mergeMode = decideMergeMode({ source: order.source, intake_channel: order.intake_channel })
  let mergeSkippedInto: string | null = null
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

    if (targetExistingOrder && mergeMode === 'unknown') {
      mergeSkippedInto = targetExistingOrder.id
      warnings.push(
        '同じ取引先・納入先・納品日の承認済み注文がありますが、この注文が再送なのか追加注文なのか判断できないため、まとめずに別の注文として承認しました。出荷一覧で2つの注文の数量を確認してください',
      )
    }

    if (targetExistingOrder && mergeMode !== 'unknown') {
      const isAdd = mergeMode === 'add'
      const { data: existingItems } = await admin
        .from('order_items')
        .select('id, product_id, product_name, quantity, version, field_status, line_note, shipped_qty, spec, container_type')
        .eq('order_id', targetExistingOrder.id)

      let tasksCreated = 0
      const mergeErrors: string[] = []
      const check = (label: string, r: { error: { message: string } | null }) => {
        if (r.error) mergeErrors.push(`${label}: ${r.error.message}`)
      }
      for (const it of items) {
        // 出荷済みの明細には統合しない（数量を上書きして「未着手」に戻すと出荷実績が消えるため）。
        // その場合は別行として既存注文に移す。
        // 加算のときは規格・容器が食い違う明細には足さない（別の荷姿の数量を混ぜない）。別行として移す。
        const sameSpec = (a: string | null | undefined, b: string | null | undefined) => !a || !b || a === b
        const matchExisting = (existingItems ?? []).find(
          (ex) =>
            ex.field_status !== 'shipped' &&
            ((it.product_id && ex.product_id === it.product_id) ||
              (!it.product_id && ex.product_name === it.product_name)) &&
            (!isAdd || (sameSpec(it.spec, ex.spec) && sameSpec(it.container_type, ex.container_type))),
        )
        if (matchExisting) {
          // 追加FAX（丸ごと再送）は数量を「上書き」、別口の追加注文は「加算」する。変更履歴は2か所に残す:
          //  - audit_log（旧値→新値と「上書き」「加算」の別。Undo で元に戻せる）
          //  - 明細メモ（現場カードに「数量変更:50→58P」と表示。通常の数量変更と同じ表記）
          const incomingQty = Number(it.quantity) || 0
          const oldQty = Number(matchExisting.quantity) || 0
          const newQty = isAdd ? oldQty + incomingQty : incomingQty
          const qtyChanged = newQty !== oldQty
          const wasPacked = matchExisting.field_status === 'packed'
          const stripTokens = (note: string | null | undefined) =>
            (note ?? '')
              .split(/\s*\/\s*/)
              .filter((t: string) => t && !/^(?:数量変更:|🚨パック済|★?新規追加)/.test(t.trim()))
          // 上書き: 新しい明細のメモを優先。加算: 既存のメモを残し、追加注文のメモを足す
          const baseNote = (
            isAdd
              ? [...new Set([...stripTokens(matchExisting.line_note), ...stripTokens(it.line_note)])]
              : stripTokens(it.line_note ?? matchExisting.line_note)
          ).join(' / ')
          const addSuffix = isAdd ? `(追加注文+${incomingQty}P)` : ''
          const changeToken = !qtyChanged
            ? null
            : wasPacked && newQty > oldQty
              ? `🚨パック済(${oldQty}P)→${newQty}P(+${newQty - oldQty}P追加必要)`
              : `数量変更:${oldQty}→${newQty}P${addSuffix}`
          const nextLineNote = [changeToken, baseNote].filter(Boolean).join(' / ') || null
          const mergePatch: Record<string, unknown> = {
            quantity: newQty,
            quantity_raw: String(newQty),
            // 加算では既存の規格・容器をそのまま使う（上で食い違いが無いことを確かめ済み）
            spec: isAdd ? undefined : (it.spec ?? undefined),
            container_type: isAdd ? undefined : (it.container_type ?? undefined),
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
                merge_mode: MERGE_MODE_JA[mergeMode],
                ...(isAdd ? { added_qty: incomingQty } : {}),
                reason: isAdd
                  ? `別口の追加注文（${order.source}）による数量加算: ${oldQty}+${incomingQty}→${newQty}`
                  : `追加FAX（再送）による数量上書き: ${oldQty}→${newQty}`,
                merged_from_order_id: order.id,
              },
              userId,
            }).catch((e) =>
              noteSideEffectFailure(warnings, `[approve] 統合（数量${MERGE_MODE_JA[mergeMode]}）の監査記録 audit_log に失敗`, e, AUDIT_WARN),
            )
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
            const taskRes = await upsertHarvestTasks(admin, [
              { product_id: it.product_id, order_item_id: it.id, required_qty: it.quantity, task_date: harvestTaskDate },
            ])
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

      // ここから先は統合（本体）が終わった後の付随更新。失敗しても承認は成功のまま、警告で返す
      const receiptsMoved = await runSideEffect(
        warnings,
        '[approve] 統合時の order_receipts 付け替え（order_id/status）に失敗',
        '承認はしましたが、受信したFAX・メールを統合先の注文に付け替えられませんでした。受信箱で原本の紐付けを確認してください',
        () =>
          admin
            .from('order_receipts')
            .update({ order_id: targetExistingOrder.id, status: 'approved' })
            .eq('order_id', order.id),
      )

      // 受信票の付け替えに失敗したまま統合元を消すと、原本が注文から外れるので消さずに残す
      if (receiptsMoved) {
        await runSideEffect(
          warnings,
          `[approve] 統合元の注文 orders(${order.id}) の削除に失敗`,
          '承認はしましたが、統合元の空の注文を片付けられませんでした。注文一覧に空の注文が残っていないか確認してください',
          () => admin.from('orders').delete().eq('id', order.id),
        )
      } else {
        console.error(`[approve] 受信票の付け替えに失敗したため、統合元の注文 orders(${order.id}) は削除せず残します`)
      }

      await writeAuditAfterSuccess(
        admin,
        {
          entityType: 'orders',
          entityId: targetExistingOrder.id,
          action: 'UPDATE',
          oldValues: { merged_from_order_id: order.id },
          newValues: {
            status: 'approved',
            approved_by: userId,
            merge_mode: MERGE_MODE_JA[mergeMode],
            merged_from_source: order.source,
            merged_from_intake_channel: order.intake_channel ?? null,
          },
          userId,
        },
        '[approve] 統合承認の監査記録 audit_log に失敗',
        warnings,
        AUDIT_WARN,
      )

      return {
        ok: true,
        tasksCreated,
        deliveryDate,
        mergedIntoOrderId: targetExistingOrder.id,
        ...(warnings.length > 0 ? { warnings } : {}),
      }
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
    // 1明細1件: 再承認（取り込みで承認待ちに戻った注文など）では既存タスクの数量・日付だけ更新し、進捗は残す
    const { error: taskErr } = await upsertHarvestTasks(admin, tasks)
    if (taskErr) {
      await revertClaim()
      return { ok: false, status: 500, error: `収穫タスクの生成に失敗: ${taskErr.message}` }
    }
  }

  await runSideEffect(
    warnings,
    '[approve] order_receipts.status の approved 更新に失敗',
    '承認はしましたが、受信箱の表示を「承認済み」に変えられませんでした。受信箱で状態を確認してください',
    () => admin.from('order_receipts').update({ status: 'approved' }).eq('order_id', order.id),
  )

  await writeAuditAfterSuccess(
    admin,
    {
      entityType: 'orders',
      entityId: order.id,
      action: 'UPDATE',
      oldValues: { status: 'pending_review' },
      newValues: {
        status: 'approved',
        approved_by: userId,
        ...(!destinationId && input.noDestination ? { destination: '納入先なし（明示選択）' } : {}),
        ...(!destinationId && customerSkipsGate ? { destination: '納入先なし（取引先設定）' } : {}),
        ...(mergeSkippedInto
          ? {
              merge_mode: MERGE_MODE_JA.unknown,
              merge_skipped_existing_order_id: mergeSkippedInto,
              merge_skipped_reason: `受け方（source=${order.source ?? '不明'}, intake_channel=${order.intake_channel ?? 'なし'}）から再送か追加注文か判断できないため統合しなかった`,
            }
          : {}),
      },
      userId,
    },
    '[approve] 承認の監査記録 audit_log に失敗',
    warnings,
    AUDIT_WARN,
  )

  return { ok: true, tasksCreated: tasks.length, deliveryDate, ...(warnings.length > 0 ? { warnings } : {}) }
}
