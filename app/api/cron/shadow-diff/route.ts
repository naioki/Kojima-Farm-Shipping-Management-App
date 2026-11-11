import { NextResponse } from 'next/server'
import { verifyCronRequest } from '@/lib/config/ingestion'
import { requireStaffApi } from '@/lib/auth/api-guard'
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
  // Cloud Scheduler は x-cron-secret（verifyCronRequest）。手動実行はログイン中の社内ユーザー
  // （admin/staff）のみ。旧実装はログインだけで通り、取引先ポータルの利用者も実行できた（fail open）。
  const isCron = await verifyCronRequest(req.headers)
  if (!isCron) {
    const guard = await requireStaffApi()
    if (!guard.ok) return guard.response
  }

  const { searchParams } = new URL(req.url)
  const dateParam = searchParams.get('date') ?? ''
  const date = /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : jstTodayStr()

  const result = await runShadowDiff(date)
  if (result.error) return NextResponse.json(result, { status: 500 })
  return NextResponse.json(result)
}
