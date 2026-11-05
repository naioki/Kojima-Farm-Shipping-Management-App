import { describe, it, expect } from 'vitest'
import { detectQuantityAnomaly } from './quantity-anomaly'

describe('いつもと違う数量', () => {
  it('いつも30前後なのに300は多すぎ、8は少なすぎ', () => {
    const h = [30, 28, 32, 30]
    expect(detectQuantityAnomaly(300, h).anomaly).toBe('high')
    expect(detectQuantityAnomaly(8, h).anomaly).toBe('low')
    expect(detectQuantityAnomaly(50, h)).toEqual({ anomaly: null, usual: 30 })
  })
  it('実績が3件未満なら判定しない', () => {
    expect(detectQuantityAnomaly(300, [30, 30]).anomaly).toBeNull()
  })
})
