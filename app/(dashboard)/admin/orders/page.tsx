import Link from 'next/link'
import { ClipboardList, ChevronRight, Table, Filter, Plus } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { Card } from '@/components/ui/Card'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { ColorDot } from '@/components/ui/ColorDot'
import { OrderStatusBadge, intakeLabel, ORDER_STATUS_OPTIONS } from '@/components/admin/OrderStatusBadge'
import { getOrdersList, type OrderFilter } from '@/lib/orders/list'
import { yen } from '@/lib/format'
import { requireAdmin } from '@/lib/auth/require-admin'
import { formatJpDate, formatJpDateShort, jstTodayStr } from '@/lib/dates'

export const dynamic = 'force-dynamic'

const mdShort = (d: string | null) => (d ? formatJpDateShort(d) : '—')

/** 今月の初日・末日（JST基準）。受注一覧の既定期間に使う。 */
function currentMonthRange(): { start: string; end: string } {
  const today = jstTodayStr() // YYYY-MM-DD
  const [y, m] = today.split('-').map(Number) as [number, number]
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate() // 翌月0日＝今月末日
  const mm = String(m).padStart(2, '0')
  return { start: `${y}-${mm}-01`, end: `${y}-${mm}-${String(lastDay).padStart(2, '0')}` }
}

const inputCls =
  'h-10 rounded border border-line-strong bg-bg-card px-3 text-sm text-ink focus:border-trust-500 focus:outline-none focus:ring-2 focus:ring-trust-100'

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? ''

/**
 * 受注台帳（管理者）。状態・取引先・期間で絞り込み、各行から受注詳細へ遷移する。
 * 新しい注文の入力は「注文の受付」（/admin/orders/new）に一本化（旧クイック注文モーダルは廃止）。
 */
