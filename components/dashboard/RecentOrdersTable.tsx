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
  cancelled: { label: 'キャンセル済', cls: 'bg-bg-soft text-ink-faint line-through' },
}

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
        <Link href={allHref} className="inline-flex min-h-10 items-center text-xs font-medium text-trust-600 hover:underline">
          受注台帳へ →
        </Link>
      </div>

      {orders.length === 0 ? (
        <p className="flex flex-1 items-center justify-center py-8 text-sm text-ink-faint">
          まだ受注がありません
        </p>
      ) : (
        <>
          {/* スマホ: 1件を2段（取引先＋状態 / 納品日・件数・金額）。横スクロールさせない */}
          <ul className="-mx-2 divide-y divide-line/60 md:hidden">
            {orders.map((o) => {
              const s = STATUS[o.status] ?? STATUS.needs_check
              const inner = (
                <>
                  <div className="flex items-start justify-between gap-2">
                    <CustomerLabel o={o} />
                    <StatusBadge s={s} />
                  </div>
                  <div className="mt-1 flex items-baseline justify-between gap-2 text-xs text-ink-soft">
                    <span className="num">
                      納品 {o.date}・{o.itemCount}件
                    </span>
                    <span className="num text-sm font-semibold text-ink">{yen(o.amount)}</span>
                  </div>
                </>
              )
              return (
                <li key={o.id}>
                  {o.href ? (
                    <Link href={o.href} className="block min-h-10 rounded-lg px-2 py-2.5 transition-colors hover:bg-bg-soft">
                      {inner}
                    </Link>
                  ) : (
                    <div className="px-2 py-2.5">{inner}</div>
                  )}
                </li>
              )
            })}
          </ul>

          <div className="-mx-2 hidden overflow-x-auto md:block">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-ink-faint">
                  <th className="px-2 py-2 font-medium">納品日</th>
                  <th className="px-2 py-2 font-medium">取引先 ＞ 納入先</th>
                  <th className="px-2 py-2 text-right font-medium">件数</th>
                  <th className="px-2 py-2 text-right font-medium">金額</th>
                  <th className="px-2 py-2 font-medium">ステータス</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => {
                  const s = STATUS[o.status] ?? STATUS.needs_check
                  return (
                    <tr key={o.id} className="border-b border-line/60 transition-colors last:border-0 hover:bg-bg-soft">
                      <td className="num whitespace-nowrap px-2 py-2.5 text-ink-soft">{o.date}</td>
                      <td className="px-2 py-2.5 font-medium text-ink">
                        {o.href ? (
                          <Link href={o.href} className="hover:text-trust-600 hover:underline">
                            <CustomerLabel o={o} />
                          </Link>
                        ) : (
                          <CustomerLabel o={o} />
                        )}
                      </td>
                      <td className="num whitespace-nowrap px-2 py-2.5 text-right text-ink-soft">{o.itemCount}件</td>
                      <td className="num whitespace-nowrap px-2 py-2.5 text-right text-ink">{yen(o.amount)}</td>
                      <td className="whitespace-nowrap px-2 py-2.5">
                        <StatusBadge s={s} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  )
}

/** 「取引先 ＞ 納入先」。納入先が無い・取引先と同じなら取引先だけ。 */
function CustomerLabel({ o }: { o: RecentOrderRow }) {
  const dest = o.destination && o.destination !== o.customer ? o.destination : null
  return (
    <span className="min-w-0 break-words text-sm font-medium text-ink">
      {o.customer}
      {dest && (
        <>
          <span className="mx-1 text-ink-faint">＞</span>
          {dest}
        </>
      )}
    </span>
  )
}

function StatusBadge({ s }: { s: { label: string; cls: string } }) {
  return <span className={`inline-flex shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${s.cls}`}>{s.label}</span>
}
