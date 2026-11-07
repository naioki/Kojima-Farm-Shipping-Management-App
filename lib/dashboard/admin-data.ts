import 'server-only'
import { getAuthedUser } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getMissingSpecs } from '@/lib/masters/missing-specs'
import { dueDateOf, receivableState, summarizeReceivables } from '@/lib/invoices/receivables'
import { paymentScheduleOf } from '@/lib/customers/settings'
import { fetchBilledOrderItemIds } from '@/lib/invoices/generate'
import { yen } from '@/lib/format'
import { formatJpDateShort, jstDateStr, shiftDateStr } from '@/lib/dates'
import {
  computePackProgress,
  computeTodayShipment,
  computeUnbilled,
  dailyTrend,
  monthToDateRanges,
  pctChange,
  sumAmounts,
  sumInRange,
  sumIssuedInvoices,
  ISSUED_INVOICE_STATUSES,
  type InvoiceLite,
  type PackItem,
} from '@/lib/dashboard/compute'
import type { AdminDashboardData } from '@/components/dashboard/AdminDashboard'
import type { AlertItem } from '@/components/dashboard/AlertsPanel'
import type { OrderStatusKey, OverdueInvoiceRow, RecentOrderRow, SummaryRow, TomorrowPackStats } from '@/components/dashboard/types'
import { ClipboardList, CheckCircle2, PackageCheck, Gauge, FileText, Settings, PlusCircle } from 'lucide-react'

const QUICK_ACTIONS: AdminDashboardData['actions'] = [
  { href: '/admin/orders/new', label: '注文の受付', icon: PlusCircle, tone: 'forest' },
  { href: '/admin/approvals', label: '承認待ち', icon: CheckCircle2, tone: 'harvest' },
  { href: '/field/shipments', label: '収穫・パックボード', icon: PackageCheck, tone: 'forest' },
  { href: '/admin/orders', label: '受注台帳', icon: ClipboardList, tone: 'trust' },
  { href: '/admin/metrics', label: '評価指標', icon: Gauge, tone: 'earth' },
  { href: '/admin/invoices', label: '請求書', icon: FileText, tone: 'earth' },
  { href: '/admin/settings', label: '設定', icon: Settings, tone: 'trust' },
]

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']

function nowJst(): Date {
  return new Date(Date.now() + 9 * 60 * 60 * 1000)
}
const ymd = (d: Date) => d.toISOString().slice(0, 10)

function greetingFor(hour: number): string {
  if (hour >= 5 && hour < 11) return 'おはようございます'
  if (hour >= 11 && hour < 18) return 'こんにちは'
  return 'こんばんは'
}

/** M/D 表記（年・曜日なし）。期間ラベル用。 */
const md = (s: string) => `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}`

// #46 cancelled は needs_check ではなく cancelled として正確にマッピング
const ORDER_STATUS_MAP: Record<string, OrderStatusKey> = {
  pending_review: 'pending_review',
  approved: 'approved',
  shipped: 'shipped',
  invoiced: 'invoiced',
  cancelled: 'cancelled',
}

type QueryRes = PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>

/** 1000件の上限で数字が欠けないよう、range で全件読む（集計値が黙って小さくならないように）。 */
async function fetchAllRows<T>(label: string, build: (from: number, to: number) => QueryRes): Promise<T[]> {
  const PAGE = 1000
  const out: T[] = []
  for (let page = 0; page < 50; page++) {
    const from = page * PAGE
    const { data, error } = await build(from, from + PAGE - 1)
    if (error) throw new Error(`${label}の取得に失敗しました: ${error.message}`)
    const rows = (data ?? []) as T[]
    out.push(...rows)
    if (rows.length < PAGE) break
  }
  return out
}

