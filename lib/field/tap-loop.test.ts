import { describe, it, expect } from 'vitest'
import { nextFieldStatus, canAdvance, resetOneStep } from './tap-loop'

describe('nextFieldStatus — 前進のみ（循環させない）', () => {
  it('not_started → packed', () => {
    expect(nextFieldStatus('not_started')).toBe('packed')
  })
  it('packed → shipped', () => {
    expect(nextFieldStatus('packed')).toBe('shipped')
  })
  it('★shipped はタップで not_started に戻らない（出荷済み消失を防ぐ・失敗#8）', () => {
    expect(nextFieldStatus('shipped')).toBe('shipped')
  })
})

describe('canAdvance', () => {
  it('shipped で false、他は true', () => {
    expect(canAdvance('not_started')).toBe(true)
    expect(canAdvance('packed')).toBe(true)
    expect(canAdvance('shipped')).toBe(false)
  })
})

describe('resetOneStep — 長押し＋確認後のみ・1段階だけ戻す', () => {
  it('shipped → packed → not_started と一段ずつ', () => {
    expect(resetOneStep('shipped')).toBe('packed')
    expect(resetOneStep('packed')).toBe('not_started')
    expect(resetOneStep('not_started')).toBe('not_started')
  })
})
