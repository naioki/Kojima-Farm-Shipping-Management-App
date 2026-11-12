import { describe, it, expect } from 'vitest'
import {
  defaultDueDate,
  dueDateOf,
  receivableState,
  summarizeReceivables,
  summarizeReceivablesWithUndetermined,
  canTransitionInvoice,
} from './receivables'

describe('売掛金の判定', () => {
  it('支払期日の既定は請求月の翌月末（年またぎ・うるう年）', () => {
    expect(defaultDueDate('2026-10')).toBe('2026-11-30')
    expect(defaultDueDate('2026-12')).toBe('2027-01-31')
    expect(defaultDueDate('2028-01')).toBe('2028-02-29')
    expect(defaultDueDate('bad')).toBeNull()
  })

  it('確定・送付済だけが入金待ち。期日を過ぎたら期日超過（期日当日はまだ超過でない）', () => {
    const base = { billing_month: '2026-09', due_date: null, total_amount: 1000 }
    expect(receivableState({ ...base, status: 'draft' }, '2026-12-01')).toBeNull()
    expect(receivableState({ ...base, status: 'paid' }, '2026-12-01')).toBeNull()
    expect(receivableState({ ...base, status: 'void' }, '2026-12-01')).toBeNull()
    expect(receivableState({ ...base, status: 'sent' }, '2026-10-31')).toBe('unpaid')
    expect(receivableState({ ...base, status: 'sent' }, '2026-11-01')).toBe('overdue')
    expect(receivableState({ ...base, status: 'finalized', due_date: '2026-12-15' }, '2026-12-15')).toBe('unpaid')
  })

  it('合計を数える', () => {
    const s = summarizeReceivables(
      [
        { status: 'sent', billing_month: '2026-09', due_date: null, total_amount: '1000' },
        { status: 'finalized', billing_month: '2026-11', due_date: null, total_amount: 500 },
        { status: 'paid', billing_month: '2026-09', due_date: null, total_amount: 9999 },
      ],
      '2026-11-05',
    )
    expect(s).toEqual({ unpaidCount: 2, unpaidAmount: 1500, overdueCount: 1, overdueAmount: 1000 })
  })

  it('取引先の支払条件で期日を決める（請求書の due_date が最優先）', () => {
    const t20 = { closing: 20, pay_month_offset: 1 as const, pay_day: 10 }
    // 20日締め・翌月10日払い: 締め日（期間の末日）11/20 → 12/10
    expect(dueDateOf({ billing_month: '2026-11', due_date: null, period_end: '2026-11-20' }, t20)).toBe('2026-12-10')
    // 期間の末日が無ければ請求月の月末で判定
    expect(dueDateOf({ billing_month: '2026-11', due_date: null }, t20)).toBe('2026-12-10')
    // due_date があればそれ
    expect(dueDateOf({ billing_month: '2026-11', due_date: '2027-01-05', period_end: '2026-11-20' }, t20)).toBe('2027-01-05')
    // 支払条件なし（既定）は従来どおり翌月末
    expect(dueDateOf({ billing_month: '2026-11', due_date: null })).toBe('2026-12-31')
    expect(dueDateOf({ billing_month: '2026-11', due_date: null, period_end: '2026-11-30' }, null)).toBe('2026-12-31')

    const inv = { status: 'sent', billing_month: '2026-11', due_date: null, total_amount: 1000, period_end: '2026-11-20' }
    expect(receivableState(inv, '2026-12-11', t20)).toBe('overdue')
    expect(receivableState(inv, '2026-12-11')).toBe('unpaid') // 既定なら 12/31 まで超過でない
  })

  it('合計は取引先ごとの支払条件で数える', () => {
    const invs = [
      { customer_id: 'a', status: 'sent', billing_month: '2026-10', due_date: null, total_amount: 300, period_end: '2026-10-20' },
      { customer_id: 'b', status: 'sent', billing_month: '2026-10', due_date: null, total_amount: 700, period_end: '2026-10-31' },
    ]
    const terms = { a: { closing: 20, pay_month_offset: 1 as const, pay_day: 10 } } as Record<string, { closing: number; pay_month_offset: 1; pay_day: number }>
    // 11/15: a は 11/10 期日で超過、b は既定（11/30）でまだ
    const s = summarizeReceivables(invs, '2026-11-15', (inv) => terms[inv.customer_id])
    expect(s).toEqual({ unpaidCount: 2, unpaidAmount: 1000, overdueCount: 1, overdueAmount: 300 })
    // 引数なしなら従来どおり（両方 11/30）
    expect(summarizeReceivables(invs, '2026-11-15').overdueCount).toBe(0)
  })

  it('無効は戻せない・入金済は送付済へだけ戻せる', () => {
    expect(canTransitionInvoice('void', 'draft')).toBe(false)
    expect(canTransitionInvoice('paid', 'sent')).toBe(true)
    expect(canTransitionInvoice('paid', 'draft')).toBe(false)
    expect(canTransitionInvoice('sent', 'paid')).toBe(true)
    // 確定後は下書きに戻せない
    expect(canTransitionInvoice('finalized', 'draft')).toBe(false)
    expect(canTransitionInvoice('sent', 'finalized')).toBe(false)
  })
})

describe('取引先の支払条件が読めないときの売掛金集計', () => {
  const invs = [
    // due_date あり・期日超過 → 判定できる
    { status: 'sent', billing_month: '2026-08', due_date: '2026-09-30', total_amount: 1000 },
    // due_date あり・期日前
    { status: 'finalized', billing_month: '2026-10', due_date: '2026-12-31', total_amount: 2000 },
    // due_date なし → 既定条件なら期日超過だが、条件が読めないので「判定できない」
    { status: 'sent', billing_month: '2026-07', due_date: null, total_amount: 4000 },
    // 入金済は対象外
    { status: 'paid', billing_month: '2026-07', due_date: null, total_amount: 8000 },
  ]
  it('due_date を持たない請求書は期日超過に含めず、判定できない件数に数える', () => {
    const s = summarizeReceivablesWithUndetermined(invs, '2026-11-12', () => undefined, true)
    expect(s).toEqual({
      unpaidCount: 3, unpaidAmount: 7000, overdueCount: 1, overdueAmount: 1000, undeterminedCount: 1, undeterminedAmount: 4000,
    })
  })
  it('読めているときは summarizeReceivables と同じ（判定できない 0）', () => {
    const s = summarizeReceivablesWithUndetermined(invs, '2026-11-12', () => undefined, false)
    expect(s).toEqual({ ...summarizeReceivables(invs, '2026-11-12', () => undefined), undeterminedCount: 0, undeterminedAmount: 0 })
    expect(s.overdueCount).toBe(2)
  })
})
