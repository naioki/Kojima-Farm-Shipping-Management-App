import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireStaffApi } from '@/lib/auth/api-guard'
import { createAdminClient } from '@/lib/supabase/admin'
import { MAX_ACTIVE_MS_PER_EVENT, normalizeOpsPath } from '@/lib/ops/active-time'

export const runtime = 'nodejs'

const eventSchema = z.object({
  path: z.string().min(1).max(300),
  event: z.enum(['page_active', 'action', 'error']),
  name: z.string().max(100).optional(),
  active_ms: z.number().int().min(0).optional(),
  meta: z.record(z.unknown()).optional(),
})
const bodySchema = z.object({ events: z.array(eventSchema).min(1).max(50) })

/**
 * POST /api/ops-events — 操作ログの記録（事務作業時間の自動推定・現場観察の基盤）。
 * 社内ユーザーのみ。ユーザー・ロールはサーバー側で確定し、クライアントの申告は信用しない。
 * 計測の失敗で業務を止めないため、クライアントは結果を待たない（sendBeacon / keepalive）。
 */
export async function POST(req: Request) {
  const guard = await requireStaffApi()
  if (!guard.ok) return guard.response

  // sendBeacon は text/plain で送ることがあるため、本文は文字列で受けて JSON として解釈する
  const raw = await req.text().catch(() => '')
  let json: unknown = null
  try {
    json = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }
  const parsed = bodySchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid', detail: parsed.error.flatten() }, { status: 400 })
  }

  const rows = parsed.data.events
    .filter((e) => e.event !== 'page_active' || (e.active_ms ?? 0) > 0)
    .map((e) => ({
      user_id: guard.user.id,
      role: guard.role,
      path: normalizeOpsPath(e.path),
      event: e.event,
      name: e.name ?? null,
      active_ms: e.active_ms == null ? null : Math.min(e.active_ms, MAX_ACTIVE_MS_PER_EVENT),
      meta: e.meta ?? null,
    }))
  if (rows.length === 0) return NextResponse.json({ ok: true, inserted: 0 })

  const admin = createAdminClient()
  const { error } = await admin.from('ops_events').insert(rows)
  if (error) {
    console.error('[ops-events] 記録に失敗:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true, inserted: rows.length })
}
