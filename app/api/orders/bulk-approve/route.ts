import 'server-only'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { approveOrder } from '@/lib/orders/approve'

export const runtime = 'nodejs'
export const maxDuration = 60

const bulkApproveSchema = z.object({
  orderIds: z.array(z.string().uuid()).min(1, '承認対象の注文IDを1件以上指定してください'),
})

/**
 * 注文の一括承認（pending_review → approved）。
 * 高確信（AI自信あり・納品日確定・納入先確定）な注文の一括処理、または選択チェックボックスによる一括承認。
 */
export async function POST(req: Request) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 })

  const supabase = createClient()
  const { data: profile, error: profileErr } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()
  if (profileErr) console.error('[POST /api/orders/bulk-approve] ロール取得失敗:', profileErr.message)

  const role = profile?.role
  if (role !== 'admin' && role !== 'staff') {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 })
  }

  const parsed = bulkApproveSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json(
      { error: '入力値が不正です', details: parsed.error.issues },
      { status: 400 },
    )
  }

  const admin = createAdminClient()
  const { orderIds } = parsed.data

  let successCount = 0
  let failedCount = 0
  const errors: Array<{ orderId: string; error: string; reason?: string }> = []

  for (const orderId of orderIds) {
    try {
      const result = await approveOrder(admin, {
        orderId,
        role,
        userId: user.id,
      })
      if (result.ok) {
        successCount++
      } else {
        failedCount++
        errors.push({ orderId, error: result.error, reason: result.reason })
      }
    } catch (e) {
      failedCount++
      errors.push({
        orderId,
        error: e instanceof Error ? e.message : '予期せぬエラーが発生しました',
      })
    }
  }

  return NextResponse.json({
    ok: successCount > 0,
    totalCount: orderIds.length,
    successCount,
    failedCount,
    errors,
  })
}
