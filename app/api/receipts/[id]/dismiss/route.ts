import { NextResponse } from 'next/server'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const supabase = createClient()
  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).maybeSingle()
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'forbidden' }, { status: 403 })

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
