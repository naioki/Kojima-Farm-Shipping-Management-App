import { redirect } from 'next/navigation'
import { CheckCircle2, AlertTriangle } from 'lucide-react'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { ColorDot } from '@/components/ui/ColorDot'
import { ApproveOrderButton } from '@/components/admin/ApproveOrderButton'
import { getPendingOrders, type PendingOrder } from '@/lib/orders/pending'
import { getStaffFeatures, canStaffUse } from '@/lib/field/features'

export const dynamic = 'force-dynamic'

/** 要確認の理由（やさしい日本語のバッジ）。 */
function reasonsFor(o: PendingOrder): string[] {
  const r: string[] = []
  if (!o.customerId) r.push('取引先 みとうろく')
  if (o.needsDeliveryDate) r.push('のうひん日 みてい')
  if (o.minConfidence == null || o.minConfidence < 0.7) r.push('AI じしんなし')
  return r
}

/**
 * スタッフの承認（やさしい日本語）。STAFF_CAN_APPROVE が ON のときだけ表示。
 *  - 「すぐ承認できる」：取引先一致・納品日確定・全明細高確信 → ワンタップ承認
 *  - 「かんりしゃ かくにん まち」：まちがいが多い注文も "閲覧専用" で見せる（現場で内容を確認できる。
 *    承認ボタンは出さない＝確定は管理者）。確信度の低い明細は赤で示す。
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
  const needsAdmin = all.filter((o) => !o.staffApprovable)

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center gap-2">
        <CheckCircle2 className="h-5 w-5 text-earth-700" aria-hidden />
        <h1 className="font-display text-2xl font-bold text-ink">承認（しょうにん）</h1>
      </div>

      {/* すぐ承認できる */}
      <section className="space-y-3">
        <h2 className="text-base font-bold text-ink">すぐ しょうにん できる</h2>
        <p className="text-sm text-ink-soft">まちがいの すくない 注文です。ないようを みて OK なら ボタンを おします。</p>
        {approvable.length === 0 ? (
          <EmptyState title="いまは ありません" description="あたらしい 注文が くると ここに でます。" />
        ) : (
          <div className="space-y-3">
            {approvable.map((o) => (
              <Card key={o.id} className="space-y-3">
                <div className="flex items-center gap-2">
                  <ColorDot color={o.customerColor} name={o.customerName} size="md" />
                  <div>
                    <p className="font-medium text-ink">{o.customerName}</p>
                    <p className="text-xs text-ink-soft">のうひん {o.deliveryDate}</p>
                  </div>
                </div>
                <ul className="divide-y divide-line rounded border border-line">
                  {o.items.map((it) => (
                    <li key={it.id} className="flex items-center justify-between px-3 py-2.5 text-base">
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
      </section>

      {/* かんりしゃ かくにん まち（閲覧専用） */}
      {needsAdmin.length > 0 && (
        <section className="space-y-3">
          <h2 className="flex items-center gap-1.5 text-base font-bold text-ink">
            <AlertTriangle className="h-4 w-4 text-warning" aria-hidden />
            かんりしゃ かくにん まち
          </h2>
          <p className="text-sm text-ink-soft">
            むずかしい 注文です。ないようの <b>かくにんだけ</b> できます（しょうにんは かんりしゃが します）。
          </p>
          <div className="space-y-3">
            {needsAdmin.map((o) => {
              const reasons = reasonsFor(o)
              return (
                <Card key={o.id} className="space-y-3 border-warning/40">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <ColorDot color={o.customerColor} name={o.customerName} size="md" />
                      <div>
                        <p className="font-medium text-ink">{o.customerName}</p>
                        <p className="text-xs text-ink-soft">のうひん {o.deliveryDate ?? 'みてい'}</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap justify-end gap-1">
                      {reasons.map((r) => (
                        <span key={r} className="rounded-full bg-warning-bg px-2 py-0.5 text-xs font-medium text-warning">
                          {r}
                        </span>
                      ))}
                    </div>
                  </div>
                  <ul className="divide-y divide-line rounded border border-line">
                    {o.items.map((it) => {
                      const low = it.confidence == null || it.confidence < 0.7
                      return (
                        <li key={it.id} className="flex items-center justify-between px-3 py-2.5 text-base">
                          <span className="text-ink">{it.productName}</span>
                          <span className="flex items-center gap-2">
                            <span className="num font-bold tabular-nums text-ink">{it.quantity} {it.unit}</span>
                            {low && (
                              <span className="num text-xs font-medium text-alert">
                                {it.confidence != null ? `${Math.round(it.confidence * 100)}%` : '?'}
                              </span>
                            )}
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                  <p className="text-xs text-ink-soft">
                    なおす ときは かんりしゃに つたえてください。
                  </p>
                </Card>
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}
