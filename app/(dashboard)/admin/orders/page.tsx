import Link from 'next/link'
import { ClipboardList, ChevronRight, Table, Filter, Plus } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { ColorDot } from '@/components/ui/ColorDot'
import { OrderStatusBadge, sourceLabel, ORDER_STATUS_OPTIONS } from '@/components/admin/OrderStatusBadge'
import { getOrdersList, type OrderFilter } from '@/lib/orders/list'
import { yen } from '@/lib/format'
import { requireAdmin } from '@/lib/auth/require-admin'
import { formatJpDateShort } from '@/lib/dates'

export const dynamic = 'force-dynamic'

const mdShort = (d: string | null) => (d ? formatJpDateShort(d) : '—')

const inputCls =
  'h-10 rounded border border-line-strong bg-bg-card px-3 text-sm text-ink focus:border-trust-500 focus:outline-none focus:ring-2 focus:ring-trust-100'

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? ''

/**
 * 受注一覧（管理者）。状態・取引先・期間で絞り込み、各行から受注詳細へ遷移する。
 * 絞り込み条件はそのまま CSV 出力にも適用される。承認待ちだけは /admin/approvals。
 */
export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: { status?: string; customerId?: string; start?: string; end?: string }
}) {
  const guard = await requireAdmin('受注一覧は管理者のみです。')
  if (guard) return guard

  const supabase = createClient()

  const filter: OrderFilter = {
    status: first(searchParams.status),
    customerId: first(searchParams.customerId),
    start: first(searchParams.start),
    end: first(searchParams.end),
  }
  const hasFilter = Boolean(filter.status || filter.customerId || filter.start || filter.end)

  const csvQuery = new URLSearchParams()
  if (filter.status) csvQuery.set('status', filter.status)
  if (filter.customerId) csvQuery.set('customerId', filter.customerId)
  if (filter.start) csvQuery.set('start', filter.start)
  if (filter.end) csvQuery.set('end', filter.end)
  const csvHref = `/api/admin/orders/csv${csvQuery.toString() ? `?${csvQuery}` : ''}`

  let orders
  let customers: { id: string; name: string }[] = []
  try {
    const [ordersData, custRes] = await Promise.all([
      getOrdersList(filter),
      supabase.from('customers').select('id, name').eq('is_active', true).order('name'),
    ])
    orders = ordersData
    customers = custRes.data ?? []
  } catch (e) {
    const message = e instanceof Error ? e.message : '受注一覧の取得に失敗しました'
    return <ErrorState message={message} />
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ClipboardList className="h-5 w-5 text-earth-700" aria-hidden />
          <h1 className="font-display text-2xl font-bold text-ink">受注一覧</h1>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/admin/orders/new"
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-earth-600 px-3 text-sm font-medium text-white transition-colors hover:bg-earth-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-earth-400"
          >
            <Plus className="h-4 w-4" aria-hidden />
            新規受注
          </Link>
          <a
            href={csvHref}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-line-strong bg-bg-card px-3 text-sm font-medium text-ink transition-colors hover:bg-bg-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-trust-100"
          >
            <Table className="h-4 w-4" aria-hidden />
            CSV出力
          </a>
        </div>
      </div>

      {/* 絞り込みバー（GET フォーム：JS不要・URLに条件が残る） */}
      <Card className="p-3">
        <form method="get" className="flex flex-wrap items-end gap-3">
          <label className="space-y-1">
            <span className="block text-xs font-medium text-ink-soft">状態</span>
            <select name="status" defaultValue={filter.status} className={inputCls}>
              <option value="">すべて</option>
              {ORDER_STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="block text-xs font-medium text-ink-soft">取引先</span>
            <select name="customerId" defaultValue={filter.customerId} className={inputCls}>
              <option value="">すべて</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="block text-xs font-medium text-ink-soft">受注日（開始）</span>
            <input type="date" name="start" defaultValue={filter.start} className={inputCls} />
          </label>
          <label className="space-y-1">
            <span className="block text-xs font-medium text-ink-soft">受注日（終了）</span>
            <input type="date" name="end" defaultValue={filter.end} className={inputCls} />
          </label>
          <button
            type="submit"
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-earth-600 px-4 text-sm font-medium text-white transition-colors hover:bg-earth-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-earth-400"
          >
            <Filter className="h-4 w-4" aria-hidden />
            絞り込む
          </button>
          {hasFilter && (
            <Link href="/admin/orders" className="text-sm font-medium text-trust-600 hover:underline">
              クリア
            </Link>
          )}
        </form>
      </Card>

      {orders.length === 0 ? (
        <EmptyState
          title={hasFilter ? '条件に一致する受注がありません' : 'まだ受注がありません'}
          description={
            hasFilter
              ? '絞り込み条件を変えてお試しください。'
              : 'ポータル・手動入力・取り込みで受注が入るとここに一覧表示されます。'
          }
        />
      ) : (
        <Card variant="elevated" className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-ink-faint">
                  <th className="px-4 py-2.5 font-medium">受注日</th>
                  <th className="px-4 py-2.5 font-medium">納品日</th>
                  <th className="px-4 py-2.5 font-medium">取引先</th>
                  <th className="px-4 py-2.5 font-medium">受注元</th>
                  <th className="px-4 py-2.5 text-right font-medium">件数</th>
                  <th className="px-4 py-2.5 text-right font-medium">金額</th>
                  <th className="px-4 py-2.5 font-medium">状態</th>
                  <th className="px-2 py-2.5" aria-hidden />
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id} className="border-b border-line/60 transition-colors last:border-0 hover:bg-bg-soft">
                    <td className="num whitespace-nowrap px-4 py-3 text-ink-soft">{mdShort(o.orderDate)}</td>
                    <td className="num whitespace-nowrap px-4 py-3 text-ink-soft">{mdShort(o.deliveryDate)}</td>
                    <td className="px-4 py-3">
                      <span className="flex min-w-0 items-center gap-2 font-medium text-ink">
                        <ColorDot color={o.customerColor} name={o.customerName} />
                        <span className="min-w-0 truncate">
                          {o.customerName}
                          {o.destinationName && (
                            <span className="ml-1 font-normal text-ink-soft">＞{o.destinationName}</span>
                          )}
                        </span>
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-ink-faint">{sourceLabel(o.source)}</td>
                    <td className="num whitespace-nowrap px-4 py-3 text-right text-ink-soft">{o.itemCount}件</td>
                    <td className="num whitespace-nowrap px-4 py-3 text-right text-ink">{yen(o.amount)}</td>
                    <td className="px-4 py-3"><OrderStatusBadge status={o.status} /></td>
                    <td className="px-2 py-3">
                      <Link
                        href={`/admin/orders/${o.id}`}
                        aria-label={`${o.customerName} の受注詳細`}
                        className="inline-flex items-center gap-0.5 whitespace-nowrap rounded px-1.5 py-1 text-xs font-medium text-trust-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-trust-100"
                      >
                        詳細<ChevronRight className="h-3.5 w-3.5" aria-hidden />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}
