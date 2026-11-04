import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { jstTodayStr } from '@/lib/dates'
import { computeWeeklyMetrics, recentWeeks, type MetricsInput, type WeekMetrics } from '@/lib/metrics/compute'

const PAGE = 1000 // PostgREST の既定上限。超える分は黙って切られるため必ずページングする

type PageResult<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>

async function fetchAll<T>(label: string, run: (from: number, to: number) => PageResult<T>): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await run(from, from + PAGE - 1)
    if (error) throw new Error(`${label}の取得に失敗しました: ${error.message}`)
    out.push(...(data ?? []))
    if (!data || data.length < PAGE) return out
  }
}

async function fetchByIds<T>(label: string, ids: string[], run: (chunk: string[]) => PageResult<T>): Promise<T[]> {
  const out: T[] = []
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await run(ids.slice(i, i + 200))
    if (error) throw new Error(`${label}の取得に失敗しました: ${error.message}`)
    out.push(...(data ?? []))
  }
  return out
}

/** 直近 weeksCount 週の評価指標を集計する。取得エラーは握りつぶさず throw（画面で ErrorState）。 */
export async function loadWeeklyMetrics(weeksCount = 8): Promise<WeekMetrics[]> {
  const admin = createAdminClient()
  const weeks = recentWeeks(jstTodayStr(), weeksCount)
  const since = `${weeks[0]}T00:00:00+09:00`

  const orders = await fetchAll('注文', (f, t) =>
    admin
      .from('orders')
      .select('id, source, intake_channel, created_at, approved_at')
      .neq('status', 'cancelled')
      .or(`created_at.gte.${since},approved_at.gte.${since}`)
      .order('created_at')
      .range(f, t),
  )
  const orderIds = orders.map((o) => o.id)

  const [receipts, items, audits, deliveryIssues, opsEvents, deliveryNotes, invoices, actionEvents] = await Promise.all([
    fetchByIds('受信ログ', orderIds, (chunk) =>
      admin.from('order_receipts').select('order_id, received_at').in('order_id', chunk),
    ),
    fetchByIds('注文明細', orderIds, (chunk) => admin.from('order_items').select('order_id, shipped_at').in('order_id', chunk)),
    fetchAll('変更履歴', (f, t) =>
      admin
        .from('audit_log')
        .select('entity_type, action, changed_fields, new_values, created_at')
        .in('entity_type', ['order_items', 'delivery_notes', 'invoices'])
        .eq('action', 'UPDATE')
        .gte('created_at', since)
        .order('created_at')
        .range(f, t),
    ),
    fetchAll('配送の問題記録', (f, t) =>
      admin.from('delivery_events').select('created_at').eq('action', 'issue').gte('created_at', since).order('created_at').range(f, t),
    ),
    fetchAll('操作ログ', (f, t) =>
      admin
        .from('ops_events')
        .select('path, active_ms, created_at')
        .eq('event', 'page_active')
        .gte('created_at', since)
        .order('created_at')
        .range(f, t),
    ),
    fetchAll('納品書', (f, t) =>
      admin.from('delivery_notes').select('issued_at').gte('issued_at', since).order('issued_at').range(f, t),
    ),
    fetchAll('請求書', (f, t) =>
      admin.from('invoices').select('created_at, status').gte('created_at', since).order('created_at').range(f, t),
    ),
    fetchAll('操作の記録', (f, t) =>
      admin
        .from('ops_events')
        .select('name, meta, created_at')
        .eq('event', 'action')
        .like('name', 'concierge_%')
        .gte('created_at', since)
        .order('created_at')
        .range(f, t),
    ),
  ])

  const input: MetricsInput = {
    weeks,
    orders,
    receipts: receipts as MetricsInput['receipts'],
    items: items as MetricsInput['items'],
    audits: audits as MetricsInput['audits'],
    deliveryIssues,
    opsEvents,
    deliveryNotes,
    invoices,
    actionEvents: actionEvents as MetricsInput['actionEvents'],
  }
  return computeWeeklyMetrics(input)
}
