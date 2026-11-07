/**
 * 評価指標の集計（純関数・DB非依存）。週単位（日本時間・月曜はじまり）。
 *
 * オーナーが定めた4指標:
 *   1. 1注文あたり処理時間（受信→承認、承認→出荷）
 *   2. 出荷・請求ミスの件数（数量訂正・納品書訂正・請求書無効化・配送の問題記録）
 *   3. 事務作業時間（操作ログの「実際に操作していた時間」から自動推定）
 *   4. 紙の卒業（受注経路の内訳と、紙でやっていた業務のアプリ完結件数）
 */
import { jstDateStr, shiftDateStr } from '@/lib/dates'

export type ChannelKey = 'fax' | 'email' | 'portal' | 'phone' | 'line' | 'paper' | 'other' | 'unknown'
export const CHANNEL_KEYS: ChannelKey[] = ['fax', 'email', 'portal', 'phone', 'line', 'paper', 'other', 'unknown']

export interface MetricsInput {
  weeks: string[]
  orders: {
    id: string
    source: string
    intake_channel: string | null
    created_at: string
    approved_at: string | null
  }[]
  receipts: { order_id: string | null; received_at: string }[]
  items: { order_id: string; shipped_at: string | null }[]
  audits: { entity_type: string; action: string; changed_fields: string[] | null; new_values: unknown; created_at: string }[]
  deliveryIssues: { created_at: string }[]
  opsEvents: { path: string; active_ms: number | null; created_at: string }[]
  /** 操作の記録（AI相談窓口の評価・実行・取り消し） */
  actionEvents?: { name: string | null; meta: unknown; created_at: string }[]
  deliveryNotes: { issued_at: string }[]
  invoices: { created_at: string; status: string }[]
}

export interface WeekMetrics {
  week: string
  /** 受信→承認の中央値（分）。自動取り込み（FAX・メール・ポータル）のみ */
  intakeToApproveMin: number | null
  intakeToApproveN: number
  /** 承認→全明細出荷の中央値（分） */
  approveToShipMin: number | null
  approveToShipN: number
  qtyCorrections: number
  noteRevisions: number
  invoiceVoids: number
  deliveryIssues: number
  /** 管理画面（/admin）を実際に操作していた時間（分） */
  officeMin: number
  /** 現場画面（/field）を実際に操作していた時間（分） */
  fieldMin: number
  orders: number
  channels: Record<ChannelKey, number>
  /** 紙でやっていた業務のアプリ完結件数 */
  faxApprovedInApp: number
  phoneLineEntered: number
  appDeliveryNotes: number
  appInvoices: number
  /** AI相談窓口: 👍・👎・提案の実行・取り消しの件数 */
  conciergeUp: number
  conciergeDown: number
  conciergeExecuted: number
  conciergeUndone: number
}

/** ISO日時（または YYYY-MM-DD）→ その週の月曜（日本時間）YYYY-MM-DD */
export function weekStartJst(isoOrDate: string): string {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(isoOrDate) ? isoOrDate : jstDateStr(new Date(isoOrDate))
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay() // 0=日
  const back = dow === 0 ? 6 : dow - 1
  return shiftDateStr(date, -back)
}

/**
 * 週（月曜はじまり）のうち今日までに経過した日数と、途中かどうか。
 * 今週の数字は「月曜〜今日」の途中集計なので、先週（まる1週）と比べるときに注記するために使う。
 */
export function weekProgress(weekStart: string, todayJst: string): { elapsedDays: number; inProgress: boolean; lastDay: string } {
  const weekEnd = shiftDateStr(weekStart, 6)
  if (todayJst < weekStart) return { elapsedDays: 0, inProgress: true, lastDay: weekStart }
  if (todayJst >= weekEnd) return { elapsedDays: 7, inProgress: false, lastDay: weekEnd }
  const [y, m, d] = weekStart.split('-').map(Number) as [number, number, number]
  const [ty, tm, td] = todayJst.split('-').map(Number) as [number, number, number]
  const elapsedDays = Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(y, m - 1, d)) / 86_400_000) + 1
  return { elapsedDays, inProgress: true, lastDay: todayJst }
}

/** 今日を含む直近 n 週の月曜（古い順） */
export function recentWeeks(todayJst: string, n: number): string[] {
  const thisWeek = weekStartJst(todayJst)
  return Array.from({ length: n }, (_, i) => shiftDateStr(thisWeek, -7 * (n - 1 - i)))
}

export function median(nums: number[]): number | null {
  if (nums.length === 0) return null
  const s = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2
}

const minutesBetween = (a: string, b: string) => (new Date(b).getTime() - new Date(a).getTime()) / 60_000

export function channelOf(o: { source: string; intake_channel: string | null }): ChannelKey {
  const c = o.intake_channel ?? (o.source === 'manual' ? null : o.source)
  return (CHANNEL_KEYS as string[]).includes(c ?? '') ? (c as ChannelKey) : 'unknown'
}

