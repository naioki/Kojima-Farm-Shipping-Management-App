import 'server-only'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { approveOrder } from '@/lib/orders/approve'
import { requireStaffApi } from '@/lib/auth/api-guard'

export const runtime = 'nodejs'

const bodySchema = z.object({
  /** 納品日が未確定なら承認時にここで確定（harvest_tasks.task_date に必須）。 */
  delivery_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** 納入先が未確定（取引先に納入先があるのに未選択）なら承認時にここで確定。 */
  destination_id: z.string().uuid().optional(),
  /** 「納入先なし（取引先あて）」を明示選択（納入先が複数ある取引先でも納入先なしで承認）。 */
  no_destination: z.boolean().optional(),
})

/**
 * 注文の承認（pending_review → approved）。
 * 承認すると各明細から収穫タスク(harvest_tasks)を生成する。変更は audit_log に記録。
 * 権限:
 *   - 管理者: 常に可
 *   - スタッフ: 設定 STAFF_CAN_APPROVE が ON かつ「取引先一致・納品日確定・全明細が高確信」のみ可
 *     （低確信・未紐付け・納品日未定は管理者専用。決して安全性を緩めない）
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const guard = await requireStaffApi()
  if (!guard.ok) return guard.response
  const { user, role } = guard

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: '入力値が不正です' }, { status: 400 })
  }

  const admin = createAdminClient()

  // 承認の中核ロジックは lib/orders/approve.ts に集約（チャット自動化ユースケースと共有）。
  // ここでは認証・権限判定・入力検証（上記）だけを担い、業務ゲートと副作用は純関数へ委譲する。
  const result = await approveOrder(admin, {
    orderId: params.id,
    deliveryDate: parsed.data.delivery_date,
    destinationId: parsed.data.destination_id,
    noDestination: parsed.data.no_destination,
    role,
    userId: user.id,
  })
  if (!result.ok) {
    const body = result.reason ? { error: result.error, reason: result.reason } : { error: result.error }
    return NextResponse.json(body, { status: result.status })
  }

  // 付随更新（受信票の付け替え・監査ログ等）の失敗は承認成功のまま warnings で返す（lib/orders/approve.ts）
  return NextResponse.json({
    ok: true,
    tasksCreated: result.tasksCreated,
    ...(result.warnings?.length ? { warnings: result.warnings } : {}),
  })
}
