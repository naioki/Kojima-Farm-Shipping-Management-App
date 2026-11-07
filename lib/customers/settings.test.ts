import { describe, it, expect } from 'vitest'
import { skipsDestinationGate, paymentScheduleOf, hasPaymentSchedule } from './settings'

describe('skipsDestinationGate', () => {
  it('true のときだけ飛ばす', () => {
    expect(skipsDestinationGate({ skip_destination_gate: true })).toBe(true)
    expect(skipsDestinationGate({ skip_destination_gate: false })).toBe(false)
    expect(skipsDestinationGate({ skip_destination_gate: 'true' })).toBe(false)
    expect(skipsDestinationGate({})).toBe(false)
    expect(skipsDestinationGate(null)).toBe(false)
  })
})

describe('paymentScheduleOf', () => {
  it('未設定は月末締め・翌月末払い、保存値は読み出す（他のキーと共存）', () => {
    expect(paymentScheduleOf(null)).toEqual({ closing: 'eom', pay_month_offset: 1, pay_day: 'eom' })
    expect(paymentScheduleOf({ skip_destination_gate: true })).toEqual({ closing: 'eom', pay_month_offset: 1, pay_day: 'eom' })
    expect(
      paymentScheduleOf({ skip_destination_gate: true, payment_schedule: { closing: 20, pay_month_offset: 1, pay_day: 10 } }),
    ).toEqual({ closing: 20, pay_month_offset: 1, pay_day: 10 })
    expect(hasPaymentSchedule({ payment_schedule: { closing: 20 } })).toBe(true)
    expect(hasPaymentSchedule({})).toBe(false)
  })
})
