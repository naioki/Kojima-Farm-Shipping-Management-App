import 'server-only'
import { SchemaType, type FunctionDeclaration } from '@google/generative-ai'
import type { SupabaseClient } from '@supabase/supabase-js'
import { shiftDateStr } from '@/lib/dates'
import { findBestMatchingCustomer } from '@/lib/orders/natural-parser'
import { loadWeeklyMetrics } from '@/lib/metrics/load'

/**
 * AI相談窓口が「自分でデータを取りに行く」ための読み取り専用ツール（Function Calling）。
 * 世界の業務AI（Shopify Sidekick・Intercom Fin 等）と同じく、数字は必ずツールで実データを引いてから答え、
 * 推測で数字を作らせない（グラウンディング）。書き込みは一切しない（書き込みは人が「実行」を押す提案だけ）。
 * 売上・評価指標は管理者だけ（ロールで出し分け。ツール自体もサーバー側で拒否する）。
 */

export type ConciergeRole = 'admin' | 'staff'

const STATUS_JA: Record<string, string> = {
  pending_review: '承認待ち',
  approved: '承認済み',
  shipped: '出荷済み',
  invoiced: '請求済み',
}
const FIELD_JA: Record<string, string> = { not_started: '未着手', packed: 'パック済', shipped: '出荷済' }
const MAX_RANGE_DAYS = 62
const dateRe = /^\d{4}-\d{2}-\d{2}$/

export function conciergeToolDeclarations(role: ConciergeRole): FunctionDeclaration[] {
  const decls: FunctionDeclaration[] = [
    {
      name: 'get_orders',
      description:
        '期間（納品日）と取引先で注文を検索する。「先週のヨークは？」「明日の和郷園の注文」「今週の青梗菜は何箱？」などに使う。キャンセルは除く。',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          date_from: { type: SchemaType.STRING, description: '納品日の開始 YYYY-MM-DD' },
          date_to: { type: SchemaType.STRING, description: '納品日の終了 YYYY-MM-DD（開始から最大62日）' },
          customer_name: { type: SchemaType.STRING, description: '取引先名（あいまいでよい。省略で全取引先）' },
        },
        required: ['date_from', 'date_to'],
      },
    },
    {
      name: 'get_today_work',
      description:
        '指定した納品日の作業状況（未着手・パック済・出荷済の件数）と、承認待ち・読み取り失敗の件数を返す。「今日の残りは？」「何が終わってない？」に使う。',
      parameters: {
        type: SchemaType.OBJECT,
        properties: { delivery_date: { type: SchemaType.STRING, description: '納品日 YYYY-MM-DD' } },
        required: ['delivery_date'],
      },
    },
  ]
  if (role === 'admin') {
    decls.push(
      {
        name: 'get_sales_summary',
        description: '指定月（納品日ベース）の取引先別の売上（税込）と、単価が未確定の明細数を返す。管理者専用。',
        parameters: {
          type: SchemaType.OBJECT,
          properties: { month: { type: SchemaType.STRING, description: '対象月 YYYY-MM' } },
          required: ['month'],
        },
      },
      {
        name: 'get_metrics',
        // 引数なし（空の properties は Gemini に拒否されることがあるため parameters 自体を省く）
        description: '評価指標（処理時間・ミス件数・事務作業時間・紙の卒業）の今週と先週の値を返す。管理者専用。',
      },
    )
  }
  return decls
}

export interface ToolContext {
  admin: SupabaseClient
  role: ConciergeRole
  customers: { id: string; name: string; aliases?: string[] }[]
  destinations: { id: string; customer_id: string; code: string | null; full_name: string }[]
  customerPpc: Map<string, number>
}

type ToolResult = Record<string, unknown>

