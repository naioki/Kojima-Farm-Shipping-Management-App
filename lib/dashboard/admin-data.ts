import 'server-only'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getMissingSpecs } from '@/lib/masters/missing-specs'
import { yen } from '@/lib/format'
import { formatJpDateShort } from '@/lib/dates'
import { FIELD_APPROVED_STATUSES } from '@/lib/orders/field-scope'
import { computeTodayProgress } from '@/lib/dashboard/today-progress'
import type { AdminDashboardData } from '@/components/dashboard/AdminDashboard'
import type { AlertItem } from '@/components/dashboard/AlertsPanel'
import type { OrderStatusKey, RecentOrderRow, TrendPoint } from '@/components/dashboard/types'
import { ClipboardList, CheckCircle2, Camera, LayoutGrid, FileText, Settings } from 'lucide-react'

/** 経営ダッシュボードのよく使う操作（固定）。 */
const QUICK_ACTIONS: AdminDashboardData['actions'] = [
  { href: '/admin/orders', label: '受注一覧', icon: ClipboardList, tone: 'trust' },
  { href: '/admin/inbox?filter=pending', label: '受注承認', icon: CheckCircle2, tone: 'harvest' },
  { href: '/admin/master-import', label: 'マスタ取込 (OCR)', icon: Camera, tone: 'earth' },
  { href: '/field/matrix', label: '週間マトリックス', icon: LayoutGrid, tone: 'forest' },
  { href: '/admin/invoices', label: '請求書作成', icon: FileText, tone: 'earth' },
  { href: '/admin/settings', label: '設定', icon: Settings, tone: 'trust' },
]

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']

/** JST の現在時刻（サーバが UTC でも崩れないよう +9h して UTC 系で読む）。 */
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

const ORDER_STATUS_MAP: Record<string, OrderStatusKey> = {
  pending_review: 'pending_review',
  approved: 'approved',
  shipped: 'shipped',
  invoiced: 'invoiced',
  cancelled: 'needs_check',
}

/** 出荷金額の合計（line_total を持つ items の和）。 */
function sumLineTotals(items: { line_total: number | null }[] | null): number {
  return (items ?? []).reduce((acc, it) => acc + (it.line_total ?? 0), 0)
}

/**
 * 経営ダッシュボードの実データを組み立てる。各ブロックは失敗しても空/0に
 * フォールバックし、ページ全体は決して落とさない（NEVER swallow→空状態で見せる）。
 */
