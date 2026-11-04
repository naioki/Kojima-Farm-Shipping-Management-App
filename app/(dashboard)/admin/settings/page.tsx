import { createAdminClient } from '@/lib/supabase/admin'
import { ErrorState } from '@/components/ui/States'
import { SettingsForm, type SettingItem } from '@/components/admin/SettingsForm'
import { SETTINGS_SPEC } from '@/lib/settings-spec'
import { requireAdmin } from '@/lib/auth/require-admin'

export const dynamic = 'force-dynamic'

/**
 * 設定（自社情報 / 現場スタッフ / AI / 通知 / 外部連携のキー / 上級者向け）。区分は lib/settings-spec.ts。
 * admin 限定。秘密情報は値を表示せず「設定済み/未設定」のみ（書き込み専用）。
 * 解決順は DB（app_settings）→ 環境変数。
 */
export default async function SettingsPage() {
  const guard = await requireAdmin('設定は管理者のみアクセスできます。')
  if (guard) return guard

  const supabase = createAdminClient()

  // app_settings を取得（admin_all RLS で admin のみ可）
  const { data: rows, error } = await supabase.from('app_settings').select('key, value')
  if (error) return <ErrorState message={error.message} />
  const dbMap = new Map((rows ?? []).map((r) => [r.key, r.value]))

  const items: SettingItem[] = SETTINGS_SPEC.map((spec) => {
    // 旧キー NOTIFY_LINEWORKS_WEBHOOK_URL からの移行フォールバック
    const dbVal =
      dbMap.get(spec.key) ??
      (spec.key === 'LINE_WORKS_WEBHOOK_URL' ? dbMap.get('NOTIFY_LINEWORKS_WEBHOOK_URL') : null) ??
      null
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
      toggleDefault: spec.toggleDefault,
      options: spec.options,
      selectDefault: spec.selectDefault,
      isSet,
      // 秘密は値を返さない。非秘密のみ現在値（DB→env）を渡す。
      value: spec.secret ? undefined : dbVal ?? envVal ?? '',
      defaultPrompt: spec.defaultPrompt,
      dependsOn: spec.dependsOn,
      danger: spec.danger,
    }
  })

  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-8">
      <div>
        <h1 className="font-display text-2xl sm:text-3xl font-black text-ink">設定</h1>
        <p className="mt-1 text-base text-ink-soft">
          上から順に、ふだんよく触る項目です。取引先・品目はメニューの「マスタ・設定」、改善要望は「振り返り・記録」にあります。
        </p>
      </div>

      <SettingsForm items={items} />
    </div>
  )
}
