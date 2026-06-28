import { NextResponse } from 'next/server'
import { verifyCronRequest } from '@/lib/config/ingestion'
import { pollEmailOnce } from '@/lib/ingestion/poll-email'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * メール 5分毎ポーリング（features.md §2-2）。Cloud Scheduler(OIDC) が叩く。
 * 実処理は lib/ingestion/poll-email.ts の pollEmailOnce() に集約（手動取込ボタンと共有）。
 */
export async function GET(req: Request) {
  if (!(await verifyCronRequest(req.headers))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const result = await pollEmailOnce()
  if (result.error) return NextResponse.json(result, { status: 500 })
  return NextResponse.json(result)
}
