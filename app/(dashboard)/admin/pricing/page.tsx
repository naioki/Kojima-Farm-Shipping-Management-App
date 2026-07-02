import { Coins } from 'lucide-react'
import { EmptyState } from '@/components/ui/States'
import { PricingPrep } from '@/components/admin/PricingPrep'
import { getPricingItemsFlat } from '@/lib/pricing/pending'
import { requireAdmin } from '@/lib/auth/require-admin'

export const dynamic = 'force-dynamic'

/**
 * 請求準備：価格確定（管理者）。
 * 出荷済みで価格未確定の明細を取引先ごとに確定する（後決め単価・赤点の数量減）。
 * 確定分のみが請求に含まれる（lib/invoices/generate のゲート）。
 */
export default async function PricingPage() {
  const guard = await requireAdmin('価格確定は管理者のみです。')
  if (guard) return guard

  const items = await getPricingItemsFlat()

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center gap-2">
        <Coins className="h-5 w-5 text-earth-700" aria-hidden />
        <h1 className="font-display text-2xl font-bold text-ink">価格の確定（月次）</h1>
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
