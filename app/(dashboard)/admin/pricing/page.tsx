import { Coins } from 'lucide-react'
import { EmptyState } from '@/components/ui/States'
import { PricingPrep } from '@/components/admin/PricingPrep'
import { getPricingItemsFlat } from '@/lib/pricing/pending'
import { requireAdmin } from '@/lib/auth/require-admin'

export const dynamic = 'force-dynamic'

/**
 * 請求準備：価格確定（管理者）。
 * 出荷済み・出荷予定（承認済み）で価格未確定の明細を確定する（後決め単価・赤点の数量減）。
 * 確定分のみが請求に含まれる（lib/invoices/generate のゲート）。
 */
export default async function PricingPage() {
  const guard = await requireAdmin('価格確定は管理者のみです。')
  if (guard) return guard

  const items = await getPricingItemsFlat()

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex items-center gap-2">
        <Coins className="h-5 w-5 text-earth-700" aria-hidden />
        <h1 className="font-display text-2xl font-bold text-ink">請求前の単価確認</h1>
      </div>
      <p className="text-sm text-ink-soft">
        出荷済み・出荷予定の注文のうち、単価が未確定の明細です。価格表から一括確定するか、行ごとに単価・請求数量（赤点などで減らす場合）を入れて確定します。
        確定した明細だけが請求書に載ります。税率は注文時のまま変わりません。
      </p>

      {items.length === 0 ? (
        <EmptyState title="価格確定が必要な明細はありません" description="承認・出荷された注文に単価が未確定の明細があると、ここに表示されます。" />
      ) : (
        <PricingPrep items={items} />
      )}
    </div>
  )
}
