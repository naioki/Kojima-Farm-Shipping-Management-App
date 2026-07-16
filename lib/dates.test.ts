import { describe, it, expect } from 'vitest'
import { jstDateStr, shiftDateStr, formatJpDate, formatJpDateShort, formatJpMonth, formatJpDateTime } from './dates'

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

describe('formatJpDate', () => {
  it('日本の一般的な年月日順で整形する', () => {
    expect(formatJpDate('2026-07-05')).toBe('2026年7月5日')
    expect(formatJpDate('2026-01-31')).toBe('2026年1月31日')
  })
  it('null/undefined/不正値は安全に扱う', () => {
    expect(formatJpDate(null)).toBe('')
    expect(formatJpDate(undefined)).toBe('')
    expect(formatJpDate('不正')).toBe('不正')
  })
})

describe('formatJpDateShort', () => {
  it('月/日(曜日)の省スペース表示にする', () => {
    // 2026-07-15 は水曜日
    expect(formatJpDateShort('2026-07-15')).toBe('7/15(水)')
    // 2026-01-05 は月曜日
    expect(formatJpDateShort('2026-01-05')).toBe('1/5(月)')
  })
  it('null/undefined/不正値は安全に扱う', () => {
    expect(formatJpDateShort(null)).toBe('')
    expect(formatJpDateShort(undefined)).toBe('')
    expect(formatJpDateShort('不正')).toBe('不正')
  })
})

describe('formatJpMonth', () => {
  it('YYYY-MM を「年月」で整形する', () => {
    expect(formatJpMonth('2026-07')).toBe('2026年7月')
    expect(formatJpMonth('2026-01')).toBe('2026年1月')
  })
  it('null/undefined/不正値は安全に扱う', () => {
    expect(formatJpMonth(null)).toBe('')
    expect(formatJpMonth(undefined)).toBe('')
    expect(formatJpMonth('不正')).toBe('不正')
  })
})

describe('formatJpDateTime', () => {
  it('日本時間の年月日+時刻で整形する', () => {
    // 2026-07-15T11:05:00Z = 日本時間 2026-07-15 20:05
    expect(formatJpDateTime('2026-07-15T11:05:00Z')).toBe('2026年7月15日 20:05')
  })
  it('null/undefined/不正値は安全に扱う', () => {
    expect(formatJpDateTime(null)).toBe('')
    expect(formatJpDateTime(undefined)).toBe('')
    expect(formatJpDateTime('不正')).toBe('不正')
  })
})
