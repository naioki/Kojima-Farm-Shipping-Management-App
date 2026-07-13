import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPendingOrders, pendingReasons } from '@/lib/orders/pending'
import { approveOrder } from '@/lib/orders/approve'
import { enqueuePrintJob } from '@/lib/shipping-docs/queue'
import { formatSupplyDestination } from '@/lib/format/destination'

/**
 * チャット自動化（統合2E）のチャネル非依存ユースケース層。
 *
 * Discord / LINE WORKS 等の webhook 受信（2E-2/2E-3）はこの層の上に載る。よってここには
 * Discord embed や LINE Works の形式を一切持ち込まない。承認は必ず既存の承認ゲート
 * （lib/orders/approve.ts）を通し、印刷は既存の共通キュー（lib/shipping-docs/queue.ts）へ
 * 投入する（v4 のような抜け道は作らない）。すべての関数は例外を握りつぶさず
 * { success, error? } 型で返す（NEVER swallow errors）。
 */

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/**
 * 承認後に事務所プリンタへ自動投入する既定の帳票種別。
 * 出荷表カード（sheet）= その日の出荷作業の主帳票。ラベルは箱貼り用のため既定にはしない。
 */
const PRINT_DOC_TYPE = 'sheet' as const

// ---------------------------------------------------------------------------
// 1. 承認待ち一覧（chat 表示用）
// ---------------------------------------------------------------------------

export interface PendingApprovalView {
  orderId: string
  /** 取引先＞納入先の表記（例「ヨーク 東道野辺」/「寺崎」）。 */
  customerName: string
  deliveryDate: string | null
  /** 例「トマト 15箱, 胡瓜 3箱」 */
  itemsSummary: string
  /** 承認をブロックしている理由（納品日未定・納入先未定・荷姿未定・AI自信なし等）。 */
  blockingReasons: string[]
}

export type ListPendingResult =
  | { success: true; items: PendingApprovalView[] }
  | { success: false; error: string }

export async function listPendingApprovals(limit = 20): Promise<ListPendingResult> {
  try {
    const orders = await getPendingOrders()
    const items: PendingApprovalView[] = orders.slice(0, limit).map((o) => ({
      orderId: o.id,
      customerName: formatSupplyDestination(o.customerName, o.destinationName),
      deliveryDate: o.deliveryDate,
      itemsSummary: o.items.map((it) => `${it.productName} ${it.quantity}${it.unit}`).join(', '),
      blockingReasons: pendingReasons(o),
    }))
    return { success: true, items }
  } catch (e) {
    console.error('[chat] listPendingApprovals failed', e)
    return { success: false, error: errMsg(e) }
  }
}

// ---------------------------------------------------------------------------
// 2. 直近の確定受注（納品日で重複排除）
// ---------------------------------------------------------------------------

export interface ConfirmedOrderView {
  orderId: string
  deliveryDate: string
  lineCount: number
}

export type ListRecentResult =
  | { success: true; items: ConfirmedOrderView[] }
  | { success: false; error: string }

