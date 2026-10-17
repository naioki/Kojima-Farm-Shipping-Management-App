import { NextResponse } from 'next/server'
import { verifyCronRequest } from '@/lib/config/ingestion'
import { getAuthedUser } from '@/lib/supabase/server'
import { jstTodayStr } from '@/lib/dates'
import { runShadowDiff } from '@/lib/shadow/run'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 影実行（統合2C）: v4確定注文と本アプリ読み取り結果の日次突合レポート。
 * Cloud Scheduler（毎朝）または管理者の手動実行（ログイン済みブラウザ）で叩く。
 * GET /api/cron/shadow-diff?date=YYYY-MM-DD（省略時はJST今日）
 */
export async function GET(req: Request) {
  const isCron = await verifyCronRequest(req.headers)
  const user = isCron ? null : await getAuthedUser()
  if (!isCron && !user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const dateParam = searchParams.get('date') ?? ''
  const date = /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : jstTodayStr()

  const result = await runShadowDiff(date)
  if (result.error) return NextResponse.json(result, { status: 500 })
  return NextResponse.json(result)
}
