import { redirect } from 'next/navigation'
import { ScanLine } from 'lucide-react'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import { ErrorState } from '@/components/ui/States'
import { ManualOcrForm } from '@/components/admin/ManualOcrForm'
import { getSetting } from '@/lib/settings'
import { DEFAULT_GEMINI_PROMPT_NORMAL } from '@/lib/gemini/prompts'

export const dynamic = 'force-dynamic'

/**
 * 手動OCR（管理者専用）。
 * FAX画像・スキャン・メール本文をその場でAIに読ませて明細を確認する。
 * 取引先には公開しない（トークン消費抑制）。プロンプトはこの解析だけ上書き可能。
 */
export default async function ManualOcrPage() {
  const user = await getAuthedUser()
  if (!user) redirect('/login')

  const supabase = createClient()
  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).maybeSingle()
  if (profile?.role !== 'admin') {
    return <ErrorState title="権限がありません" message="手動OCRは管理者のみ利用できます。" />
  }

  const currentPrompt = (await getSetting('GEMINI_PROMPT_NORMAL')) ?? ''

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-earth-100 p-2">
          <ScanLine className="h-5 w-5 text-earth-700" aria-hidden />
        </div>
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">手動OCR読み取り</h1>
          <p className="text-sm text-ink-soft">
            FAX画像・スキャン・PDF・メール本文をAIで読み取ります。管理者専用（取引先・スタッフは利用不可）。
          </p>
        </div>
      </div>

      <Card>
        <ManualOcrForm currentPrompt={currentPrompt} defaultPrompt={DEFAULT_GEMINI_PROMPT_NORMAL} />
      </Card>
    </div>
  )
}
