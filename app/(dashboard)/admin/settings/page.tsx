import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import { ErrorState } from '@/components/ui/States'
import { SettingsForm, type SettingItem } from '@/components/admin/SettingsForm'
import { FeedbackReportSection } from '@/components/admin/FeedbackReportSection'
import { SETTINGS_SPEC } from '@/lib/settings-spec'
import { requireAdmin } from '@/lib/auth/require-admin'

export const dynamic = 'force-dynamic'

/**
 * 設定（自社情報 / AI / LINE WORKS通知 / 高度な設定）。
 * admin 限定。秘密情報は値を表示せず「設定済み/未設定」のみ（書き込み専用）。
 * 解決順は DB（app_settings）→ 環境変数。
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
          伝票印字・AI読取・LINE WORKS通知の基本設定。秘密情報は保存後に非表示（「設定済み」）となります。
        </p>
      </div>

      {/* マスタ管理クイックカード（視認性を向上） */}
      <div className="rounded-2xl border-2 border-forest-200 bg-forest-50/50 p-5 space-y-3">
        <div>
          <h2 className="font-display text-lg font-black text-forest-950">マスタ管理（取引先・品目）</h2>
          <p className="mt-0.5 text-sm text-forest-800">
            新規出荷や請求書で利用する取引先・品目の追加、使わない項目の非表示（削除）はこちらから管理できます。
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 pt-1">
          <Link
            href="/admin/customers"
            className="flex items-center justify-between p-4 rounded-xl border border-forest-300 bg-white hover:bg-forest-50/80 transition-all shadow-xs group"
          >
            <div>
              <p className="font-black text-base text-ink group-hover:text-forest-800">🏢 取引先・納品先設定</p>
              <p className="mt-0.5 text-xs font-bold text-ink-soft">取引先の追加・納品先・不要な取引先の非表示</p>
            </div>
            <ChevronRight className="h-5 w-5 text-forest-600 shrink-0" />
          </Link>
          <Link
            href="/admin/products"
            className="flex items-center justify-between p-4 rounded-xl border border-forest-300 bg-white hover:bg-forest-50/80 transition-all shadow-xs group"
          >
            <div>
              <p className="font-black text-base text-ink group-hover:text-forest-800">🥬 品目（商品）設定</p>
              <p className="mt-0.5 text-xs font-bold text-ink-soft">品目の追加・単位・不要な品目の非表示</p>
            </div>
            <ChevronRight className="h-5 w-5 text-forest-600 shrink-0" />
          </Link>
        </div>
      </div>

      <SettingsForm items={items} />

      {/* 現場からの改善要望・バグ報告（5W1H） */}
      <FeedbackReportSection />
    </div>
  )
}
