import { describe, it, expect } from 'vitest'
import {
  getQuotaStatus,
  canRunGemini,
  remainingFromUsage,
  GEMINI_DAILY_FREE_LIMIT,
} from './quota'

describe('getQuotaStatus — 残量による段階ゲート', () => {
  it('残>200 は全て可', () => {
    const s = getQuotaStatus(500)
    expect(s.level).toBe('ok')
    expect(s.allowP2 && s.allowP3).toBe(true)
    expect(s.shouldNotify).toBe(false)
  })
  it('残=200（境界）で P3 停止', () => {
    const s = getQuotaStatus(200)
    expect(s.level).toBe('p3_paused')
    expect(s.allowP2).toBe(true)
    expect(s.allowP3).toBe(false)
  })
  it('残=50（境界）で P2 停止し通知', () => {
    const s = getQuotaStatus(50)
    expect(s.level).toBe('p2_paused')
    expect(s.allowP2).toBe(false)
    expect(s.shouldNotify).toBe(true)
  })
  it('残=0 は枯渇・全停止・通知', () => {
    const s = getQuotaStatus(0)
    expect(s.level).toBe('exhausted')
    expect(s.allowP2 || s.allowP3).toBe(false)
    expect(s.shouldNotify).toBe(true)
  })
})

describe('canRunGemini', () => {
  it('残120：P2可・P3不可', () => {
    expect(canRunGemini('P2', 120)).toBe(true)
    expect(canRunGemini('P3', 120)).toBe(false)
  })
})

describe('remainingFromUsage', () => {
  it('上限-使用数。負にならない', () => {
    expect(remainingFromUsage(100)).toBe(GEMINI_DAILY_FREE_LIMIT - 100)
    expect(remainingFromUsage(99999)).toBe(0)
  })
})
