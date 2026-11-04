import { describe, it, expect } from 'vitest'
import { shouldCountTick, normalizeOpsPath, IDLE_MS } from './active-time'

describe('shouldCountTick', () => {
  it('表示中かつ直近に操作があれば数える', () => {
    expect(shouldCountTick({ visible: true, now: 100_000, lastInteractionAt: 100_000 - IDLE_MS })).toBe(true)
  })
  it('放置（操作から1分超）は数えない', () => {
    expect(shouldCountTick({ visible: true, now: 100_000, lastInteractionAt: 100_000 - IDLE_MS - 1 })).toBe(false)
  })
  it('非表示（別タブ・画面オフ）は数えない', () => {
    expect(shouldCountTick({ visible: false, now: 1, lastInteractionAt: 1 })).toBe(false)
  })
})

describe('normalizeOpsPath', () => {
  it('UUID と数字IDをまとめる', () => {
    expect(normalizeOpsPath('/admin/orders/3fa85f64-5717-4562-b3fc-2c963f66afa6')).toBe('/admin/orders/:id')
    expect(normalizeOpsPath('/admin/invoices/12/pdf')).toBe('/admin/invoices/:id/pdf')
  })
})
