import { describe, it, expect } from 'vitest'
import {
  determineUndoEligibility,
  isVersionCurrent,
  formatRemaining,
  UNDO_WINDOW_HOURS,
} from './undo'

const base = {
  changeCreatedAt: new Date('2025-01-10T00:00:00Z'),
  now: new Date('2025-01-10T01:00:00Z'), // 1h 経過
  isShipped: false,
  isInvoiceFinalized: false,
  lockedByOther: false,
}

describe('determineUndoEligibility', () => {
  it('期限内・条件クリアなら可（残り時間を返す）', () => {
    const r = determineUndoEligibility(base)
    expect(r.canUndo).toBe(true)
    expect(r.remainingMs).toBe(23 * 60 * 60 * 1000) // 24h - 1h
  })

  it('請求確定済みは不可（最優先ブロック）', () => {
    const r = determineUndoEligibility({ ...base, isInvoiceFinalized: true, isShipped: true })
    expect(r.canUndo).toBe(false)
    expect(r.reason).toBe('invoice_finalized')
  })

  it('出荷済みは不可（タップ消失防止）', () => {
    const r = determineUndoEligibility({ ...base, isShipped: true })
    expect(r).toEqual({ canUndo: false, reason: 'already_shipped' })
  })

  it('他者編集中は不可', () => {
    const r = determineUndoEligibility({ ...base, lockedByOther: true })
    expect(r.reason).toBe('locked_by_other')
  })

  it('24h を超えると期限切れ', () => {
    const r = determineUndoEligibility({
      ...base,
      now: new Date('2025-01-11T01:00:00Z'), // 25h 経過
    })
    expect(r.canUndo).toBe(false)
    expect(r.reason).toBe('expired')
  })

  it('出荷後訂正の窓 72h を明示指定できる', () => {
    const r = determineUndoEligibility({
      ...base,
      now: new Date('2025-01-11T12:00:00Z'), // 36h 経過
      windowHours: UNDO_WINDOW_HOURS.postShipping,
    })
    expect(r.canUndo).toBe(true)
  })
})

describe('isVersionCurrent', () => {
  it('一致で true、不一致で false', () => {
    expect(isVersionCurrent(3, 3)).toBe(true)
    expect(isVersionCurrent(2, 3)).toBe(false)
  })
})

describe('formatRemaining', () => {
  it('時間/分の表示', () => {
    expect(formatRemaining(21 * 3600_000)).toBe('残21h')
    expect(formatRemaining(30 * 60_000)).toBe('残30分')
  })
})
