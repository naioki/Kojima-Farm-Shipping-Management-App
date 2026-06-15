import { redirect } from 'next/navigation'
import { CheckCircle2 } from 'lucide-react'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { ColorDot } from '@/components/ui/ColorDot'
import { ApproveOrderButton } from '@/components/admin/ApproveOrderButton'
import { getPendingOrders } from '@/lib/orders/pending'
import { getStaffFeatures, canStaffUse } from '@/lib/field/features'

export const dynamic = 'force-dynamic'

/**
 * スタッフの承認（高確信のみ・ワンタップ）。
 * STAFF_CAN_APPROVE が ON のときだけ表示。さらに「取引先一致・納品日確定・全明細高確信」を
 * 満たす注文だけを並べる（それ以外は管理者専用なので出さない）。やさしい日本語。
 */
export default async function FieldApprovalsPage() {
  const user = await getAuthedUser()
  if (!user) redirect('/login')

  const supabase = createClient()
  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).maybeSingle()
  const role = (profile?.role as 'admin' | 'staff') ?? 'staff'

  const features = await getStaffFeatures()
  if (!canStaffUse('approve', role, features)) {
    return (
      <ErrorState
        title="まだ使えません"
        message="承認は管理者が「設定 → 現場機能の解放」でONにすると使えます。"
      />
    )
  }

  // スタッフが承認できる（高確信・取引先一致・納品日確定）注文だけ表示。
  const orders = (await getPendingOrders()).filter((o) => o.staffApprovable)

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center gap-2">
        <CheckCircle2 className="h-5 w-5 text-earth-700" aria-hidden />
        <h1 className="font-display text-2xl font-bold text-ink">承認（しょうにん）</h1>
      </div>
      <p className="text-sm text-ink-soft">
        まちがいの すくない 注文だけ ここに でます。むずかしい ものは かんりしゃが かくにん します。
      </p>

      {orders.length === 0 ? (
        <EmptyState title="しょうにん する ものは ありません" description="あたらしい 注文が くると ここに でます。" />
      ) : (
        <div className="space-y-3">
          {orders.map((o) => (
            <Card key={o.id} className="space-y-3">
              <div className="flex items-center gap-2">
                <ColorDot color={o.customerColor} name={o.customerName} size="md" />
                <div>
                  <p className="font-medium text-ink">{o.customerName}</p>
                  <p className="text-xs text-ink-faint">のうひん {o.deliveryDate}</p>
                </div>
              </div>
              <ul className="divide-y divide-line rounded border border-line">
                {o.items.map((it) => (
                  <li key={it.id} className="flex items-center justify-between px-3 py-2 text-sm">
                    <span className="text-ink">{it.productName}</span>
                    <span className="num font-bold tabular-nums text-ink">{it.quantity} {it.unit}</span>
                  </li>
                ))}
              </ul>
              <div className="flex justify-end">
                <ApproveOrderButton orderId={o.id} needsDeliveryDate={false} label="OK・しょうにん" size="lg" />
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
