import 'server-only'
import { getAuthedUser } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getMissingSpecs } from '@/lib/masters/missing-specs'
import { yen } from '@/lib/format'
import { formatJpDateShort, shiftDateStr } from '@/lib/dates'
import type { AdminDashboardData } from '@/components/dashboard/AdminDashboard'
import type { AlertItem } from '@/components/dashboard/AlertsPanel'
import type { OrderStatusKey, RecentOrderRow, TomorrowPackStats, TrendPoint } from '@/components/dashboard/types'
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

function monthRange(d: Date): { start: string; end: string; ym: string } {
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth()
  const start = new Date(Date.UTC(y, m, 1))
  const end = new Date(Date.UTC(y, m + 1, 0))
  return { start: ymd(start), end: ymd(end), ym: `${y}-${String(m + 1).padStart(2, '0')}` }
}

function pct(curr: number, prev: number): number | null {
  if (prev <= 0) return null
  return ((curr - prev) / prev) * 100
}

// #46 cancelled は needs_check ではなく cancelled として正確にマッピング
const ORDER_STATUS_MAP: Record<string, OrderStatusKey> = {
  pending_review: 'pending_review',
  approved: 'approved',
  shipped: 'shipped',
  invoiced: 'invoiced',
  cancelled: 'cancelled',
}

function sumLineTotals(items: { line_total: number | null }[] | null): number {
  return (items ?? []).reduce((acc, it) => acc + (it.line_total ?? 0), 0)
}

function resolveDashboardPpc(spec?: string | null): number {
  const s = (spec ?? '').normalize('NFKC')
  const m = s.match(/(?:入数|1箱|1ケース)\s*[:：]?\s*(\d+)|(\d+)\s*入(?:り)?/i)
  if (m) {
    const n = Number(m[1] || m[2])
    if (Number.isFinite(n) && n >= 10 && n <= 200) return n
  }
  if (s.includes('小コン')) return 30
  if (s.includes('24')) return 24
  return 20
}

