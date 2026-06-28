import { NextResponse } from 'next/server'
import { verifyCronRequest } from '@/lib/config/ingestion'
import { pollDriveOnce } from '@/lib/ingestion/poll-drive'

// Cloud Run 上で重い処理も可（stack.md）。Node ランタイムを明示。
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Drive 5分毎ポーリング（features.md §2-1）。Cloud Scheduler(OIDC) が叩く。
 * 実処理は lib/ingestion/poll-drive.ts の pollDriveOnce() に集約（手動取込ボタンと共有）。
 */
export async function GET(req: Request) {
  if (!(await verifyCronRequest(req.headers))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const result = await pollDriveOnce()
  if (result.error) return NextResponse.json(result, { status: 500 })
  return NextResponse.json(result)
}
