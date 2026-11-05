/**
 * 売掛金（入金待ち・期日超過）の判定。純関数・DB非依存。
 *
 * 支払期日: 請求書に due_date があればそれ。無ければ「請求月の翌月末」（農産物卸の一般的な締め払い）。
 * 入金待ち = 確定・送付済（下書き・入金済・無効は対象外）。期日超過 = 入金待ちのうち期日 < 今日。
 */
export interface ReceivableInvoice {
  status: string
  billing_month: string
  due_date: string | null
  total_amount: number | string | null
}

export type ReceivableState = 'unpaid' | 'overdue' | null

/** 'YYYY-MM' → 翌月末 'YYYY-MM-DD' */
export function defaultDueDate(billingMonth: string): string | null {
  const m = /^(\d{4})-(\d{2})$/.exec(billingMonth)
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  // Date.UTC(y, mo+1, 0) = 翌月(mo+1)の末日（mo は1始まりなので mo が翌月の0始まりindex）
  const d = new Date(Date.UTC(y, mo + 1, 0))
  return d.toISOString().slice(0, 10)
}

export function dueDateOf(inv: Pick<ReceivableInvoice, 'due_date' | 'billing_month'>): string | null {
  return inv.due_date ?? defaultDueDate(inv.billing_month)
}

export function receivableState(inv: ReceivableInvoice, todayJst: string): ReceivableState {
  if (inv.status !== 'finalized' && inv.status !== 'sent') return null
  const due = dueDateOf(inv)
  return due && due < todayJst ? 'overdue' : 'unpaid'
}

export interface ReceivableSummary {
  unpaidCount: number
  unpaidAmount: number
  overdueCount: number
  overdueAmount: number
}

export function summarizeReceivables(invoices: ReceivableInvoice[], todayJst: string): ReceivableSummary {
  const s: ReceivableSummary = { unpaidCount: 0, unpaidAmount: 0, overdueCount: 0, overdueAmount: 0 }
  for (const inv of invoices) {
    const st = receivableState(inv, todayJst)
    if (!st) continue
    const amt = Number(inv.total_amount) || 0
    s.unpaidCount++
    s.unpaidAmount += amt
    if (st === 'overdue') {
      s.overdueCount++
      s.overdueAmount += amt
    }
  }
  return s
}

/** 請求書ステータスの許される遷移（無効は戻せない。入金済は取消で送付済へ戻せる）。 */
const ALLOWED: Record<string, string[]> = {
  draft: ['finalized', 'void'],
  finalized: ['sent', 'paid', 'void', 'draft'],
  sent: ['paid', 'void', 'finalized'],
  paid: ['sent'],
  void: [],
}
export function canTransitionInvoice(from: string, to: string): boolean {
  return (ALLOWED[from] ?? []).includes(to)
}
