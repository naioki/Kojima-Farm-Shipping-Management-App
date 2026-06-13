import { redirect } from 'next/navigation'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import { ErrorState } from '@/components/ui/States'
import { SettingsForm, type SettingItem } from '@/components/admin/SettingsForm'
import { SETTINGS_SPEC } from '@/lib/settings-spec'

export const dynamic = 'force-dynamic'

/**
 * 設定（Google Drive / Gemini / メール / R2 / 通知 / 運用）。
 * admin 限定。秘密情報は値を表示せず「設定済み/未設定」のみ（書き込み専用）。
 * 解決順は DB（app_settings）→ 環境変数。実際の取り込み稼働には外部の認証情報が必要。
 */
export default async function SettingsPage() {
  const user = await getAuthedUser()
  if (!user) redirect('/login')

  const supabase = createClient()
  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).maybeSingle()
  if (profile?.role !== 'admin') {
    return <ErrorState title="権限がありません" message="設定は管理者のみアクセスできます。" />
  }

  // app_settings を取得（admin_all RLS で admin のみ可）
  const { data: rows, error } = await supabase.from('app_settings').select('key, value')
  if (error) return <ErrorState message={error.message} />
  const dbMap = new Map((rows ?? []).map((r) => [r.key, r.value]))

  const items: SettingItem[] = SETTINGS_SPEC.map((spec) => {
    const dbVal = dbMap.get(spec.key) ?? null
    const envVal = process.env[spec.key] ?? null
    const isSet = Boolean((dbVal && dbVal !== '') || (envVal && envVal !== ''))
    return {
      key: spec.key,
      label: spec.label,
      section: spec.section,
      secret: spec.secret,
      kind: spec.kind,
      placeholder: spec.placeholder,
      hint: spec.hint,
      isSet,
      // 秘密は値を返さない。非秘密のみ現在値（DB→env）を渡す。
      value: spec.secret ? undefined : dbVal ?? envVal ?? '',
    }
  })

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">設定</h1>
        <p className="text-sm text-ink-soft">
          取り込み・AI・保管・通知の接続設定。秘密情報は保存後に表示されません（「設定済み」のみ）。
        </p>
      </div>

      <div className="rounded border border-warning/40 bg-warning-bg px-4 py-3 text-sm text-ink-soft">
        ⚠️ 秘密情報（APIキー・パスワード等）はDBに保存されます。Secret Manager より弱いため、本番では
        環境変数（Secret Manager）併用を推奨します。ここでの保存は admin 限定・サーバーのみが読み取ります。
      </div>

      <Card>
        <SettingsForm items={items} />
      </Card>
    </div>
  )
}
