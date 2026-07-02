import { CheckCircle2 } from 'lucide-react'
import { EmptyState } from '@/components/ui/States'
import { EditableOrderCard } from '@/components/admin/EditableOrderCard'
import { getPendingOrders, pendingReasons } from '@/lib/orders/pending'
import { requireAdmin } from '@/lib/auth/require-admin'

export const dynamic = 'force-dynamic'

const SOURCE_LABEL: Record<string, string> = { fax: 'FAX', email: 'メール', portal: 'ポータル', manual: '手動' }

/**
 * 注文の承認（管理者）。pending_review の注文を確認・修正して承認＝収穫タスク生成。
 * FAX/メール等で確信度が低い明細は赤＋注意喚起。数量はその場で修正し、誤った明細は削除できる。
 * 納品日が無い注文は承認時に日付入力を促す。
 */
export default async function AdminApprovalsPage() {
  const guard = await requireAdmin('承認は管理者のみです。')
  if (guard) return guard

  const orders = await getPendingOrders()

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center gap-2">
        <CheckCircle2 className="h-5 w-5 text-earth-700" aria-hidden />
        <h1 className="font-display text-2xl font-bold text-ink">注文の承認</h1>
      </div>
      <p className="text-sm text-ink-soft">内容を確認し、必要なら数量を直して（誤りは明細削除）から承認します。</p>

      {orders.length === 0 ? (
        <EmptyState title="承認待ちの注文はありません" description="ポータル・手動・取り込みで承認待ちが発生するとここに出ます。" />
      ) : (
        <div className="space-y-3">
          {orders.map((o) => (
            <div key={o.id}>
              <p className="mb-1 px-1 text-xs text-ink-faint">{SOURCE_LABEL[o.source] ?? o.source} から受信</p>
              <EditableOrderCard
                orderId={o.id}
                customerName={o.customerName}
                customerColor={o.customerColor}
                deliveryDate={o.deliveryDate}
                needsDeliveryDate={o.needsDeliveryDate}
                needsDestination={o.needsDestination}
                destinationOptions={o.destinationOptions}
                reasons={pendingReasons(o)}
                items={o.items}
                approveLabel="承認する"
                size="md"
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
