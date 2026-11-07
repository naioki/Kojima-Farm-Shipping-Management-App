import { describe, it, expect } from 'vitest'
import {
  DEFAULT_PAYMENT_SCHEDULE,
  dueDateFor,
  monthEndOf,
  parsePaymentSchedule,
  paymentScheduleLabel,
} from './payment-terms'

describe('parsePaymentSchedule', () => {
  it('未設定・不正値は「月末締め・翌月末払い」', () => {
    expect(parsePaymentSchedule(undefined)).toEqual(DEFAULT_PAYMENT_SCHEDULE)
    expect(parsePaymentSchedule(null)).toEqual(DEFAULT_PAYMENT_SCHEDULE)
    expect(parsePaymentSchedule('20日締め')).toEqual(DEFAULT_PAYMENT_SCHEDULE)
    expect(parsePaymentSchedule([1, 2])).toEqual(DEFAULT_PAYMENT_SCHEDULE)
  })

  it('項目ごとに不正値だけ既定に戻す（29日以上・小数・範囲外の月）', () => {
    expect(parsePaymentSchedule({ closing: 31, pay_month_offset: 3, pay_day: 10.5 })).toEqual(DEFAULT_PAYMENT_SCHEDULE)
    expect(parsePaymentSchedule({ closing: 20, pay_month_offset: 5, pay_day: 10 })).toEqual({
      closing: 20,
      pay_month_offset: 1,
      pay_day: 10,
    })
  })

  it('画面から来る文字列の数字も受け付ける', () => {
    expect(parsePaymentSchedule({ closing: '20', pay_month_offset: '2', pay_day: 'eom' })).toEqual({
      closing: 20,
      pay_month_offset: 2,
      pay_day: 'eom',
    })
  })
})

describe('paymentScheduleLabel', () => {
  it('請求書に印字する文', () => {
    expect(paymentScheduleLabel(DEFAULT_PAYMENT_SCHEDULE)).toBe('月末締め・翌月末払い')
    expect(paymentScheduleLabel({ closing: 20, pay_month_offset: 1, pay_day: 10 })).toBe('20日締め・翌月10日払い')
    expect(paymentScheduleLabel({ closing: 'eom', pay_month_offset: 0, pay_day: 'eom' })).toBe('月末締め・当月末払い')
    expect(paymentScheduleLabel({ closing: 15, pay_month_offset: 2, pay_day: 5 })).toBe('15日締め・翌々月5日払い')
  })
})

describe('dueDateFor', () => {
  it('既定（月末締め・翌月末払い）は締め月の翌月末', () => {
    expect(dueDateFor('2026-10-31')).toBe('2026-11-30')
    expect(dueDateFor('2026-10-31', DEFAULT_PAYMENT_SCHEDULE)).toBe('2026-11-30')
  })

  it('20日締め・翌月10日払い', () => {
    const t = { closing: 20, pay_month_offset: 1 as const, pay_day: 10 }
    expect(dueDateFor('2026-11-20', t)).toBe('2026-12-10')
    expect(dueDateFor('2026-10-20', t)).toBe('2026-11-10')
  })

  it('年またぎ', () => {
    expect(dueDateFor('2026-12-31')).toBe('2027-01-31')
    expect(dueDateFor('2026-12-20', { closing: 20, pay_month_offset: 1, pay_day: 10 })).toBe('2027-01-10')
    expect(dueDateFor('2026-11-30', { closing: 'eom', pay_month_offset: 2, pay_day: 'eom' })).toBe('2027-01-31')
    expect(dueDateFor('2026-12-25', { closing: 25, pay_month_offset: 2, pay_day: 5 })).toBe('2027-02-05')
  })

  it('うるう年の2月末', () => {
    expect(dueDateFor('2028-01-31')).toBe('2028-02-29')
    expect(dueDateFor('2027-01-31')).toBe('2027-02-28')
    expect(dueDateFor('2027-12-31', { closing: 'eom', pay_month_offset: 2, pay_day: 'eom' })).toBe('2028-02-29')
  })

  it('当月払い', () => {
    expect(dueDateFor('2026-11-15', { closing: 15, pay_month_offset: 0, pay_day: 'eom' })).toBe('2026-11-30')
  })

  it('不正な日付は null', () => {
    expect(dueDateFor('bad')).toBeNull()
  })
})

describe('monthEndOf', () => {
  it('月末日', () => {
    expect(monthEndOf('2026-11')).toBe('2026-11-30')
    expect(monthEndOf('2028-02')).toBe('2028-02-29')
    expect(monthEndOf('x')).toBeNull()
  })
})
