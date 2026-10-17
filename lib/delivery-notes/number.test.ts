import { describe, it, expect } from 'vitest'
import { deliveryNoteMonthKey, formatDeliveryNoteNumber } from './number'

describe('deliveryNoteMonthKey', () => {
  it('YYYY-MM-DD から YYYYMM を作る', () => {
    expect(deliveryNoteMonthKey('2026-06-14')).toBe('202606')
    expect(deliveryNoteMonthKey('2025-12-01')).toBe('202512')
  })
})

describe('formatDeliveryNoteNumber', () => {
  it('D + 月 + 4桁ゼロ詰め連番', () => {
    expect(formatDeliveryNoteNumber('202606', 1)).toBe('D202606-0001')
    expect(formatDeliveryNoteNumber('202606', 42)).toBe('D202606-0042')
    expect(formatDeliveryNoteNumber('202512', 1234)).toBe('D202512-1234')
  })

  it('5桁以上はそのまま（桁あふれ時もIDは一意）', () => {
    expect(formatDeliveryNoteNumber('202606', 12345)).toBe('D202606-12345')
  })
})
