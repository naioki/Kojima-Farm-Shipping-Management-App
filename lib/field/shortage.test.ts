import { describe, it, expect } from 'vitest'
import { calcShortage } from './shortage'

describe('calcShortage — 見込み − 必要数', () => {
  it('未入力は「0」ではなく not_entered（誤認防止）', () => {
    const r = calcShortage(100, { status: 'not_entered' })
    expect(r.kind).toBe('not_entered')
    expect(r.available).toBeNull()
    expect(r.net).toBeNull()
  })

  it('不足（見込み80 − 必要100 = -20）', () => {
    const r = calcShortage(100, { status: 'estimated', estimate_qty: 80 })
    expect(r.kind).toBe('shortage')
    expect(r.net?.toNumber()).toBe(-20)
  })

  it('余剰（実120 − 必要100、繰越込み）', () => {
    const r = calcShortage(100, { status: 'confirmed', actual_qty: 110, carry_over: 10 })
    expect(r.kind).toBe('surplus')
    expect(r.available?.toNumber()).toBe(120)
    expect(r.net?.toNumber()).toBe(20)
  })

  it('actual > estimate > planned の優先で確定値を採用', () => {
    const r = calcShortage(50, {
      status: 'confirmed',
      planned_qty: 30,
      estimate_qty: 40,
      actual_qty: 55,
    })
    expect(r.available?.toNumber()).toBe(55)
    expect(r.kind).toBe('surplus')
  })

  it('ちょうどは even', () => {
    const r = calcShortage(50, { status: 'estimated', estimate_qty: 50 })
    expect(r.kind).toBe('even')
    expect(r.net?.toNumber()).toBe(0)
  })

  it('ステータス入力済みでも数値が無ければ安全側で not_entered', () => {
    const r = calcShortage(50, { status: 'planned' })
    expect(r.kind).toBe('not_entered')
  })
})