export function computeWeeklyMetrics(input: MetricsInput): WeekMetrics[] {
  const blank = (week: string): WeekMetrics => ({
    week,
    intakeToApproveMin: null,
    intakeToApproveN: 0,
    approveToShipMin: null,
    approveToShipN: 0,
    qtyCorrections: 0,
    noteRevisions: 0,
    invoiceVoids: 0,
    deliveryIssues: 0,
    officeMin: 0,
    fieldMin: 0,
    orders: 0,
    channels: Object.fromEntries(CHANNEL_KEYS.map((k) => [k, 0])) as Record<ChannelKey, number>,
    faxApprovedInApp: 0,
    phoneLineEntered: 0,
    appDeliveryNotes: 0,
    appInvoices: 0,
    conciergeUp: 0,
    conciergeDown: 0,
    conciergeExecuted: 0,
    conciergeUndone: 0,
  })
  const byWeek = new Map(input.weeks.map((w) => [w, blank(w)]))
  const at = (iso: string) => byWeek.get(weekStartJst(iso))

  // 受信時刻（注文ごとに最も早い受信）
  const firstReceived = new Map<string, string>()
  for (const r of input.receipts) {
    if (!r.order_id) continue
    const cur = firstReceived.get(r.order_id)
    if (!cur || r.received_at < cur) firstReceived.set(r.order_id, r.received_at)
  }
  // 出荷完了時刻（全明細に shipped_at がある注文のみ。最後の出荷時刻）
  const shipState = new Map<string, { all: boolean; last: string | null }>()
  for (const it of input.items) {
    const s = shipState.get(it.order_id) ?? { all: true, last: null }
    if (!it.shipped_at) s.all = false
    else if (!s.last || it.shipped_at > s.last) s.last = it.shipped_at
    shipState.set(it.order_id, s)
  }

  const intakeDurations = new Map<string, number[]>()
  const shipDurations = new Map<string, number[]>()
  for (const o of input.orders) {
    const created = at(o.created_at)
    const ch = channelOf(o)
    if (created) {
      created.orders++
      created.channels[ch]++
      if (ch === 'phone' || ch === 'line') created.phoneLineEntered++
    }
    if (!o.approved_at) continue
    const wk = weekStartJst(o.approved_at)
    const w = byWeek.get(wk)
    if (!w) continue
    if (o.source === 'fax') w.faxApprovedInApp++
    if (o.source !== 'manual') {
      const start = firstReceived.get(o.id) ?? o.created_at
      const min = minutesBetween(start, o.approved_at)
      if (min >= 0) intakeDurations.set(wk, [...(intakeDurations.get(wk) ?? []), min])
    }
    const ship = shipState.get(o.id)
    if (ship?.all && ship.last) {
      const min = minutesBetween(o.approved_at, ship.last)
      if (min >= 0) shipDurations.set(wk, [...(shipDurations.get(wk) ?? []), min])
    }
  }
  for (const [wk, arr] of intakeDurations) {
    const w = byWeek.get(wk)!
    w.intakeToApproveMin = median(arr)
    w.intakeToApproveN = arr.length
  }
  for (const [wk, arr] of shipDurations) {
    const w = byWeek.get(wk)!
    w.approveToShipMin = median(arr)
    w.approveToShipN = arr.length
  }

  for (const a of input.audits) {
    const w = at(a.created_at)
    if (!w || a.action !== 'UPDATE') continue
    if (a.entity_type === 'order_items' && (a.changed_fields ?? []).includes('quantity')) w.qtyCorrections++
    else if (a.entity_type === 'delivery_notes') w.noteRevisions++
    else if (
      a.entity_type === 'invoices' &&
      a.new_values &&
      typeof a.new_values === 'object' &&
      (a.new_values as Record<string, unknown>).status === 'void'
    )
      w.invoiceVoids++
  }
  for (const e of input.deliveryIssues) {
    const w = at(e.created_at)
    if (w) w.deliveryIssues++
  }
  for (const e of input.opsEvents) {
    const w = at(e.created_at)
    if (!w) continue
    const min = (e.active_ms ?? 0) / 60_000
    if (e.path.startsWith('/admin')) w.officeMin += min
    else if (e.path.startsWith('/field')) w.fieldMin += min
  }
  for (const e of input.actionEvents ?? []) {
    const w = at(e.created_at)
    if (!w) continue
    if (e.name === 'concierge_execute') w.conciergeExecuted++
    else if (e.name === 'concierge_undo') w.conciergeUndone++
    else if (e.name === 'concierge_feedback') {
      const rating = e.meta && typeof e.meta === 'object' ? (e.meta as Record<string, unknown>).rating : null
      if (rating === 'up') w.conciergeUp++
      else if (rating === 'down') w.conciergeDown++
    }
  }
  for (const n of input.deliveryNotes) {
    const w = at(n.issued_at)
    if (w) w.appDeliveryNotes++
  }
  for (const inv of input.invoices) {
    const w = at(inv.created_at)
    if (w && inv.status !== 'void') w.appInvoices++
  }

  return input.weeks.map((wk) => {
    const w = byWeek.get(wk)!
    return { ...w, officeMin: Math.round(w.officeMin), fieldMin: Math.round(w.fieldMin) }
  })
}