export async function listRecentConfirmed(limit = 10): Promise<ListRecentResult> {
  try {
    const admin = createAdminClient()
    const { data: orders, error } = await admin
      .from('orders')
      .select('id, delivery_date, created_at')
      .eq('status', 'approved')
      .not('delivery_date', 'is', null)
      .order('delivery_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(200)
    if (error) return { success: false, error: error.message }

    // 納品日の重複排除（同一納品日は最新＝先頭の1件を代表にする）。
    const seen = new Set<string>()
    const picked: { id: string; deliveryDate: string }[] = []
    for (const o of orders ?? []) {
      const dd = o.delivery_date
      if (!dd || seen.has(dd)) continue
      seen.add(dd)
      picked.push({ id: o.id, deliveryDate: dd })
      if (picked.length >= limit) break
    }
    if (picked.length === 0) return { success: true, items: [] }

    // 代表注文の明細数
    const ids = picked.map((p) => p.id)
    const { data: itemRows, error: itemsErr } = await admin
      .from('order_items')
      .select('order_id')
      .in('order_id', ids)
    if (itemsErr) return { success: false, error: itemsErr.message }

    const countByOrder = new Map<string, number>()
    for (const r of itemRows ?? []) {
      countByOrder.set(r.order_id, (countByOrder.get(r.order_id) ?? 0) + 1)
    }

    const items: ConfirmedOrderView[] = picked.map((p) => ({
      orderId: p.id,
      deliveryDate: p.deliveryDate,
      lineCount: countByOrder.get(p.id) ?? 0,
    }))
    return { success: true, items }
  } catch (e) {
    console.error('[chat] listRecentConfirmed failed', e)
    return { success: false, error: errMsg(e) }
  }
}

// ---------------------------------------------------------------------------
// 3. 承認 → 印刷
// ---------------------------------------------------------------------------

export interface ApproveAndPrintResult {
  success: boolean
  error?: string
  orderId: string
  deliveryDate?: string
  jobId?: string
}

export async function approveAndPrint(
  orderId: string,
  opts: { deliveryDate?: string; destinationId?: string },
  actorUserId: string,
): Promise<ApproveAndPrintResult> {
  try {
    const admin = createAdminClient()

    // 実行者ロールを解決（認証・権限判定は既存承認ルートと同じ基準に揃える）。
    const { data: profile, error: roleErr } = await admin
      .from('users')
      .select('role')
      .eq('id', actorUserId)
      .maybeSingle()
    if (roleErr) return { success: false, orderId, error: roleErr.message }
    const role = profile?.role
    if (role !== 'admin' && role !== 'staff') {
      return { success: false, orderId, error: '権限がありません' }
    }

    // 承認は必ず既存ゲートを通す（lib/orders/approve.ts）。
    const approved = await approveOrder(admin, {
      orderId,
      deliveryDate: opts.deliveryDate,
      destinationId: opts.destinationId,
      role,
      userId: actorUserId,
    })
    if (!approved.ok) {
      // ゲートで弾かれたら利用者向けの日本語文をそのまま返す。
      return { success: false, orderId, error: approved.error }
    }

    const deliveryDate = approved.deliveryDate
    const printed = await enqueuePrintJob(admin, {
      date: deliveryDate,
      docType: PRINT_DOC_TYPE,
      requestedBy: actorUserId,
    })
    if (!printed.ok) {
      // 承認は確定済み。印刷投入のみ失敗 → 承認は再実行せず reprint でやり直す。
      return {
        success: false,
        orderId,
        deliveryDate,
        error: `承認は完了しましたが、印刷キュー投入に失敗しました: ${printed.error}`,
      }
    }

    return { success: true, orderId, deliveryDate, jobId: printed.id }
  } catch (e) {
    console.error('[chat] approveAndPrint failed', e)
    return { success: false, orderId, error: errMsg(e) }
  }
}

// ---------------------------------------------------------------------------
// 4. 再印刷（承認済み受注の印刷キュー再投入のみ）
// ---------------------------------------------------------------------------

export interface ReprintResult {
  success: boolean
  error?: string
  orderId: string
  deliveryDate?: string
  jobId?: string
}

export async function reprint(orderId: string, deliveryDate?: string): Promise<ReprintResult> {
  try {
    const admin = createAdminClient()

    let date = deliveryDate
    if (!date) {
      const { data: order, error } = await admin
        .from('orders')
        .select('status, delivery_date')
        .eq('id', orderId)
        .maybeSingle()
      if (error) return { success: false, orderId, error: error.message }
      if (!order) return { success: false, orderId, error: '注文が見つかりません' }
      if (order.status !== 'approved') {
        return { success: false, orderId, error: 'この注文はまだ承認されていません' }
      }
      date = order.delivery_date ?? undefined
    }
    if (!date) return { success: false, orderId, error: '納品日が未確定です' }

    const printed = await enqueuePrintJob(admin, {
      date,
      docType: PRINT_DOC_TYPE,
      requestedBy: null,
    })
    if (!printed.ok) return { success: false, orderId, deliveryDate: date, error: printed.error }

    return { success: true, orderId, deliveryDate: date, jobId: printed.id }
  } catch (e) {
    console.error('[chat] reprint failed', e)
    return { success: false, orderId, error: errMsg(e) }
  }
}

// メール取込（旧 ingestEmailsForDate）は 2E-2r で削除。IMAP+Gemini は同期化も背景実行もできず、
// Discord からは独立リクエスト GET /api/cron/poll-email の self-invoke で起動する
// （lib/chat/discord-handlers.ts runIngest）。poll-email はメールボックス全体を Message-ID で
// 重複排除する設計で日付スコープを持たないため、日付別取込の in-process 経路は不要になった。
