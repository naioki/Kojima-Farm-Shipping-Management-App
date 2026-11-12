import 'server-only'
import { NextResponse } from 'next/server'
import { pollEmailOnce } from '@/lib/ingestion/poll-email'
import { requireAdminApi } from '@/lib/auth/api-guard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/ingest-email
 * 管理画面の「FAXを取り込む」ボタン用。Cloud Scheduler を有効化していなくても、
 * 人手で専用メールボックスを1回スキャンして取込む。cron と同じ pollEmailOnce() を呼ぶ。
 * Message-ID / exact_hash 判定により、何度押しても二重計上しない。
 */
export async function POST() {
  const guard = await requireAdminApi('管理者権限が必要です')
  if (!guard.ok) return guard.response

  const result = await pollEmailOnce()
  if (result.error) return NextResponse.json(result, { status: 500 })
  return NextResponse.json(result)
}
