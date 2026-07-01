import { NextResponse } from 'next/server'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { processReceipt } from '@/lib/ingestion/process-receipt'

export const runtime = 'nodejs'

/**
 * ai_failed レシートを即座に再解析する。
 * status を pending_ai に戻すだけでは次の自動リトライ（cron の ai_failed 拾い）にも
 * 引っかからず放置されるため、ここで processReceipt() を直接呼んで同期的に再処理する。
 */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const supabase = createClient()
  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).maybeSingle()
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const admin = createAdminClient()
  const { data: receipt, error: fetchErr } = await admin
    .from('order_receipts')
    .select('id, status')
    .eq('id', params.id)
    .maybeSingle()
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 })
  if (!receipt || receipt.status !== 'ai_failed') {
    return NextResponse.json({ error: '再解析できる状態ではありません' }, { status: 409 })
  }

  const { error: updErr } = await admin
    .from('order_receipts')
    .update({ status: 'pending_ai', error_message: null, retry_count: 0, next_retry_at: null })
    .eq('id', params.id)
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

  const result = await processReceipt(params.id)
  return NextResponse.json({ ok: true, status: result.status, error: result.error })
}