export async function runConciergeTool(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  try {
    switch (name) {
      case 'get_orders':
        return await getOrders(args, ctx)
      case 'get_today_work':
        return await getTodayWork(String(args.delivery_date ?? ''), ctx)
      case 'get_sales_summary':
        if (ctx.role !== 'admin') return { error: 'このデータは管理者だけが見られます' }
        return await getSalesSummary(String(args.month ?? ''), ctx)
      case 'get_metrics':
        if (ctx.role !== 'admin') return { error: 'このデータは管理者だけが見られます' }
        return await getMetrics()
      default:
        return { error: `不明なツール: ${name}` }
    }
  } catch (e) {
    // 失敗はAIに正直に伝え、推測で答えさせない
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

function labelOf(ctx: ToolContext, customerId: string | null, destinationId: string | null): string {
  const c = ctx.customers.find((x) => x.id === customerId)?.name ?? '取引先不明'
  const d = destinationId ? ctx.destinations.find((x) => x.id === destinationId) : null
  const dName = d ? d.code || d.full_name : null
  return dName && dName !== c ? `${c} ＞ ${dName}` : c
}

async function getOrders(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const from = String(args.date_from ?? '')
  let to = String(args.date_to ?? '')
  if (!dateRe.test(from) || !dateRe.test(to)) return { error: '日付は YYYY-MM-DD で指定してください' }
  if (to < from) return { error: '終了日が開始日より前です' }
  const maxTo = shiftDateStr(from, MAX_RANGE_DAYS)
  if (to > maxTo) to = maxTo

  let customerId: string | null = null
  if (typeof args.customer_name === 'string' && args.customer_name.trim()) {
    const m = findBestMatchingCustomer(args.customer_name, ctx.customers)
    if (!m) return { error: `取引先「${args.customer_name}」が見つかりません`, known_customers: ctx.customers.map((c) => c.name) }
    customerId = m.id
  }

  let q = ctx.admin
    .from('orders')
    .select('id, delivery_date, status, customer_id, destination_id, order_items(product_name, quantity, field_status)')
    .gte('delivery_date', from)
    .lte('delivery_date', to)
    .neq('status', 'cancelled')
    .order('delivery_date')
    .limit(300)
  if (customerId) q = q.eq('customer_id', customerId)
  const { data, error } = await q
  if (error) throw new Error(`注文の取得に失敗しました: ${error.message}`)

  const orders = (data ?? []).map((o) => {
    const ppc = ctx.customerPpc.get(o.customer_id as string) ?? 20
    const items = ((o.order_items ?? []) as { product_name: string; quantity: number; field_status: string }[])
      .filter((it) => Number(it.quantity) > 0)
      .map((it) => ({
        品目: it.product_name,
        パック数: Number(it.quantity),
        箱数の目安: Math.ceil(Number(it.quantity) / ppc),
        作業: FIELD_JA[it.field_status] ?? it.field_status,
      }))
    return {
      納品日: o.delivery_date,
      出荷先: labelOf(ctx, o.customer_id as string, o.destination_id as string | null),
      状態: STATUS_JA[o.status as string] ?? o.status,
      明細: items,
    }
  })
  return {
    期間: `${from}〜${to}`,
    ...(to !== String(args.date_to) ? { 注意: `期間が長いため ${to} までに絞りました` } : {}),
    注文数: orders.length,
    ...(orders.length >= 300 ? { 注意2: '300件で打ち切りました。期間か取引先を絞ってください' } : {}),
    注文: orders,
  }
}

export async function getTodayWork(deliveryDate: string, ctx: Pick<ToolContext, 'admin'>): Promise<ToolResult> {
  if (!dateRe.test(deliveryDate)) return { error: '日付は YYYY-MM-DD で指定してください' }
  const [itemsRes, pendingRes, failedRes] = await Promise.all([
    ctx.admin
      .from('order_items')
      .select('quantity, field_status, orders!inner(delivery_date, status)')
      .eq('orders.delivery_date', deliveryDate)
      .in('orders.status', ['approved', 'shipped', 'invoiced'])
      .gt('quantity', 0),
    ctx.admin.from('orders').select('id', { count: 'exact', head: true }).eq('status', 'pending_review'),
    ctx.admin.from('order_receipts').select('id', { count: 'exact', head: true }).in('status', ['ai_failed', 'unmatched']),
  ])
  if (itemsRes.error) throw new Error(`作業状況の取得に失敗しました: ${itemsRes.error.message}`)
  if (pendingRes.error) throw new Error(`承認待ちの取得に失敗しました: ${pendingRes.error.message}`)
  if (failedRes.error) throw new Error(`受信状況の取得に失敗しました: ${failedRes.error.message}`)

  const counts = { not_started: 0, packed: 0, shipped: 0 }
  let packsLeft = 0
  for (const it of (itemsRes.data ?? []) as { quantity: number; field_status: string }[]) {
    const k = (it.field_status in counts ? it.field_status : 'not_started') as keyof typeof counts
    counts[k]++
    if (k !== 'shipped') packsLeft += Number(it.quantity) || 0
  }
  return {
    納品日: deliveryDate,
    明細数: counts.not_started + counts.packed + counts.shipped,
    未着手: counts.not_started,
    パック済: counts.packed,
    出荷済: counts.shipped,
    未出荷のパック数: packsLeft,
    承認待ちの注文: pendingRes.count ?? 0,
    読み取り失敗_取引先不明の受信: failedRes.count ?? 0,
  }
}

async function getSalesSummary(month: string, ctx: ToolContext): Promise<ToolResult> {
  if (!/^\d{4}-\d{2}$/.test(month)) return { error: '月は YYYY-MM で指定してください' }
  const start = `${month}-01`
  const [y, m] = month.split('-').map(Number) as [number, number]
  const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
  const { data, error } = await ctx.admin
    .from('order_items')
    .select('line_total, price_status, orders!inner(customer_id, delivery_date, status)')
    .gte('orders.delivery_date', start)
    .lte('orders.delivery_date', end)
    .in('orders.status', ['approved', 'shipped', 'invoiced'])
    .limit(5000)
  if (error) throw new Error(`売上の取得に失敗しました: ${error.message}`)

  const byCustomer = new Map<string, number>()
  let unpriced = 0
  for (const r of (data ?? []) as unknown as {
    line_total: number | null
    price_status: string
    orders: { customer_id: string } | { customer_id: string }[]
  }[]) {
    const ord = Array.isArray(r.orders) ? r.orders[0] : r.orders
    const name = ctx.customers.find((c) => c.id === ord?.customer_id)?.name ?? '取引先不明'
    byCustomer.set(name, (byCustomer.get(name) ?? 0) + Number(r.line_total ?? 0))
    if (r.price_status !== 'confirmed') unpriced++
  }
  const rows = [...byCustomer.entries()].sort((a, b) => b[1] - a[1]).map(([取引先, 金額]) => ({ 取引先, 税込金額: Math.round(金額) }))
  return {
    対象月: month,
    合計_税込: rows.reduce((s, r) => s + r.税込金額, 0),
    取引先別: rows,
    単価未確定の明細数: unpriced,
    注意: unpriced > 0 ? '単価が未確定の明細があるため、金額は暫定です（単価の確定は /admin/pricing）' : undefined,
  }
}

async function getMetrics(): Promise<ToolResult> {
  const weeks = await loadWeeklyMetrics(2)
  const pick = (w: (typeof weeks)[number] | undefined) =>
    w && {
      週: w.week,
      受信から承認_中央値_分: w.intakeToApproveMin,
      承認から出荷_中央値_分: w.approveToShipMin,
      ミス件数: w.qtyCorrections + w.noteRevisions + w.invoiceVoids + w.deliveryIssues,
      管理画面の操作_分: w.officeMin,
      注文数: w.orders,
      電話LINE紙の注文: w.channels.phone + w.channels.line + w.channels.paper,
    }
  return { 今週: pick(weeks[1]), 先週: pick(weeks[0]), 詳細: '/admin/metrics' }
}
