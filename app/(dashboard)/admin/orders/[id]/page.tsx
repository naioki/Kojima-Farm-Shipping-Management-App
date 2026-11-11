import Link from 'next/link'
import { notFound } from 'next/navigation'
import { CheckCircle2, ChevronLeft, ExternalLink } from 'lucide-react'
import { ErrorState } from '@/components/ui/States'
import { Card } from '@/components/ui/Card'
import { ColorDot } from '@/components/ui/ColorDot'
import { OrderStatusBadge, intakeLabel } from '@/components/admin/OrderStatusBadge'
import { DeleteOrderButton } from '@/components/admin/DeleteOrderButton'
import { ShippingSlipIssuer } from '@/components/admin/ShippingSlipIssuer'
import { OrderDetailEditor } from '@/components/admin/OrderDetailEditor'
import { getOrderDetail } from '@/lib/orders/list'
import { resolvePendingDestination } from '@/lib/orders/pending-types'
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
    return (
      <ErrorState
        message="受注詳細を読み込めませんでした。時間をおいて再度お試しください。"
        detail={e instanceof Error ? e.message : String(e)}
      />
    )
  }
  if (!order) notFound()

  const supabase = createAdminClient()
  const [{ data: custRows, error: custErr }, { data: destRows, error: destErr }] = await Promise.all([
    supabase.from('customers').select('name').eq('is_active', true).order('name'),
    supabase
      .from('delivery_destinations')
      .select('id, code, full_name, aliases')
      .eq('customer_id', order.customerId)
      .eq('is_active', true)
      .order('sort_order'),
  ])
  if (destErr) {
    return <ErrorState message="納入先を読み込めませんでした。時間をおいて再度お試しください。" detail={destErr.message} />
  }
  // 会社名の候補は出荷票の入力補助。取れなくても注文は表示する。
  if (custErr) console.error('[admin/orders/[id]] 会社名候補の取得に失敗:', custErr.message)
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
  const isPending = order.status === 'pending_review'
  // 出荷票は承認後（収穫・出荷の予定に入ってから）だけ出す
  const canIssueSlip = order.status === 'approved' || order.status === 'shipped' || order.status === 'invoiced'
  // 承認待ちで納入先が未登録の注文は、承認画面・承認APIと同じ規則で納入先を判定して表示する
  // （画面ごとに納入先が食い違わないように）
  const pendingDest =
    isPending && !order.destinationId
      ? resolvePendingDestination({
          destinationId: null,
          destinations: (destRows ?? []).map((d) => ({
            id: d.id as string,
            code: (d.code as string | null) ?? null,
            full_name: d.full_name as string,
            aliases: (d as { aliases?: string[] | null }).aliases ?? null,
          })),
          noteText: order.note,
          productNames: order.items.map((it) => it.productName),
        })
      : null
  const pendingDestLabel = pendingDest?.destinationId
    ? destinations.find((d) => d.id === pendingDest.destinationId)?.label ?? null
    : null
  const destinationLabel =
    order.destinationName ??
    (pendingDestLabel
      ? `${pendingDestLabel}（承認時に確定）`
      : destinations.length > 0
        ? isPending
          ? '納入先 未定'
          : '納入先なし（取引先あて）'
        : null)
  const slipDestination = order.destinationName
    ? `${order.customerName}\n${order.destinationName}`
    : order.customerName

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link
          href="/admin/orders"
          className="inline-flex min-h-10 items-center gap-1 text-sm font-medium text-trust-700 hover:underline"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
          受注台帳へ戻る
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          {order.deliveryDate && !isPending && (
            <Link
              href={`/field/shipments?date=${order.deliveryDate}`}
              className="inline-flex h-10 items-center gap-1 rounded-lg border border-forest-200 bg-forest-50 px-3 text-xs font-bold text-forest-900 hover:bg-forest-100"
            >
              <span>この日の収穫・パックボードを見る</span>
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </Link>
          )}
          {canIssueSlip && (
            <ShippingSlipIssuer
              orderId={order.id}
              items={slipItems}
              defaultHeaderCompany={order.customerName}
              companyOptions={companyOptions}
              defaultDestination={slipDestination}
              deliveryDate={order.deliveryDate}
            />
          )}
        </div>
      </div>

      {/* 承認待ちの注文は、承認待ちの画面で原本と見比べて承認する */}
      {isPending && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-earth-300 bg-earth-50 p-3">
          <p className="text-sm text-ink">
            この注文は<strong>承認待ち</strong>です。承認すると収穫・パックの予定に入り、出荷票を出せるようになります。
          </p>
          <Link
            href="/admin/approvals"
            className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-earth-600 px-4 text-sm font-bold text-white hover:bg-earth-700"
          >
            <CheckCircle2 className="h-4 w-4" aria-hidden />
            承認待ちで承認する
          </Link>
        </div>
      )}

      {/* ヘッダーサマリー（取引先 ＞ 納入先） */}
      <Card className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2.5">
            <ColorDot color={order.customerColor} name={order.customerName} size="md" className="mt-1" />
            <div className="min-w-0">
              <h1 className="break-words font-display text-xl font-bold text-ink">
                {order.customerName}
                {destinationLabel && (
                  <span
                    className={
                      order.destinationName ? 'ml-1.5 text-base font-bold text-forest-800' : 'ml-1.5 text-base font-bold text-ink-soft'
                    }
                  >
                    ＞ {destinationLabel}
                  </span>
                )}
              </h1>
              <p className="text-xs text-ink-faint">受注元: {intakeLabel(order.source, order.intakeChannel)}</p>
            </div>
          </div>
          <span className="shrink-0 whitespace-nowrap">
            <OrderStatusBadge status={order.status} />
          </span>
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
        emptyDestinationLabel={isPending && destinations.length > 0 ? '未選択（承認のときに決める）' : undefined}
        initialItems={order.items}
      />

      {/* 注文の削除は、出荷票などのよく使う操作から離して一番下に置く */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-alert/30 p-3">
        <p className="text-xs text-ink-soft">間違って登録した注文は削除できます（取り消せません）。</p>
        <DeleteOrderButton orderId={order.id} customerName={order.customerName} />
      </div>
    </div>
  )
}
