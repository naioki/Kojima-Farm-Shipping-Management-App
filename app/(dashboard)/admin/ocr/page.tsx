import { redirect } from 'next/navigation'
import { ScanLine } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import { ErrorState } from '@/components/ui/States'
import { ManualOcrForm } from '@/components/admin/ManualOcrForm'
import { getSetting } from '@/lib/settings'
import { DEFAULT_GEMINI_PROMPT_NORMAL } from '@/lib/gemini/prompts'

export const dynamic = 'force-dynamic'

/**
 * 手動OCR（管理者専用）。
 * FAX画像・スキャン・メール本文をその場でAIに読ませ、注文として保存まで行う。
 * 取引先・商品一覧を渡してOcrSaveSectionで確認→登録できるようにする。
 */
export default async function ManualOcrPage() {
  const user = await getAuthedUser()
  if (!user) redirect('/login')

  const supabase = createClient()
  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).maybeSingle()
  if (profile?.role !== 'admin') {
    return <ErrorState title="権限がありません" message="手動OCRは管理者のみ利用できます。" />
  }

  const [currentPrompt, customersResult, productsResult, destinationsResult] = await Promise.all([
    getSetting('GEMINI_PROMPT_NORMAL').then((v) => v ?? ''),
    createAdminClient().from('customers').select('id, name').eq('is_active', true).order('name'),
    createAdminClient().from('products').select('id, name').eq('is_active', true).order('name'),
    createAdminClient()
      .from('delivery_destinations')
      .select('id, customer_id, code, full_name, aliases')
      .eq('is_active', true)
      .order('sort_order'),
  ])

  const customers = (customersResult.data ?? []) as { id: string; name: string }[]
  const products = (productsResult.data ?? []) as { id: string; name: string }[]
  const destinations = (destinationsResult.data ?? []) as {
    id: string
    customer_id: string
    code: string | null
    full_name: string
    aliases: string[]
  }[]

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-earth-100 p-2">
          <ScanLine className="h-5 w-5 text-earth-700" aria-hidden />
        </div>
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">注文を読む（FAX・メール）</h1>
          <p className="text-sm text-ink-soft">
            FAX画像・スキャン・PDF・メール本文をAIで読み取り、そのまま注文登録できます。管理者専用。
          </p>
        </div>
      </div>

      <Card>
        <ManualOcrForm
          currentPrompt={currentPrompt}
          defaultPrompt={DEFAULT_GEMINI_PROMPT_NORMAL}
          customers={customers}
          products={products}
          destinations={destinations}
        />
      </Card>
    </div>
  )
}
