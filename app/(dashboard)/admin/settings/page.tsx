import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import { ErrorState } from '@/components/ui/States'
import { SettingsForm, type SettingItem } from '@/components/admin/SettingsForm'
import { SETTINGS_SPEC } from '@/lib/settings-spec'
import { requireAdmin } from '@/lib/auth/require-admin'

export const dynamic = 'force-dynamic'

/**
 * 設定（Google Drive / Gemini / メール / R2 / 通知 / 運用）。
 * admin 限定。秘密情報は値を表示せず「設定済み/未設定」のみ（書き込み専用）。
 * 解決順は DB（app_settings）→ 環境変数。実際の取り込み稼働には外部の認証情報が必要。
 */
export default async function SettingsPage() {
  const guard = await requireAdmin('設定は管理者のみアクセスできます。')
  if (guard) return guard

  const supabase = createClient()

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
      layer: spec.layer,
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
      status: spec.status,
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

      {/* マスタ管理クイックカード */}
      <Card className="space-y-3 bg-earth-50/50 border-earth-200">
        <h2 className="font-display text-base font-bold text-ink">マスタ管理（取引先・品目）</h2>
        <p className="text-xs text-ink-soft">
          新規出荷や請求書で利用する取引先や品目の追加・不要な項目の非表示（削除）はこちらから行えます。
        </p>
        <div className="grid gap-2 sm:grid-cols-2 pt-1">
          <Link
            href="/admin/customers"
            className="flex items-center justify-between p-3 rounded-xl border border-line bg-white hover:bg-bg-soft transition-all shadow-xs"
          >
            <div>
              <p className="font-bold text-sm text-ink">🏢 取引先・納品先設定</p>
              <p className="text-xs text-ink-soft">取引先の追加・納品先・不要な取引先の非表示</p>
            </div>
            <ChevronRight className="h-4 w-4 text-ink-faint" />
          </Link>
          <Link
            href="/admin/products"
            className="flex items-center justify-between p-3 rounded-xl border border-line bg-white hover:bg-bg-soft transition-all shadow-xs"
          >
            <div>
              <p className="font-bold text-sm text-ink">🥬 品目（商品）設定</p>
              <p className="text-xs text-ink-soft">品目の追加・単位・不要な品目の非表示</p>
            </div>
            <ChevronRight className="h-4 w-4 text-ink-faint" />
          </Link>
        </div>
      </Card>

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
