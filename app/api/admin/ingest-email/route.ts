import 'server-only'
import { NextResponse } from 'next/server'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { pollEmailOnce } from '@/lib/ingestion/poll-email'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/ingest-email
 * 管理画面の「FAXを取り込む」ボタン用。Cloud Scheduler を有効化していなくても、
 * 人手で専用メールボックスを1回スキャンして取込む。cron と同じ pollEmailOnce() を呼ぶ。
 * Message-ID / exact_hash 判定により、何度押しても二重計上しない。
 */
export async function POST() {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 })
  const sb = createClient()
  const { data: profile, error: profileErr } = await sb.from('users').select('role').eq('id', user.id).maybeSingle()
  // ロール解決の失敗は admin として扱わない（fail closed）。無言にせずログに残す。
  if (profileErr) console.error('[app/api/admin/ingest-email/route.ts] ロールの取得に失敗:', profileErr.message)
  if (profile?.role !== 'admin') {
    return NextResponse.json({ error: '管理者権限が必要です' }, { status: 403 })
  }

  const result = await pollEmailOnce()
  if (result.error) return NextResponse.json(result, { status: 500 })
  return NextResponse.json(result)
}
