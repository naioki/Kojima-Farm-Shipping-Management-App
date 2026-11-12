import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminApi } from '@/lib/auth/api-guard'

export const runtime = 'nodejs'

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdminApi('forbidden')
  if (!guard.ok) return guard.response

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('order_receipts')
    .update({ status: 'dismissed' })
    .eq('id', params.id)
    .in('status', ['pending_ai', 'pending_review', 'ai_failed', 'unmatched'])
    .select('id')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  // 対象0件（既に処理済み等）は成功扱いにせず、画面側に伝えて更新を促す
  if (!data || data.length === 0) {
    return NextResponse.json({ error: 'すでに状態が変わっています。画面を更新してください' }, { status: 409 })
  }
  return NextResponse.json({ ok: true })
}
