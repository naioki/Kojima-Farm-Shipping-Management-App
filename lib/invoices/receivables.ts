import { dueDateFor, monthEndOf, type PaymentSchedule } from '@/lib/customers/payment-terms'

/**
 * 売掛金（入金待ち・期日超過）の判定。純関数・DB非依存。
 *
 * 支払期日: 請求書に due_date があればそれ。無ければ取引先の支払条件（締め日＝対象期間の末日、
 * 無ければ請求月の月末）から求める。支払条件を渡さなければ「月末締め・翌月末払い」。
 * 入金待ち = 確定・送付済（下書き・入金済・無効は対象外）。期日超過 = 入金待ちのうち期日 < 今日。
 */
export interface ReceivableInvoice {
  status: string
  billing_month: string
  due_date: string | null
  total_amount: number | string | null
  /** 対象期間の末日（締め日）。無ければ請求月の月末で判定 */
  period_end?: string | null
}

/** 請求書ごとの支払条件の引き方（取引先別）。null/undefined は既定（月末締め・翌月末払い） */
export type TermsOf<T> = (inv: T) => PaymentSchedule | null | undefined

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

export function dueDateOf(
  inv: Pick<ReceivableInvoice, 'due_date' | 'billing_month' | 'period_end'>,
  terms?: PaymentSchedule | null,
): string | null {
  if (inv.due_date) return inv.due_date
  if (!terms) {
    // 既定（月末締め・翌月末払い）。期間の末日があればその月、無ければ請求月で
    return inv.period_end ? dueDateFor(inv.period_end) : defaultDueDate(inv.billing_month)
  }
  const closing = inv.period_end ?? monthEndOf(inv.billing_month)
  return closing ? dueDateFor(closing, terms) : null
}

export function receivableState(
  inv: ReceivableInvoice,
  todayJst: string,
  terms?: PaymentSchedule | null,
): ReceivableState {
  if (inv.status !== 'finalized' && inv.status !== 'sent') return null
  const due = dueDateOf(inv, terms)
  return due && due < todayJst ? 'overdue' : 'unpaid'
}

export interface ReceivableSummary {
  unpaidCount: number
  unpaidAmount: number
  overdueCount: number
  overdueAmount: number
}

export function summarizeReceivables<T extends ReceivableInvoice>(
  invoices: T[],
  todayJst: string,
  termsOf?: TermsOf<T>,
): ReceivableSummary {
  const s: ReceivableSummary = { unpaidCount: 0, unpaidAmount: 0, overdueCount: 0, overdueAmount: 0 }
  for (const inv of invoices) {
    const st = receivableState(inv, todayJst, termsOf?.(inv))
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

export interface ReceivableSummaryWithUndetermined extends ReceivableSummary {
  /** 支払期日を判定できなかった入金待ち（請求書に due_date が無く、取引先の支払条件も読めなかった） */
  undeterminedCount: number
  undeterminedAmount: number
}

/**
 * 取引先の支払条件が読めなかったとき（termsUnavailable=true）に、既定の支払条件で期日超過を
 * 判定・集計しないための集計。due_date を持つ請求書はそれで判定し、持たない請求書は「判定できない」に数え、
 * 期日超過の合計には含めない（入金待ちの件数・金額には含める）。termsUnavailable=false なら summarizeReceivables と同じ。
 */
export function summarizeReceivablesWithUndetermined<T extends ReceivableInvoice>(
  invoices: T[],
  todayJst: string,
  termsOf: TermsOf<T> | undefined,
  termsUnavailable: boolean,
): ReceivableSummaryWithUndetermined {
  if (!termsUnavailable) {
    return { ...summarizeReceivables(invoices, todayJst, termsOf), undeterminedCount: 0, undeterminedAmount: 0 }
  }
  const s: ReceivableSummaryWithUndetermined = {
    unpaidCount: 0, unpaidAmount: 0, overdueCount: 0, overdueAmount: 0, undeterminedCount: 0, undeterminedAmount: 0,
  }
  for (const inv of invoices) {
    const st = receivableState(inv, todayJst, termsOf?.(inv))
    if (!st) continue
    const amt = Number(inv.total_amount) || 0
    s.unpaidCount++
    s.unpaidAmount += amt
    if (!inv.due_date) {
      s.undeterminedCount++
      s.undeterminedAmount += amt
    } else if (st === 'overdue') {
      s.overdueCount++
      s.overdueAmount += amt
    }
  }
  return s
}

/**
 * 請求書ステータスの許される遷移。確定後は下書きに戻さない（発行済みの帳票の内容を変えない: tax.md）。
 * 無効は戻せない。入金済だけは押し間違いの取消として送付済へ戻せる。
 */
const ALLOWED: Record<string, string[]> = {
  draft: ['finalized', 'void'],
  finalized: ['sent', 'paid', 'void'],
  sent: ['paid', 'void'],
  paid: ['sent'],
  void: [],
}
export function canTransitionInvoice(from: string, to: string): boolean {
  return (ALLOWED[from] ?? []).includes(to)
}
