import { NextResponse } from 'next/server'
import { getAuthedUser } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { settingsUpdateSchema } from '@/types/database'
import { SETTINGS_BY_KEY } from '@/lib/settings-spec'
import { invalidateSettingsCache } from '@/lib/settings'

export const runtime = 'nodejs'

/**
 * 設定の保存（設定画面）。admin のみ。
 *   - キーは SETTINGS_SPEC のホワイトリストのみ受け付ける。
 *   - 秘密値（secret=true）で空文字が来たら「変更なし」として上書きしない
 *     （画面は現在値を表示しないため、空＝据え置きと解釈する）。
 *   - RLSによる保存遮断を防ぐため createAdminClient を使用。
 */
export async function PUT(req: Request) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('users')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()

  if (profile?.role !== 'admin') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  const parsed = settingsUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid', detail: parsed.error.flatten() }, { status: 400 })
  }

  const rows: { key: string; value: string; is_secret: boolean; updated_by: string }[] = []
  for (const { key, value } of parsed.data.entries) {
    const spec = SETTINGS_BY_KEY[key]
    if (!spec) continue // ホワイトリスト外は無視
    if (spec.secret && value.trim() === '') continue // 秘密の空＝据え置き
    rows.push({ key, value, is_secret: spec.secret, updated_by: user.id })
  }
  if (rows.length === 0) return NextResponse.json({ updated: 0 })

  const { error } = await admin.from('app_settings').upsert(rows, { onConflict: 'key' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  invalidateSettingsCache()
  return NextResponse.json({ updated: rows.length })
}
