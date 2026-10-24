import { describe, it, expect } from 'vitest'
import { verifyAndNormalizeItem } from '@/lib/gemini/analyze'

describe('0-quantity item filtering logic', () => {
  it('correctly normalizes valid items', () => {
    const item = {
      raw_name: 'チンゲン菜 5c',
      product_name: 'チンゲン菜',
      quantity: '100',
      unit: 'P',
      confidence: 0.95,
      cases: 5,
    }
    const res = verifyAndNormalizeItem(item, '勘兵衛', {})
    expect(res.product_name).toBe('チンゲン菜')
    expect(Number(res.quantity)).toBe(100)
  })

  it('identifies 0-quantity strings', () => {
    const qStr1 = '0'
    const qStr2 = '0.0'
    const qStr3 = '  0  '
    expect(Number(qStr1)).toBe(0)
    expect(Number(qStr2)).toBe(0)
    expect(Number(qStr3.trim())).toBe(0)
  })
})
