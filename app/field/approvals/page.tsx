import { redirect } from 'next/navigation'
import { CheckCircle2, AlertTriangle } from 'lucide-react'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { EditableOrderCard } from '@/components/admin/EditableOrderCard'
import { getPendingOrders, pendingReasons } from '@/lib/orders/pending'
import { getStaffFeatures, canStaffUse } from '@/lib/field/features'

export const dynamic = 'force-dynamic'

/**
 * スタッフの承認（やさしい日本語）。STAFF_CAN_APPROVE が ON のときだけ表示。
 *  - 「すぐ承認できる」：取引先一致・納品日確定・全明細高確信 → そのまま承認
 *  - 「かんりしゃ かくにん まち」：まちがいが多い注文。注意喚起のうえで数量の修正・明細削除・承認ができる
 *    （現場で内容を直して確定できる）。低確信の明細は赤で示す。
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

  const all = await getPendingOrders()
  const approvable = all.filter((o) => o.staffApprovable)
  const needsCheck = all.filter((o) => !o.staffApprovable)

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center gap-2">
        <CheckCircle2 className="h-5 w-5 text-earth-700" aria-hidden />
        <h1 className="font-display text-2xl font-bold text-ink">承認（しょうにん）</h1>
      </div>

      {/* すぐ承認できる */}
      <section className="space-y-3">
        <h2 className="text-base font-bold text-ink">すぐ しょうにん できる</h2>
        <p className="text-sm text-ink-soft">まちがいの すくない 注文です。ないようを みて OK なら しょうにん します。</p>
        {approvable.length === 0 ? (
          <EmptyState title="いまは ありません" description="あたらしい 注文が くると ここに でます。" />
        ) : (
          <div className="space-y-3">
            {approvable.map((o) => (
              <EditableOrderCard
                key={o.id}
                orderId={o.id}
                customerName={o.customerName}
                customerColor={o.customerColor}
                deliveryDate={o.deliveryDate}
                needsDeliveryDate={false}
                items={o.items}
                approveLabel="OK・しょうにん"
                size="lg"
              />
            ))}
          </div>
        )}
      </section>

      {/* かんりしゃ かくにん まち（修正して承認できる・要注意） */}
      {needsCheck.length > 0 && (
        <section className="space-y-3">
          <h2 className="flex items-center gap-1.5 text-base font-bold text-ink">
            <AlertTriangle className="h-4 w-4 text-warning" aria-hidden />
            かくにん して しょうにん
          </h2>
          <p className="text-sm text-ink-soft">
            むずかしい 注文です。<b>数字を なおして から</b> しょうにん できます。まよったら かんりしゃに きいてください。
          </p>
          <div className="space-y-3">
            {needsCheck.map((o) => (
              <EditableOrderCard
                key={o.id}
                orderId={o.id}
                customerName={o.customerName}
                customerColor={o.customerColor}
                deliveryDate={o.deliveryDate}
                needsDeliveryDate={o.needsDeliveryDate}
                needsDestination={o.needsDestination}
                destinationOptions={o.destinationOptions}
                reasons={pendingReasons(o)}
                items={o.items}
                receipt={o.receipt}
                approveLabel="なおして しょうにん"
                size="lg"
              />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
