import { redirect } from 'next/navigation'
import { ScanLine } from 'lucide-react'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import { ErrorState } from '@/components/ui/States'
import { ManualOcrForm } from '@/components/admin/ManualOcrForm'
import { getSetting } from '@/lib/settings'
import { DEFAULT_GEMINI_PROMPT_NORMAL } from '@/lib/gemini/prompts'
import { getStaffFeatures, canStaffUse } from '@/lib/field/features'

export const dynamic = 'force-dynamic'

/**
 * 現場OCR（スタッフ向け）。
 * 設定「現場機能の解放 → スタッフもOCR」がONのときだけスタッフが使える（admin は常時可）。
 * スタッフはプロンプト編集・保存は不可（既定プロンプトで読むだけ）。社内利用のみ。
 */
export default async function FieldOcrPage() {
  const user = await getAuthedUser()
  if (!user) redirect('/login')

  const supabase = createClient()
  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).maybeSingle()
  const role = (profile?.role as 'admin' | 'staff') ?? 'staff'

  const features = await getStaffFeatures()
  if (!canStaffUse('ocr', role, features)) {
    return (
      <ErrorState
        title="まだ使えません"
        message="OCR読み取りは管理者が「設定 → 現場機能の解放」でONにすると使えます。"
      />
    )
  }

  const isAdmin = role === 'admin'
  const currentPrompt = isAdmin ? ((await getSetting('GEMINI_PROMPT_NORMAL')) ?? '') : ''

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-earth-100 p-2">
          <ScanLine className="h-5 w-5 text-earth-700" aria-hidden />
        </div>
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">注文を 読む</h1>
          <p className="text-sm text-ink-soft">
            FAX・しゃしん・PDF・メールを AI が よみとります。
          </p>
        </div>
      </div>

      <Card>
        {/* スタッフはプロンプトを編集・保存できない（読むだけ）。管理者は両方可。 */}
        <ManualOcrForm
          currentPrompt={currentPrompt}
          defaultPrompt={DEFAULT_GEMINI_PROMPT_NORMAL}
          allowPromptEdit={isAdmin}
          allowPromptSave={isAdmin}
        />
      </Card>
    </div>
  )
}
