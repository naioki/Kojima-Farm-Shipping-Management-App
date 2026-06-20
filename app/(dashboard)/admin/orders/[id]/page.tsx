import Link from 'next/link'
import { redirect, notFound } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import { ErrorState } from '@/components/ui/States'
import { ColorDot } from '@/components/ui/ColorDot'
import { OrderStatusBadge, sourceLabel } from '@/components/admin/OrderStatusBadge'
import { DeleteOrderButton } from '@/components/admin/DeleteOrderButton'
import { getOrderDetail } from '@/lib/orders/list'
import { yen } from '@/lib/format'

export const dynamic = 'force-dynamic'

const fullDate = (d: string | null) => {
  if (!d) return '未定'
  const dt = new Date(`${d}T00:00:00Z`)
  return `${dt.getUTCFullYear()}/${String(dt.getUTCMonth() + 1).padStart(2, '0')}/${String(dt.getUTCDate()).padStart(2, '0')}`
}

const FIELD_STATUS: Record<string, { label: string; cls: string }> = {
  not_started: { label: '未着手', cls: 'text-ink-faint' },
  packed: { label: '梱包完了', cls: 'text-earth-700' },
  shipped: { label: '出荷済み', cls: 'text-trust-700' },
}

/** 受注詳細（管理者・読み取り）。明細・荷姿状態・確信度を1画面で確認する。 */
export default async function AdminOrderDetailPage({ params }: { params: { id: string } }) {
  const user = await getAuthedUser()
  if (!user) redirect('/login')

  const supabase = createClient()
  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).maybeSingle()
  if (profile?.role !== 'admin') {
    return <ErrorState title="権限がありません" message="受注詳細は管理者のみです。" />
  }

  let order
  try {
    order = await getOrderDetail(params.id)
  } catch (e) {
    const message = e instanceof Error ? e.message : '受注詳細の取得に失敗しました'
    return <ErrorState message={message} />
  }
  if (!order) notFound()

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between gap-3">
        <Link
          href="/admin/orders"
          className="inline-flex items-center gap-1 text-sm font-medium text-trust-600 hover:underline"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
          受注一覧へ戻る
        </Link>
        <DeleteOrderButton orderId={order.id} customerName={order.customerName} />
      </div>

      {/* ヘッダー */}
      <Card className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <ColorDot color={order.customerColor} name={order.customerName} size="md" />
            <div>
              <h1 className="font-display text-xl font-bold text-ink">{order.customerName}</h1>
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
            <dd className="num text-ink">{fullDate(order.deliveryDate)}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-faint">合計金額</dt>
            <dd className="num font-bold text-ink">{yen(order.total)}</dd>
          </div>
        </dl>
        {order.note && (
          <p className="rounded-lg bg-bg-soft px-3 py-2 text-sm text-ink-soft">{order.note}</p>
        )}
      </Card>

      {/* 明細 */}
      <Card variant="elevated" className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-ink-faint">
                <th className="px-4 py-2.5 font-medium">商品</th>
                <th className="px-4 py-2.5 text-right font-medium">数量</th>
                <th className="px-4 py-2.5 text-right font-medium">単価</th>
                <th className="px-4 py-2.5 text-right font-medium">金額</th>
                <th className="px-4 py-2.5 font-medium">現場</th>
              </tr>
            </thead>
            <tbody>
              {order.items.map((it) => {
                const fs = it.fieldStatus ? FIELD_STATUS[it.fieldStatus] : undefined
                const lowConf = it.confidence != null && it.confidence < 0.7
                return (
                  <tr key={it.id} className="border-b border-line/60 last:border-0">
                    <td className="px-4 py-3">
                      <span className="font-medium text-ink">{it.productName}</span>
                      {lowConf && (
                        <span className="num ml-2 text-xs text-alert">確信度 {Math.round(it.confidence! * 100)}%</span>
                      )}
                    </td>
                    <td className="num whitespace-nowrap px-4 py-3 text-right text-ink">
                      {it.quantity} {it.unit}
                    </td>
                    <td className="num whitespace-nowrap px-4 py-3 text-right text-ink-soft">
                      {it.unitPrice != null ? yen(it.unitPrice) : '—'}
                    </td>
                    <td className="num whitespace-nowrap px-4 py-3 text-right text-ink">{yen(it.lineTotal)}</td>
                    <td className={`whitespace-nowrap px-4 py-3 text-xs ${fs?.cls ?? 'text-ink-faint'}`}>
                      {fs?.label ?? '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-line">
                <td className="px-4 py-3 text-sm font-medium text-ink-soft" colSpan={3}>
                  合計
                </td>
                <td className="num px-4 py-3 text-right font-bold text-ink">{yen(order.total)}</td>
                <td aria-hidden />
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>
    </div>
  )
}
