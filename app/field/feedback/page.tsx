import { redirect } from 'next/navigation'
import { getAuthedUser, createClient } from '@/lib/supabase/server'
import { FeedbackReportSection } from '@/components/admin/FeedbackReportSection'

export const dynamic = 'force-dynamic'

export default async function FieldFeedbackPage() {
  const user = await getAuthedUser()
  if (!user) redirect('/login')

  const supabase = createClient()
  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).maybeSingle()
  const isAdmin = profile?.role === 'admin'

  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-12">
      <div className="space-y-1">
        <h1 className="font-display text-2xl font-black text-ink">💬 改善要望・バグ報告フォーム</h1>
        <p className="text-sm font-medium text-ink-soft">
          小島農園の日々の受発注・出荷・パック作業で気づいた改善点や操作のしづらさ、不具合を気軽にお知らせください。
        </p>
      </div>

      <FeedbackReportSection isAdmin={isAdmin} />
    </div>
  )
}
