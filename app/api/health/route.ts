import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

/**
 * ヘルスチェック（認証不要・軽量）。
 * デプロイ後スモークテスト（scripts/deploy.ps1）と Cloud Monitoring の
 * uptime check から叩く。DB 到達性まで確認して "ok" / "degraded" を返す。
 */
export async function GET() {
  const startedAt = Date.now()
  let db: 'ok' | 'error' = 'ok'
  let dbError: string | undefined

  try {
    const supabase = createAdminClient()
    const { error } = await supabase.from('app_settings').select('key').limit(1)
    if (error) {
      db = 'error'
      dbError = error.message
    }
  } catch (e) {
    db = 'error'
    dbError = e instanceof Error ? e.message : String(e)
  }

  const healthy = db === 'ok'
  return NextResponse.json(
    {
      status: healthy ? 'ok' : 'degraded',
      db,
      ...(dbError ? { dbError } : {}),
      latencyMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    },
    { status: healthy ? 200 : 503 }
  )
}