export async function getAdminDashboardData(): Promise<AdminDashboardData> {
  const supabase = createAdminClient()
  const jst = nowJst()
  const today = ymd(jst)
  const tomorrow = shiftDateStr(today, 1)
  // 今月1日〜今日 と 前月の同じ日数（前月同期）を比べる。月の途中で「先月まる1か月」と比べると毎月大幅減に見えるため。
  const { cur, prev } = monthToDateRanges(today)

  type ShipRow = { line_total: number | string | null; orders: { delivery_date: string | null } | null }
  type UnbilledRow = { id: string; line_total: number | string | null }
  type InvoiceRow = { status: string; issue_date: string | null; created_at: string | null; total_amount: number | string | null }

  const [
    user,
    todayItemsRes,
    tomorrowItemsRes,
    pendingOrdersRes,
    failedReceiptsRes,
    shipRows,
    curOrdersRes,
    prevOrdersRes,
    invoiceRes,
    unbilledRows,
    recentOrdersRes,
  ] = await Promise.all([
    getAuthedUser(),
    supabase
      .from('order_items')
      .select('field_status, quantity, shipped_qty, spec, line_total, orders!inner(delivery_date,status)')
      .eq('orders.delivery_date', today)
      .in('orders.status', ['approved', 'shipped', 'invoiced'])
      .gt('quantity', 0),
    // #44 本日パック作業対象（明日納品分）の進捗集計
    supabase
      .from('order_items')
      .select('field_status, quantity, shipped_qty, spec, orders!inner(delivery_date,status)')
      .eq('orders.delivery_date', tomorrow)
      .in('orders.status', ['approved', 'shipped', 'invoiced'])
      .gt('quantity', 0),
    supabase.from('orders').select('id', { count: 'exact', head: true }).eq('status', 'pending_review'),
    supabase.from('order_receipts').select('id', { count: 'exact', head: true }).in('status', ['ai_failed', 'unmatched']),
    // 出荷金額（税込）: 前月1日〜今日の出荷済み明細を一度に読み、今月分・前月同期分に分ける
    fetchAllRows<ShipRow>('出荷金額', (from, to) =>
      supabase
        .from('order_items')
        .select('line_total, orders!inner(delivery_date,status)')
        .gte('orders.delivery_date', prev.start)
        .lte('orders.delivery_date', cur.end)
        .in('orders.status', ['shipped', 'invoiced'])
        .order('id')
        .range(from, to),
    ),
    supabase.from('orders').select('id', { count: 'exact', head: true }).gte('order_date', cur.start).lte('order_date', cur.end).neq('status', 'cancelled'),
    supabase.from('orders').select('id', { count: 'exact', head: true }).gte('order_date', prev.start).lte('order_date', prev.end).neq('status', 'cancelled'),
    // 請求金額: 確定・送付済・入金済のみ（下書き・無効は数えない）。発行日（無ければ作成日）で期間に入れる
    supabase
      .from('invoices')
      .select('status, issue_date, created_at, total_amount')
      .in('status', [...ISSUED_INVOICE_STATUSES])
      .or(`issue_date.gte.${prev.start},created_at.gte.${shiftDateStr(prev.start, -1)}`),
    // 未請求額: 請求書の作成対象（承認済み・出荷済みで納品日が今日まで）の明細。請求済みは後で除く
    fetchAllRows<UnbilledRow>('未請求の明細', (from, to) =>
      supabase
        .from('order_items')
        .select('id, line_total, orders!inner(delivery_date,status)')
        .in('orders.status', ['approved', 'shipped'])
        .lte('orders.delivery_date', today)
        .gt('line_total', 0)
        .order('id')
        .range(from, to),
    ),
    supabase
      .from('orders')
      .select('id, order_date, delivery_date, status, customers(name), delivery_destinations(code, full_name), order_items(line_total)')
      .order('created_at', { ascending: false })
      .limit(5),
  ])

  for (const [label, res] of [
    ['本日納品分の明細', todayItemsRes],
    ['明日納品分の明細', tomorrowItemsRes],
    ['請求書', invoiceRes],
    ['最新の受注', recentOrdersRes],
  ] as const) {
    if (res.error) throw new Error(`${label}の取得に失敗しました: ${res.error.message}`)
  }

  const profileRes = user
    ? await supabase.from('users').select('full_name').eq('id', user.id).maybeSingle()
    : null
  if (profileRes?.error) console.error('[admin-data] 表示名の取得に失敗:', profileRes.error.message)
  const name = '小島農園'
  const dateLabel = `${jst.getUTCFullYear()}年${jst.getUTCMonth() + 1}月${jst.getUTCDate()}日 (${WEEKDAYS[jst.getUTCDay()]})`

  // --- 本日の納品・出荷状況（箱数基準） ---
  const today_ = computeTodayShipment((todayItemsRes.data ?? []) as unknown as PackItem[])

  // --- #44 本日パック作業（明日納品分）の進捗集計（箱数基準） ---
  const tomorrowPackStats: TomorrowPackStats = {
    deliveryDate: tomorrow,
    deliveryDateLabel: formatJpDateShort(tomorrow),
    ...computePackProgress((tomorrowItemsRes.data ?? []) as unknown as PackItem[]),
  }

  // --- 要対応アラート ---
  const pendingOrders = pendingOrdersRes.count ?? 0
  const failedReceipts = failedReceiptsRes.count ?? 0
  const missingSpecs = await getMissingSpecs(createAdminClient()).catch((e: unknown) => {
    console.error('[dashboard] 規格未登録の品目の取得に失敗:', e instanceof Error ? e.message : e)
    return []
  })
  const missingSpecsCount = missingSpecs.length
  // 入金待ちの請求書（確定・送付済）。期日超過があれば要対応に出す
  const arRes = await supabase
    .from('invoices')
    .select('id, status, billing_month, period_end, due_date, total_amount, customers(name, channel_identifiers)')
    .in('status', ['finalized', 'sent'])
  if (arRes.error) console.error('[dashboard] 入金待ち請求書の取得に失敗:', arRes.error.message)
  type ArRow = {
    id: string
    status: string
    billing_month: string
    period_end: string | null
    due_date: string | null
    total_amount: number | string | null
    customers: { name: string; channel_identifiers: unknown } | null
  }
  const arRows = (arRes.data ?? []) as unknown as ArRow[]
  // 期日は請求書の支払期日、無ければ取引先の支払条件から（請求一覧・かんたん画面と同じ判定）
  const termsOf = (r: ArRow) => paymentScheduleOf(r.customers?.channel_identifiers)
  const ar = summarizeReceivables(arRows, today, termsOf)
  const overdueInvoices: OverdueInvoiceRow[] = arRows
    .filter((r) => receivableState(r, today, termsOf(r)) === 'overdue')
    .map((r) => ({ id: r.id, customer: r.customers?.name ?? '（取引先不明）', amount: Number(r.total_amount) || 0, dueDate: dueDateOf(r, termsOf(r)) ?? '' }))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .map((r) => ({ ...r, dueLabel: formatJpDateShort(r.dueDate) }))

  const alerts: AlertItem[] = []
  if (pendingOrders > 0)
    alerts.push({ id: 'po', tone: 'alert', label: `承認待ち受注が ${pendingOrders}件 あります`, count: pendingOrders, href: '/admin/approvals' })
  // 受信データの pending_review は「承認待ち受注」と同じFAXを数え直すだけなので数えない（二重表示の防止）
  if (failedReceipts > 0)
    alerts.push({ id: 'fr', tone: 'alert', label: `読み取り失敗・取引先不明の受信が ${failedReceipts}件 あります`, count: failedReceipts, href: '/admin/inbox' })
  if (ar.overdueCount > 0)
    alerts.push({ id: 'ar', tone: 'alert', label: `支払期日を過ぎた未入金の請求書が ${ar.overdueCount}件（${yen(ar.overdueAmount)}）あります`, count: ar.overdueCount, href: '/admin/invoices' })
  if (missingSpecsCount > 0)
    alerts.push({ id: 'ms', tone: 'info', label: `規格（入り数・荷姿）が未登録の品目が ${missingSpecsCount}件 あります`, count: missingSpecsCount, href: '/admin/rules-missing' })
  const notificationCount = pendingOrders + failedReceipts

  // --- 今月の出荷推移（日次・1日〜今日の全日を0埋め） ---
  const shipDated = shipRows.map((r) => ({ date: r.orders?.delivery_date ?? null, amount: r.line_total }))
  const trend = dailyTrend(shipDated, cur).map(({ label, value }) => ({ label, value }))

  // --- 今月のサマリー（前月同期比） ---
  const shippedCur = sumInRange(shipDated, cur)
  const shippedPrev = sumInRange(shipDated, prev)
  const ordersCur = curOrdersRes.count ?? 0
  const ordersPrev = prevOrdersRes.count ?? 0
  const invoices: InvoiceLite[] = ((invoiceRes.data ?? []) as InvoiceRow[]).map((r) => ({
    status: r.status,
    issue_date: r.issue_date,
    created_date: r.created_at ? jstDateStr(new Date(r.created_at)) : null,
    total_amount: r.total_amount,
  }))
  const invoicedCur = sumIssuedInvoices(invoices, cur)
  const invoicedPrev = sumIssuedInvoices(invoices, prev)

  const billed = await fetchBilledOrderItemIds(supabase, unbilledRows.map((r) => r.id))
  if (!billed.ok) throw new Error(billed.message)
  const unbilled = computeUnbilled(unbilledRows, billed.ids)

  const summary: SummaryRow[] = [
    { key: 'orders', label: '受注件数', value: `${ordersCur} 件`, deltaPct: pctChange(ordersCur, ordersPrev), spark: [ordersPrev, ordersCur], note: `前月同期 ${ordersPrev}件` },
    { key: 'shipped', label: '出荷金額（税込）', value: yen(shippedCur), deltaPct: pctChange(shippedCur, shippedPrev), spark: [shippedPrev, shippedCur], note: `前月同期 ${yen(shippedPrev)}` },
    { key: 'invoiced', label: '請求金額（税込・発行済み）', value: yen(invoicedCur), deltaPct: pctChange(invoicedCur, invoicedPrev), spark: [invoicedPrev, invoicedCur], note: `前月同期 ${yen(invoicedPrev)}` },
    {
      key: 'unbilled',
      label: '未請求額（税込）',
      value: yen(unbilled.amount),
      deltaPct: null,
      spark: [],
      invertDelta: true,
      note: unbilled.count > 0 ? `請求書に載っていない明細 ${unbilled.count}件（先月以前の分も含む）` : '請求書に載っていない明細はありません',
    },
  ]

  type RecentRow = {
    id: string
    order_date: string
    delivery_date: string | null
    status: string
    customers: { name: string } | null
    delivery_destinations: { code: string | null; full_name: string } | null
    order_items: { line_total: number | string | null }[] | null
  }
  const recentRows = (recentOrdersRes.data ?? []) as unknown as RecentRow[]
  const recentOrders: RecentOrderRow[] = recentRows.map((o) => ({
    id: o.id,
    date: o.delivery_date ? formatJpDateShort(o.delivery_date) : '未定',
    customer: o.customers?.name ?? '（未紐付け）',
    destination: o.delivery_destinations ? o.delivery_destinations.code || o.delivery_destinations.full_name : null,
    itemCount: o.order_items?.length ?? 0,
    amount: sumAmounts(o.order_items),
    status: ORDER_STATUS_MAP[o.status] ?? 'needs_check',
    href: `/admin/orders/${o.id}`,
  }))

  return {
    header: {
      name,
      greeting: greetingFor(jst.getUTCHours()),
      dateLabel,
      notificationCount,
    },
    stats: {
      notStarted: today_.notStarted,
      packed: today_.packed,
      shipped: today_.shipped,
      progressPct: today_.progressPct,
      totalItems: today_.totalItems,
      totalBoxes: today_.totalBoxes,
      doneBoxes: today_.doneBoxes,
      itemCounts: today_.itemCounts,
      amounts: today_.amounts,
    },
    tomorrowPackStats,
    trend,
    alerts,
    overdueInvoices,
    actions: QUICK_ACTIONS,
    recentOrders,
    summary,
    summaryPeriod: {
      current: `${md(cur.start)}〜${md(cur.end)}`,
      previous: `${md(prev.start)}〜${md(prev.end)}`,
    },
  }
}
