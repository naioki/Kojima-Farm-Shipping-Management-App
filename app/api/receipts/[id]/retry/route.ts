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
  const { data: profile, error: profileErr } = await supabase.from('users').select('role').eq('id', user.id).maybeSingle()
  // ロール解決の失敗は admin として扱わない（fail closed）。無言にせずログに残す。
  if (profileErr) console.error('[app/api/receipts/[id]/retry/route.ts] ロールの取得に失敗:', profileErr.message)
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  // read-then-update は二重クリックで競合する（両リクエストが status='ai_failed' を読んでしまう）。
  // 条件付き1回のUPDATEにし、実際に更新できた行数で「自分が処理する権利を得たか」を判定する。
  const admin = createAdminClient()
  const { data: updated, error: updErr } = await admin
    .from('order_receipts')
    .update({ status: 'pending_ai', error_message: null, retry_count: 0, next_retry_at: null })
    .eq('id', params.id)
    .eq('status', 'ai_failed')
    .select('id')
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })
  if (!updated || updated.length === 0) {
    return NextResponse.json({ error: '再解析できる状態ではありません（既に処理中か完了しています）' }, { status: 409 })
  }

  const result = await processReceipt(params.id)
  return NextResponse.json({ ok: true, status: result.status, error: result.error })
}
