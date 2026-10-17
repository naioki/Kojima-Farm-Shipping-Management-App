import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { resolveDateFromText } from './dates'

// JST 昼（UTC 03:00）に固定。today=2026-07-13 / 明日=07-14 / 昨日=07-12。
const BASE_JST_NOON = new Date('2026-07-13T03:00:00Z')

describe('resolveDateFromText', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(BASE_JST_NOON)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('相対語（今日/きょう/today）', () => {
    expect(resolveDateFromText('今日')).toBe('2026-07-13')
    expect(resolveDateFromText('きょう')).toBe('2026-07-13')
    expect(resolveDateFromText('today')).toBe('2026-07-13')
    expect(resolveDateFromText('TODAY')).toBe('2026-07-13')
  })

  it('相対語（明日/あした）', () => {
    expect(resolveDateFromText('明日')).toBe('2026-07-14')
    expect(resolveDateFromText('あした')).toBe('2026-07-14')
  })

  it('相対語（昨日/きのう）', () => {
    expect(resolveDateFromText('昨日')).toBe('2026-07-12')
    expect(resolveDateFromText('きのう')).toBe('2026-07-12')
  })

  it('数字ショートカット 1=昨日 / 2=今日 / 3=明日（半角）', () => {
    expect(resolveDateFromText('1')).toBe('2026-07-12')
    expect(resolveDateFromText('2')).toBe('2026-07-13')
    expect(resolveDateFromText('3')).toBe('2026-07-14')
  })

  it('数字ショートカット（全角）', () => {
    expect(resolveDateFromText('１')).toBe('2026-07-12')
    expect(resolveDateFromText('２')).toBe('2026-07-13')
    expect(resolveDateFromText('３')).toBe('2026-07-14')
  })

  it('丸数字①②③', () => {
    expect(resolveDateFromText('①')).toBe('2026-07-12')
    expect(resolveDateFromText('②')).toBe('2026-07-13')
    expect(resolveDateFromText('③')).toBe('2026-07-14')
  })

  it('M/D（年は今年 JST・半角/全角）', () => {
    expect(resolveDateFromText('6/15')).toBe('2026-06-15')
    expect(resolveDateFromText('12/1')).toBe('2026-12-01')
    expect(resolveDateFromText('６／１５')).toBe('2026-06-15')
  })

  it('完全指定 YYYY-MM-DD / YYYY/M/D', () => {
    expect(resolveDateFromText('2026-06-15')).toBe('2026-06-15')
    expect(resolveDateFromText('2025-01-05')).toBe('2025-01-05')
    expect(resolveDateFromText('2026/6/15')).toBe('2026-06-15')
    expect(resolveDateFromText('２０２６－０６－１５')).toBe('2026-06-15')
  })

  it('MMDD（4桁）', () => {
    expect(resolveDateFromText('0615')).toBe('2026-06-15')
    expect(resolveDateFromText('1201')).toBe('2026-12-01')
  })

  it('ノイズ語（印刷・いんさつ等）を除去してから判定', () => {
    expect(resolveDateFromText('明日印刷して')).toBe('2026-07-14')
    expect(resolveDateFromText('印刷 3')).toBe('2026-07-14')
    expect(resolveDateFromText('２ 印刷')).toBe('2026-07-13')
    expect(resolveDateFromText('6/15 いんさつ')).toBe('2026-06-15')
  })

  it('不正入力は null', () => {
    expect(resolveDateFromText('こんにちは')).toBeNull()
    expect(resolveDateFromText('')).toBeNull()
    expect(resolveDateFromText(null)).toBeNull()
    expect(resolveDateFromText(undefined)).toBeNull()
    expect(resolveDateFromText('印刷')).toBeNull()
    expect(resolveDateFromText('13/40')).toBeNull() // 月13・日40は範囲外
    expect(resolveDateFromText('1234')).toBeNull() // MMDD として日34は範囲外
  })

  it('JST 基準（UTC 深夜でも日付がズレない）', () => {
    // UTC 2026-07-13 16:00 = JST 2026-07-14 01:00。素朴な UTC 日付なら 07-13 になる。
    vi.setSystemTime(new Date('2026-07-13T16:00:00Z'))
    expect(resolveDateFromText('今日')).toBe('2026-07-14')
    expect(resolveDateFromText('2')).toBe('2026-07-14')
    expect(resolveDateFromText('明日')).toBe('2026-07-15')
    expect(resolveDateFromText('昨日')).toBe('2026-07-13')
  })
})
