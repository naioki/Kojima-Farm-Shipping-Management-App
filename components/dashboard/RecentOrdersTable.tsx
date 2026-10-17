import Link from 'next/link'
import { Card } from '@/components/ui/Card'
import { yen } from '@/lib/format'
import type { OrderStatusKey, RecentOrderRow } from './types'

const STATUS: Record<OrderStatusKey, { label: string; cls: string }> = {
  pending_review: { label: '承認待ち', cls: 'bg-earth-100 text-earth-700' },
  needs_check: { label: '要確認', cls: 'bg-warning-bg text-warning' },
  approved: { label: '承認済み', cls: 'bg-harvest-100 text-harvest-700' },
  shipped: { label: '出荷済み', cls: 'bg-trust-100 text-trust-700' },
  invoiced: { label: '請求済み', cls: 'bg-bg-soft text-ink-soft' },
}

/** 最新の受注（直近数件）。空状態あり（react-ui-patterns）。 */
export function RecentOrdersTable({
  orders,
  allHref = '/admin/orders',
}: {
  orders: RecentOrderRow[]
  allHref?: string
}) {
  return (
    <Card variant="elevated" className="flex h-full flex-col">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink">最新の受注</h2>
        <Link href={allHref} className="text-xs font-medium text-trust-600 hover:underline">
          受注一覧へ →
        </Link>
      </div>

      {orders.length === 0 ? (
        <p className="flex flex-1 items-center justify-center py-8 text-sm text-ink-faint">
          まだ受注がありません
        </p>
      ) : (
        <div className="-mx-2 overflow-x-auto">
          <table className="w-full min-w-[460px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-ink-faint">
                <th className="px-2 py-2 font-medium">受注日</th>
                <th className="px-2 py-2 font-medium">取引先</th>
                <th className="px-2 py-2 text-right font-medium">件数</th>
                <th className="px-2 py-2 text-right font-medium">金額</th>
                <th className="px-2 py-2 font-medium">ステータス</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => {
                const s = STATUS[o.status]
                const row = (
                  <>
                    <td className="num whitespace-nowrap px-2 py-2.5 text-ink-soft">{o.date}</td>
                    <td className="px-2 py-2.5 font-medium text-ink">
                      {o.href ? (
                        <Link href={o.href} className="hover:text-trust-600 hover:underline">
                          {o.customer}
                        </Link>
                      ) : (
                        o.customer
                      )}
                    </td>
                    <td className="num px-2 py-2.5 text-right text-ink-soft">{o.itemCount}件</td>
                    <td className="num px-2 py-2.5 text-right text-ink">{yen(o.amount)}</td>
                    <td className="px-2 py-2.5">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${s.cls}`}>
                        {s.label}
                      </span>
                    </td>
                  </>
                )
                return (
                  <tr
                    key={o.id}
                    className="border-b border-line/60 transition-colors last:border-0 hover:bg-bg-soft"
                  >
                    {row}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}