export async function getAdminDashboardData(): Promise<AdminDashboardData> {
  const supabase = createClient()
  const jst = nowJst()
  const today = ymd(jst)
  const cur = monthRange(jst)
  const prev = monthRange(new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth() - 1, 1)))

  const [
    user,
    todayItemsRes,
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
    todayDeliveriesRes,
  ] = await Promise.all([
    getAuthedUser(),
    // 今日の出荷対象。現場画面と同じ絞り込み（lib/orders/field-scope.ts）を使う。
    // 以前は ['approved','shipped'] 直書きで invoiced が抜けており、当日中に
    // 請求まで進んだ注文が経営側の「今日の出荷」から消えていた。
    supabase
      .from('order_items')
      .select('field_status, quantity, shipped_qty, line_total, orders!inner(delivery_date,status,customer_id,destination_id)')
      .eq('orders.delivery_date', today)
      .in('orders.status', FIELD_APPROVED_STATUSES),
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
    supabase.from('orders').select('id', { count: 'exact', head: true }).gte('order_date', cur.start).lte('order_date', cur.end),
    supabase.from('orders').select('id', { count: 'exact', head: true }).gte('order_date', prev.start).lte('order_date', prev.end),
    supabase.from('invoices').select('total_amount').eq('billing_month', cur.ym),
    supabase.from('invoices').select('total_amount').eq('billing_month', prev.ym),
    supabase
      .from('orders')
      .select('id, order_date, status, customers(name), order_items(line_total)')
      .order('created_at', { ascending: false })
      .limit(5),
    // 配送側の記録。明細（field_status）と突き合わせて食い違いを出すために取る。
    supabase.from('deliveries').select('customer_id, destination_id, status').eq('delivery_date', today),
  ])

  // --- 名前・あいさつ・日付 ---
  const { data: profile, error: profileErr } = user
    ? await supabase.from('users').select('full_name').eq('id', user.id).maybeSingle()
    : { data: null, error: null }
  // 表示名は補助。取得失敗してもメール名にフォールバックする。無言にはしない。
  if (profileErr) console.error('[admin-data] 表示名の取得に失敗:', profileErr.message)
  const name = profile?.full_name?.trim() || user?.email?.split('@')[0] || 'ユーザー'
  const dateLabel = `${jst.getUTCFullYear()}年${jst.getUTCMonth() + 1}月${jst.getUTCDate()}日 (${WEEKDAYS[jst.getUTCDay()]})`

  // --- 本日の出荷状況 ---
  // 明細（品目行）と配送先（取引先＞納入先）の両方を1回で計算する。
  // 単位の違う2つの数字を別々の場所で別々に出していたのが、経営側の
  // 「今日どれだけ終わったか」が2つあった原因（lib/dashboard/today-progress.ts）。
  type TodayItem = {
    field_status: string | null
    quantity: number
    shipped_qty: number | null
    line_total: number | null
    orders: { customer_id: string; destination_id: string | null } | null
  }
  const todayItems = (todayItemsRes.data ?? []) as unknown as TodayItem[]
  const todayDeliveries = (todayDeliveriesRes.data ?? []) as unknown as {
    customer_id: string
    destination_id: string | null
    status: string | null
  }[]
  const progress = computeTodayProgress({
    items: todayItems.map((it) => ({
      customerId: it.orders?.customer_id ?? '',
      destinationId: it.orders?.destination_id ?? null,
      fieldStatus: it.field_status,
      lineTotal: it.line_total,
    })),
    deliveries: todayDeliveries.map((d) => ({
      customerId: d.customer_id,
      destinationId: d.destination_id,
      status: d.status,
    })),
  })
  const counts = {
    not_started: progress.items.notStarted,
    packed: progress.items.packed,
    shipped: progress.items.shipped,
  }
  const amt = progress.items.amounts
  const totalItems = progress.items.total
  const progressPct = progress.items.pct

  // 明細と配送の記録が食い違っている配送先を、取引先名に直して警告に載せる。
  // 放置すると「納品したのに売上に立たない」「出荷したのに配送証跡が無い」まま月末を迎える。
  const mismatchCount = progress.mismatches.length

  // --- 要対応アラート ---
  const pendingOrders = pendingOrdersRes.count ?? 0
  const pendingReceipts = pendingReceiptsRes.count ?? 0
  const failedReceipts = failedReceiptsRes.count ?? 0
  // 規格未登録はナビから外しここで通知（ToDo性が強いため）。集計失敗は0扱いで全体を止めない。
  const missingSpecs = await getMissingSpecs(createAdminClient()).catch(() => [])
  const missingSpecsCount = missingSpecs.length
  const alerts: AlertItem[] = []
  if (pendingOrders > 0)
    alerts.push({ id: 'po', tone: 'alert', label: `承認待ち受注が ${pendingOrders}件 あります`, count: pendingOrders, href: '/admin/inbox?filter=pending' })
  if (pendingReceipts > 0)
    alerts.push({ id: 'pr', tone: 'warning', label: `未処理の受信データが ${pendingReceipts}件 あります`, count: pendingReceipts, href: '/admin/inbox' })
  if (failedReceipts > 0)
    alerts.push({ id: 'fr', tone: 'alert', label: `解析失敗・未紐付けが ${failedReceipts}件 あります`, count: failedReceipts, href: '/admin/inbox?filter=review' })
  if (missingSpecsCount > 0)
    alerts.push({ id: 'ms', tone: 'warning', label: `規格（入り数・荷姿）が未登録の商品が ${missingSpecsCount}件 あります`, count: missingSpecsCount, href: '/admin/rules-missing' })
  // 出荷一覧と配送リストの記録が食い違っている配送先。どちらかの記録が漏れており、
  // 放置すると「納品したのに売上に立たない」まま月末（請求）に進んでしまう。
  if (mismatchCount > 0)
    alerts.push({
      id: 'mm',
      tone: 'warning',
      label: `出荷と配送の記録が合わない配送先が ${mismatchCount}件 あります`,
      count: mismatchCount,
      href: '/admin/deliveries-report',
    })
  const notificationCount = pendingOrders + pendingReceipts + failedReceipts

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

  // --- 今月のサマリー（4指標・前月比） ---
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

  // --- 最新の受注 ---
  type RecentRow = {
    id: string
    order_date: string
    status: string
    customers: { name: string } | null
    order_items: { line_total: number | null }[] | null
  }
  const recentRows = (recentOrdersRes.data ?? []) as unknown as RecentRow[]
  const recentOrders: RecentOrderRow[] = recentRows.map((o) => {
    return {
      id: o.id,
      date: formatJpDateShort(o.order_date),
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
      // 配送先（取引先＞納入先）単位。明細単位の数字と混同させないため別に持つ
      deliveries: {
        total: progress.deliveries.total,
        delivered: progress.deliveries.delivered,
        pct: progress.deliveries.pct,
      },
      mismatchCount,
    },
    trend,
    alerts,
    actions: QUICK_ACTIONS,
    recentOrders,
    summary,
  }
}
