import { redirect } from 'next/navigation'
import { CheckCircle2, AlertTriangle } from 'lucide-react'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { ColorDot } from '@/components/ui/ColorDot'
import { ApproveOrderButton } from '@/components/admin/ApproveOrderButton'
import { getPendingOrders } from '@/lib/orders/pending'

export const dynamic = 'force-dynamic'

const SOURCE_LABEL: Record<string, string> = { fax: 'FAX', email: 'メール', portal: 'ポータル', manual: '手動' }

/**
 * 注文の承認（管理者）。pending_review の注文を確認して承認＝収穫タスク生成。
 * 確信度が低い明細は赤で警告。納品日が無い注文は承認時に日付入力を促す。
 */
export default async function AdminApprovalsPage() {
  const user = await getAuthedUser()
  if (!user) redirect('/login')

  const supabase = createClient()
  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).maybeSingle()
  if (profile?.role !== 'admin') {
    return <ErrorState title="権限がありません" message="承認は管理者のみです。" />
  }

  const orders = await getPendingOrders()

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center gap-2">
        <CheckCircle2 className="h-5 w-5 text-earth-700" aria-hidden />
        <h1 className="font-display text-2xl font-bold text-ink">注文の承認</h1>
      </div>

      {orders.length === 0 ? (
        <EmptyState title="承認待ちの注文はありません" description="ポータル・手動・取り込みで承認待ちが発生するとここに出ます。" />
      ) : (
        <div className="space-y-3">
          {orders.map((o) => {
            const lowConf = o.minConfidence == null || o.minConfidence < 0.7
            return (
              <Card key={o.id} className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <ColorDot color={o.customerColor} name={o.customerName} size="md" />
                    <div>
                      <p className="font-medium text-ink">{o.customerName}</p>
                      <p className="text-xs text-ink-faint">
                        {SOURCE_LABEL[o.source] ?? o.source}
                        ・納品 {o.deliveryDate ?? '未定'}
                      </p>
                    </div>
                  </div>
                  {lowConf && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-alert-bg px-2 py-0.5 text-xs font-medium text-alert">
                      <AlertTriangle className="h-3 w-3" aria-hidden />
                      要確認
                    </span>
                  )}
                </div>

                <ul className="divide-y divide-line rounded border border-line">
                  {o.items.map((it) => {
                    const itemLow = it.confidence == null || it.confidence < 0.7
                    return (
                      <li key={it.id} className="flex items-center justify-between px-3 py-2 text-sm">
                        <span className="text-ink">{it.productName}</span>
                        <span className="flex items-center gap-3">
                          <span className="num font-bold tabular-nums text-ink">
                            {it.quantity} {it.unit}
                          </span>
                          <span className={itemLow ? 'num text-xs text-alert' : 'num text-xs text-harvest-600'}>
                            {it.confidence != null ? `${Math.round(it.confidence * 100)}%` : '—'}
                          </span>
                        </span>
                      </li>
                    )
                  })}
                </ul>

                <div className="flex justify-end">
                  <ApproveOrderButton orderId={o.id} needsDeliveryDate={o.needsDeliveryDate} />
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
