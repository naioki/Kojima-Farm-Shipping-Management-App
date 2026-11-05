import { describe, it, expect } from 'vitest'
import { defaultDueDate, receivableState, summarizeReceivables, canTransitionInvoice } from './receivables'

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

  it('無効は戻せない・入金済は送付済へだけ戻せる', () => {
    expect(canTransitionInvoice('void', 'draft')).toBe(false)
    expect(canTransitionInvoice('paid', 'sent')).toBe(true)
    expect(canTransitionInvoice('paid', 'draft')).toBe(false)
    expect(canTransitionInvoice('sent', 'paid')).toBe(true)
  })
})
