import { NextResponse } from 'next/server'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'

/** ai_failed レシートを pending_ai に戻して再解析をトリガーする。 */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const supabase = createClient()
  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).maybeSingle()
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const admin = createAdminClient()
  const { error } = await admin
    .from('order_receipts')
    .update({ status: 'pending_ai', error_message: null, retry_count: 0, next_retry_at: null })
    .eq('id', params.id)
    .eq('status', 'ai_failed')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
