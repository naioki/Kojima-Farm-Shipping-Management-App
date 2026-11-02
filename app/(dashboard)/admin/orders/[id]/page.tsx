import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronLeft, ExternalLink } from 'lucide-react'
import { ErrorState } from '@/components/ui/States'
import { Card } from '@/components/ui/Card'
import { ColorDot } from '@/components/ui/ColorDot'
import { OrderStatusBadge, sourceLabel } from '@/components/admin/OrderStatusBadge'
import { DeleteOrderButton } from '@/components/admin/DeleteOrderButton'
import { ShippingSlipIssuer } from '@/components/admin/ShippingSlipIssuer'
import { OrderDetailEditor } from '@/components/admin/OrderDetailEditor'
import { getOrderDetail } from '@/lib/orders/list'
import { createAdminClient } from '@/lib/supabase/admin'
import { yen } from '@/lib/format'
import { requireAdmin } from '@/lib/auth/require-admin'
import { formatJpDate } from '@/lib/dates'

export const dynamic = 'force-dynamic'

const fullDate = (d: string | null) => (d ? formatJpDate(d) : '未定')

/**
 * 受注詳細・インライン編集画面（#38 納品日・納入先・数量・規格・コンテナ・単価の編集に完全対応）。
 */
export default async function AdminOrderDetailPage({ params }: { params: { id: string } }) {
  const guard = await requireAdmin('受注詳細は管理者のみです。')
  if (guard) return guard

  let order
  try {
    order = await getOrderDetail(params.id)
  } catch (e) {
    const message = e instanceof Error ? e.message : '受注詳細の取得に失敗しました'
    return <ErrorState message={message} />
  }
  if (!order) notFound()

  const supabase = createAdminClient()
  const [{ data: custRows }, { data: destRows }] = await Promise.all([
    supabase.from('customers').select('name').eq('is_active', true).order('name'),
    supabase
      .from('delivery_destinations')
      .select('id, code, full_name')
      .eq('customer_id', order.customerId)
      .eq('is_active', true)
      .order('sort_order'),
  ])
  const companyOptions = [...new Set((custRows ?? []).map((c) => c.name as string))]
  const destinations = (destRows ?? []).map((d) => ({
    id: d.id as string,
    label: (d.code as string | null)?.trim() || (d.full_name as string),
  }))

  const slipItems = order.items.map((it) => ({
    id: it.id,
    productName: it.productName,
    total: it.quantity ? String(it.quantity) : '',
    spec: it.spec ?? '',
    mateHan: it.containerType ?? '',
  }))
  const slipDestination = order.destinationName
    ? `${order.customerName}\n${order.destinationName}`
    : order.customerName

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/admin/orders"
          className="inline-flex items-center gap-1 text-sm font-medium text-trust-600 hover:underline"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
          受注一覧へ戻る
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          {order.deliveryDate && (
            <Link
              href={`/field/shipments?date=${order.deliveryDate}`}
              className="inline-flex h-9 items-center gap-1 rounded-lg border border-forest-300 bg-forest-50 px-3 text-xs font-bold text-forest-900 hover:bg-forest-100"
            >
              <span>🥬 この日のパックボードを見る</span>
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          )}
          <ShippingSlipIssuer
            orderId={order.id}
            items={slipItems}
            defaultHeaderCompany={order.customerName}
            companyOptions={companyOptions}
            defaultDestination={slipDestination}
            deliveryDate={order.deliveryDate}
          />
          <DeleteOrderButton orderId={order.id} customerName={order.customerName} />
        </div>
      </div>

      {/* ヘッダーサマリー */}
      <Card className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <ColorDot color={order.customerColor} name={order.customerName} size="md" />
            <div>
              <h1 className="font-display text-xl font-bold text-ink">
                {order.customerName}
                {order.destinationName && (
                  <span className="ml-1.5 text-base font-bold text-emerald-800">＞{order.destinationName}</span>
                )}
              </h1>
              <p className="text-xs text-ink-faint">受注元: {sourceLabel(order.source)}</p>
            </div>
          </div>
          <OrderStatusBadge status={order.status} />
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-ink-faint">受注日</dt>
            <dd className="num text-ink">{fullDate(order.orderDate)}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-faint">納品日</dt>
            <dd className="num font-black text-forest-900">{fullDate(order.deliveryDate)}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-faint">合計金額</dt>
            <dd className="num font-bold text-ink">{yen(order.total)}</dd>
          </div>
        </dl>
      </Card>

      {/* #38 インライン編集コンポーネント */}
      <OrderDetailEditor
        orderId={order.id}
        customerName={order.customerName}
        initialDeliveryDate={order.deliveryDate}
        initialDestinationId={order.destinationId}
        initialNote={order.note}
        destinations={destinations}
        initialItems={order.items}
      />
    </div>
  )
}