export async function getAdminDashboardData(): Promise<AdminDashboardData> {
  const supabase = createAdminClient()
  const jst = nowJst()
  const today = ymd(jst)
  const tomorrow = shiftDateStr(today, 1)
  const cur = monthRange(jst)
  const prev = monthRange(new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth() - 1, 1)))

  const [
    user,
    todayItemsRes,
    tomorrowItemsRes,
    pendingOrdersRes,
    pendingReceiptsRes,
    failedReceiptsRes,
    curShipRes,
    prevShipRes,
    curOrdersRes,
    prevOrdersRes,
    curInvoiceRes,
    prevInvoiceRes,
    recentOrdersRes,
  ] = await Promise.all([
    getAuthedUser(),
    supabase
      .from('order_items')
      .select('field_status, quantity, shipped_qty, line_total, orders!inner(delivery_date,status)')
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
    supabase.from('order_receipts').select('id', { count: 'exact', head: true }).eq('status', 'pending_review'),
    supabase.from('order_receipts').select('id', { count: 'exact', head: true }).in('status', ['ai_failed', 'unmatched']),
    supabase
      .from('order_items')
      .select('line_total, orders!inner(delivery_date,status)')
      .gte('orders.delivery_date', cur.start)
      .lte('orders.delivery_date', cur.end)
      .in('orders.status', ['shipped', 'invoiced']),
    supabase
      .from('order_items')
      .select('line_total, orders!inner(delivery_date,status)')
      .gte('orders.delivery_date', prev.start)
      .lte('orders.delivery_date', prev.end)
      .in('orders.status', ['shipped', 'invoiced']),
    supabase.from('orders').select('id', { count: 'exact', head: true }).gte('order_date', cur.start).lte('order_date', cur.end).neq('status', 'cancelled'),
    supabase.from('orders').select('id', { count: 'exact', head: true }).gte('order_date', prev.start).lte('order_date', prev.end).neq('status', 'cancelled'),
    supabase.from('invoices').select('total_amount').eq('billing_month', cur.ym),
    supabase.from('invoices').select('total_amount').eq('billing_month', prev.ym),
    supabase
      .from('orders')
      .select('id, order_date, delivery_date, status, customers(name), order_items(line_total)')
      .order('created_at', { ascending: false })
      .limit(5),
  ])

  const profileRes = user
    ? await supabase.from('users').select('full_name').eq('id', user.id).maybeSingle()
    : null
  if (profileRes?.error) console.error('[admin-data] 表示名の取得に失敗:', profileRes.error.message)
  const name = '小島農園'
  const dateLabel = `${jst.getUTCFullYear()}年${jst.getUTCMonth() + 1}月${jst.getUTCDate()}日 (${WEEKDAYS[jst.getUTCDay()]})`

  // --- 本日の納品・出荷状況 ---
  type TodayItem = { field_status: string | null; quantity: number; shipped_qty: number | null; line_total: number | null }
  const todayItems = (todayItemsRes.data ?? []) as unknown as TodayItem[]
  const counts = { not_started: 0, packed: 0, shipped: 0 }
  const amt = { notStarted: 0, packed: 0, shipped: 0 }
  for (const it of todayItems) {
    const lt = it.line_total ?? 0
    if (it.field_status === 'shipped') {
      counts.shipped++
      amt.shipped += lt
    } else if (it.field_status === 'packed') {
      counts.packed++
      amt.packed += lt
    } else {
      counts.not_started++
      amt.notStarted += lt
    }
  }
  const totalItems = todayItems.length
  const progressPct = totalItems > 0 ? Math.round(((counts.packed + counts.shipped) / totalItems) * 100) : 0

  // --- #44 本日パック作業（明日納品分）の進捗集計 ---
  type TomorrowItem = { field_status: string | null; quantity: number; shipped_qty: number | null; spec: string | null }
  const tomorrowItems = (tomorrowItemsRes.data ?? []) as unknown as TomorrowItem[]
  let tTotalBoxes = 0
  let tCompletedBoxes = 0
  let tTotalPacks = 0
  let tCompletedPacks = 0
  let tCompletedItems = 0
  for (const it of tomorrowItems) {
    const q = Number(it.quantity) || 0
    const ppc = resolveDashboardPpc(it.spec)
    const boxes = Math.ceil(q / ppc)
    tTotalPacks += q
    tTotalBoxes += boxes
    if (it.field_status === 'packed' || it.field_status === 'shipped') {
      tCompletedItems++
      tCompletedPacks += q
      tCompletedBoxes += boxes
    } else if (it.shipped_qty && it.shipped_qty > 0) {
      const partial = Math.min(q, Number(it.shipped_qty))
      tCompletedPacks += partial
      tCompletedBoxes += Math.floor(partial / ppc)
    }
  }
  const tomorrowPackStats: TomorrowPackStats = {
    deliveryDate: tomorrow,
    deliveryDateLabel: formatJpDateShort(tomorrow),
    totalItems: tomorrowItems.length,
    completedItems: tCompletedItems,
    totalBoxes: tTotalBoxes,
    completedBoxes: tCompletedBoxes,
    totalPacks: tTotalPacks,
    completedPacks: tCompletedPacks,
    progressPct: tTotalPacks > 0 ? Math.min(100, Math.round((tCompletedPacks / tTotalPacks) * 100)) : 0,
  }

  // --- 要対応アラート ---
  const pendingOrders = pendingOrdersRes.count ?? 0
  const pendingReceipts = pendingReceiptsRes.count ?? 0
  const failedReceipts = failedReceiptsRes.count ?? 0
  const missingSpecs = await getMissingSpecs(createAdminClient()).catch(() => [])
  const missingSpecsCount = missingSpecs.length
  const alerts: AlertItem[] = []
  if (pendingOrders > 0)
    alerts.push({ id: 'po', tone: 'alert', label: `承認待ち受注が ${pendingOrders}件 あります`, count: pendingOrders, href: '/admin/approvals' })
  // 受信データの pending_review は「承認待ち受注」と同じFAXを数え直すだけなので出さない（二重表示の防止）
  void pendingReceipts
  if (failedReceipts > 0)
    alerts.push({ id: 'fr', tone: 'alert', label: `読み取り失敗・取引先不明の受信が ${failedReceipts}件 あります`, count: failedReceipts, href: '/admin/inbox' })
  if (missingSpecsCount > 0)
    alerts.push({ id: 'ms', tone: 'info', label: `規格（入り数・荷姿）が未登録の商品が ${missingSpecsCount}件 あります`, count: missingSpecsCount, href: '/admin/rules-missing' })
  const notificationCount = pendingOrders + failedReceipts

  // --- 今月の出荷推移（日次） ---
  type ShipItem = { line_total: number | null; orders: { delivery_date: string | null } }
  const curShip = (curShipRes.data ?? []) as unknown as ShipItem[]
  const byDay = new Map<string, number>()
  for (const it of curShip) {
    const d = it.orders?.delivery_date
    if (!d) continue
    byDay.set(d, (byDay.get(d) ?? 0) + (it.line_total ?? 0))
  }
  const trend: TrendPoint[] = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([d, v]) => {
      const dt = new Date(`${d}T00:00:00Z`)
      return { label: `${dt.getUTCMonth() + 1}/${dt.getUTCDate()}`, value: v }
    })

  // --- 今月のサマリー ---
  const shippedCur = sumLineTotals(curShipRes.data as { line_total: number | null }[] | null)
  const shippedPrev = sumLineTotals(prevShipRes.data as { line_total: number | null }[] | null)
  const ordersCur = curOrdersRes.count ?? 0
  const ordersPrev = prevOrdersRes.count ?? 0
  const invoicedCur = (curInvoiceRes.data ?? []).reduce((a, r) => a + (r.total_amount ?? 0), 0)
  const invoicedPrev = (prevInvoiceRes.data ?? []).reduce((a, r) => a + (r.total_amount ?? 0), 0)
  const unbilledCur = Math.max(0, shippedCur - invoicedCur)
  const unbilledPrev = Math.max(0, shippedPrev - invoicedPrev)

  const summary = [
    { key: 'orders', label: '受注件数', value: `${ordersCur} 件`, deltaPct: pct(ordersCur, ordersPrev), spark: [ordersPrev, ordersCur] },
    { key: 'shipped', label: '出荷金額', value: yen(shippedCur), deltaPct: pct(shippedCur, shippedPrev), spark: [shippedPrev, shippedCur] },
    { key: 'invoiced', label: '請求金額', value: yen(invoicedCur), deltaPct: pct(invoicedCur, invoicedPrev), spark: [invoicedPrev, invoicedCur] },
    { key: 'unbilled', label: '未請求額', value: yen(unbilledCur), deltaPct: pct(unbilledCur, unbilledPrev), spark: [unbilledPrev, unbilledCur], invertDelta: true },
  ]

  type RecentRow = {
    id: string
    order_date: string
    delivery_date: string | null
    status: string
    customers: { name: string } | null
    order_items: { line_total: number | null }[] | null
  }
  const recentRows = (recentOrdersRes.data ?? []) as unknown as RecentRow[]
  const recentOrders: RecentOrderRow[] = recentRows.map((o) => {
    return {
      id: o.id,
      date: formatJpDateShort(o.delivery_date ?? o.order_date),
      customer: o.customers?.name ?? '（未紐付け）',
      itemCount: o.order_items?.length ?? 0,
      amount: sumLineTotals(o.order_items),
      status: ORDER_STATUS_MAP[o.status] ?? 'needs_check',
      href: `/admin/orders/${o.id}`,
    }
  })

  return {
    header: {
      name,
      greeting: greetingFor(jst.getUTCHours()),
      dateLabel,
      notificationCount,
    },
    stats: {
      notStarted: counts.not_started,
      packed: counts.packed,
      shipped: counts.shipped,
      progressPct,
      totalItems,
      amounts: { notStarted: amt.notStarted, packed: amt.packed, shipped: amt.shipped },
    },
    tomorrowPackStats,
    trend,
    alerts,
    actions: QUICK_ACTIONS,
    recentOrders,
    summary,
  }
}
