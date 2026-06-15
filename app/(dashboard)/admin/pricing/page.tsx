import { redirect } from 'next/navigation'
import { Coins } from 'lucide-react'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { PricingPrep } from '@/components/admin/PricingPrep'
import { getPricingItemsFlat } from '@/lib/pricing/pending'

export const dynamic = 'force-dynamic'

/**
 * 請求準備：価格確定（管理者）。
 * 出荷済みで価格未確定の明細を取引先ごとに確定する（後決め単価・赤点の数量減）。
 * 確定分のみが請求に含まれる（lib/invoices/generate のゲート）。
 */
export default async function PricingPage() {
  const user = await getAuthedUser()
  if (!user) redirect('/login')

  const supabase = createClient()
  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).maybeSingle()
  if (profile?.role !== 'admin') {
    return <ErrorState title="権限がありません" message="価格確定は管理者のみです。" />
  }

  const items = await getPricingItemsFlat()

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center gap-2">
        <Coins className="h-5 w-5 text-earth-700" aria-hidden />
        <h1 className="font-display text-2xl font-bold text-ink">請求準備（価格確定）</h1>
      </div>
      <p className="text-sm text-ink-soft">
        出荷済みで単価が未確定の明細です。価格表から一括確定、または個別に単価・請求数量（赤点は数量減）を入れて確定します。
      </p>

      {items.length === 0 ? (
        <EmptyState title="価格確定が必要な明細はありません" description="出荷後に未確定の明細が出るとここに表示されます。" />
      ) : (
        <PricingPrep items={items} />
      )}
    </div>
  )
}
