import { describe, it, expect } from 'vitest'
import { jstDateStr, shiftDateStr } from './dates'

describe('jstDateStr', () => {
  it('UTC深夜でも日本時間の日付を返す（Cloud Run/UTCで「昨日」にならない）', () => {
    // 2026-07-02T21:00:00Z = 日本時間 2026-07-03 06:00
    expect(jstDateStr(new Date('2026-07-02T21:00:00Z'))).toBe('2026-07-03')
    // 2026-07-03T14:59:00Z = 日本時間 2026-07-03 23:59
    expect(jstDateStr(new Date('2026-07-03T14:59:00Z'))).toBe('2026-07-03')
    // 2026-07-03T15:00:00Z = 日本時間 2026-07-04 00:00
    expect(jstDateStr(new Date('2026-07-03T15:00:00Z'))).toBe('2026-07-04')
  })
})

describe('shiftDateStr', () => {
  it('月またぎ・年またぎを正しくずらす', () => {
    expect(shiftDateStr('2026-07-31', 1)).toBe('2026-08-01')
    expect(shiftDateStr('2026-01-01', -1)).toBe('2025-12-31')
    expect(shiftDateStr('2026-07-03', 7)).toBe('2026-07-10')
    expect(shiftDateStr('2026-07-03', 0)).toBe('2026-07-03')
  })
  it('うるう年を正しく扱う', () => {
    expect(shiftDateStr('2028-02-28', 1)).toBe('2028-02-29')
    expect(shiftDateStr('2026-02-28', 1)).toBe('2026-03-01')
  })
})