export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: { status?: string; customerId?: string; start?: string; end?: string; all?: string }
}) {
  const guard = await requireAdmin('受注台帳は管理者のみです。')
  if (guard) return guard

  const supabase = createAdminClient()

  const showAll = first(searchParams.all) === '1'
  const rawStart = first(searchParams.start)
  const rawEnd = first(searchParams.end)
  // 期間の指定も「全期間」指定も無い＝初回表示 → 今月を既定にする
  const usingDefaultPeriod = !showAll && !rawStart && !rawEnd
  const period = usingDefaultPeriod ? currentMonthRange() : { start: rawStart, end: rawEnd }

  const filter: OrderFilter = {
    status: first(searchParams.status),
    customerId: first(searchParams.customerId),
    start: period.start,
    end: period.end,
  }
  // 既定の「今月」は絞り込み扱いにしない（クリアの対象はユーザーが自分で入れた条件）
  const hasFilter = Boolean(filter.status || filter.customerId || (!usingDefaultPeriod && (filter.start || filter.end)))

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
    if (custRes.error) throw new Error(`取引先の取得に失敗しました: ${custRes.error.message}`)
    orders = ordersData
    customers = (custRes.data ?? []) as { id: string; name: string }[]
  } catch (e) {
    return (
      <ErrorState
        message="受注台帳を読み込めませんでした。時間をおいて再度お試しください。"
        detail={e instanceof Error ? e.message : String(e)}
      />
    )
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ClipboardList className="h-5 w-5 text-earth-700" aria-hidden />
          <h1 className="font-display text-2xl font-bold text-ink">受注台帳</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/admin/orders/new"
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-earth-600 px-3 text-sm font-medium text-white transition-colors hover:bg-earth-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-earth-400"
          >
            <Plus className="h-4 w-4" aria-hidden />
            注文の受付
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

      {/* 絞り込みバー（GET フォーム：JS不要・URLに条件が残る）。スマホは折りたたむ */}
      <Card className="space-y-2 p-3">
        {/* 既定で今月に絞っていることを必ず明示する（黙って絞ると「データが消えた」と誤解される） */}
        {usingDefaultPeriod && (
          <p className="flex flex-wrap items-center gap-x-2 text-xs text-ink-soft">
            <span className="inline-flex items-center gap-1 rounded-full bg-trust-50 px-2 py-0.5 font-medium text-trust-700">
              <Filter className="h-3 w-3" aria-hidden />
              今月（既定）
            </span>
            <span>受注日 {formatJpDate(filter.start)} 〜 {formatJpDate(filter.end)} で絞り込んでいます。</span>
            <Link href="/admin/orders?all=1" className="inline-flex min-h-10 items-center font-medium text-trust-700 hover:underline">
              全期間を表示
            </Link>
          </p>
        )}
        <details className="group md:hidden" open={hasFilter}>
          <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 text-sm font-bold text-ink">
            <Filter className="h-4 w-4 text-ink-soft" aria-hidden />
            絞り込み{hasFilter ? '（条件あり）' : ''}
            <span className="ml-auto text-xs font-normal text-ink-soft group-open:hidden">タップで開く</span>
          </summary>
          <div className="pt-2">
            <FilterForm filter={filter} customers={customers} showAll={showAll} hasFilter={hasFilter} />
          </div>
        </details>
        <div className="hidden md:block">
          <FilterForm filter={filter} customers={customers} showAll={showAll} hasFilter={hasFilter} />
        </div>
      </Card>

      {orders.length === 0 ? (
        <EmptyState
          title={hasFilter ? '条件に一致する受注がありません' : 'まだ受注がありません'}
          description={
            hasFilter
              ? '絞り込み条件を変えてお試しください。'
              : 'FAX・メール・取引先からの発注や「注文の受付」で受注が入ると、ここに一覧表示されます。'
          }
        />
      ) : (
        <>
          {/* スマホ: カード（1枚ずつタップで詳細へ） */}
          <ul className="space-y-2 md:hidden">
            {orders.map((o) => (
              <li key={o.id}>
                <Link
                  href={`/admin/orders/${o.id}`}
                  className="block rounded-xl border border-line bg-bg-card p-3 shadow-xs transition-colors hover:bg-bg-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-trust-100"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="flex min-w-0 items-start gap-2">
                      <ColorDot color={o.customerColor} name={o.customerName} className="mt-1" />
                      <span className="min-w-0 break-words font-bold text-ink">
                        {o.customerName}
                        {o.destinationName && <span className="font-normal text-ink-soft"> ＞ {o.destinationName}</span>}
                      </span>
                    </span>
                    <span className="shrink-0 whitespace-nowrap">
                      <OrderStatusBadge status={o.status} />
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-soft">
                    <span className="num font-black text-forest-900">納品 {mdShort(o.deliveryDate)}</span>
                    <span className="num">
                      {o.totalPacks > 0 ? (
                        <>
                          <b className="text-ink">{o.totalBoxes}箱</b>（{o.totalPacks.toLocaleString()}P）
                        </>
                      ) : (
                        `${o.itemCount}品目`
                      )}
                    </span>
                    <span className="num text-ink">{yen(o.amount)}</span>
                    <span>{o.fieldProgressLabel}</span>
                    <span className="text-ink-faint">
                      {intakeLabel(o.source, o.intakeChannel)}・受付 {mdShort(o.orderDate)}
                    </span>
                    <ChevronRight className="ml-auto h-4 w-4 text-ink-faint" aria-hidden />
                  </div>
                </Link>
              </li>
            ))}
          </ul>

          {/* PC: 表（行全体をクリックで詳細へ） */}
          <Card variant="elevated" className="hidden overflow-hidden p-0 md:block">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="whitespace-nowrap border-b border-line text-left text-xs text-ink-faint">
                  <th className="px-3 py-2.5 font-bold text-ink">納品日</th>
                  <th className="px-3 py-2.5 font-bold text-ink">取引先 ＞ 納入先</th>
                  <th className="px-3 py-2.5 text-right font-bold text-ink">箱数（パック数）</th>
                  <th className="px-3 py-2.5 font-medium">現場の進み</th>
                  <th className="px-3 py-2.5 font-medium">受注元</th>
                  <th className="px-3 py-2.5 text-right font-medium">金額</th>
                  <th className="px-3 py-2.5 font-medium">状態</th>
                  <th className="w-8 px-2 py-2.5"><span className="sr-only">詳細</span></th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr
                    key={o.id}
                    className="relative border-b border-line/60 transition-colors last:border-0 hover:bg-bg-soft focus-within:bg-bg-soft"
                  >
                    <td className="num whitespace-nowrap px-3 py-3">
                      <span className="block font-black text-forest-900">{mdShort(o.deliveryDate)}</span>
                      <span className="block text-xs text-ink-faint">受付 {mdShort(o.orderDate)}</span>
                    </td>
                    <td className="px-3 py-3">
                      <span className="flex min-w-0 items-start gap-2 font-bold text-ink">
                        <ColorDot color={o.customerColor} name={o.customerName} className="mt-1" />
                        {/* 行全体をリンクにする（after で行いっぱいに広げる） */}
                        <Link
                          href={`/admin/orders/${o.id}`}
                          className="min-w-0 break-words after:absolute after:inset-0 after:content-[''] focus-visible:outline-none"
                        >
                          {o.customerName}
                          {o.destinationName && (
                            <span className="font-normal text-ink-soft"> ＞ {o.destinationName}</span>
                          )}
                        </Link>
                      </span>
                    </td>
                    <td className="num whitespace-nowrap px-3 py-3 text-right">
                      {o.totalPacks > 0 ? (
                        <>
                          <span className="font-black text-ink">{o.totalBoxes}箱</span>
                          <span className="ml-1 text-xs font-bold text-ink-soft">({o.totalPacks.toLocaleString()}P)</span>
                        </>
                      ) : (
                        <span className="text-xs text-ink-faint">{o.itemCount}品目</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-xs font-bold text-ink-soft">{o.fieldProgressLabel}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-xs text-ink-faint">{intakeLabel(o.source, o.intakeChannel)}</td>
                    <td className="num whitespace-nowrap px-3 py-3 text-right text-ink">{yen(o.amount)}</td>
                    <td className="whitespace-nowrap px-3 py-3">
                      <OrderStatusBadge status={o.status} />
                    </td>
                    <td className="px-2 py-3 text-ink-faint">
                      <ChevronRight className="h-4 w-4" aria-hidden />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  )
}

/** 絞り込みフォーム（スマホは折りたたみの中、PC はそのまま出す）。 */
function FilterForm({
  filter,
  customers,
  showAll,
  hasFilter,
}: {
  filter: OrderFilter
  customers: { id: string; name: string }[]
  showAll: boolean
  hasFilter: boolean
}) {
  return (
    <form method="get" className="flex flex-wrap items-end gap-3">
      {/* 「全期間」表示中に他の条件で絞っても今月に戻らないよう、all を引き継ぐ */}
      {showAll && <input type="hidden" name="all" value="1" />}
      <label className="min-w-0 space-y-1">
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
      <label className="min-w-0 space-y-1">
        <span className="block text-xs font-medium text-ink-soft">取引先</span>
        <select name="customerId" defaultValue={filter.customerId} className={`${inputCls} max-w-full`}>
          <option value="">すべて</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label className="min-w-0 space-y-1">
        <span className="block text-xs font-medium text-ink-soft">受注日（開始）</span>
        <input type="date" name="start" defaultValue={filter.start} className={inputCls} />
      </label>
      <label className="min-w-0 space-y-1">
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
        <Link href="/admin/orders?all=1" className="inline-flex min-h-10 items-center text-sm font-medium text-trust-700 hover:underline">
          クリア（全期間）
        </Link>
      )}
      {showAll && (
        <Link href="/admin/orders" className="inline-flex min-h-10 items-center text-sm font-medium text-trust-700 hover:underline">
          今月に戻す
        </Link>
      )}
    </form>
  )
}
