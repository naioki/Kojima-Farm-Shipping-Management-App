import { describe, expect, it } from 'vitest'
import { formatSupplyDestination } from './destination'

describe('formatSupplyDestination（帳票の供給先表記）', () => {
  it('取引先＋納入先 → スペース区切り', () => {
    expect(formatSupplyDestination('ヨーク', '東道野辺')).toBe('ヨーク 東道野辺')
  })

  it('納入先なし → 取引先のみ（寺崎パターン）', () => {
    expect(formatSupplyDestination('寺崎', null)).toBe('寺崎')
    expect(formatSupplyDestination('寺崎', '')).toBe('寺崎')
    expect(formatSupplyDestination('寺崎', undefined)).toBe('寺崎')
  })

  it('取引先と納入先が同名 → 重複させない', () => {
    expect(formatSupplyDestination('寺崎', '寺崎')).toBe('寺崎')
  })

  it('空白は正規化する', () => {
    expect(formatSupplyDestination(' ヨーク ', ' 東道野辺 ')).toBe('ヨーク 東道野辺')
    expect(formatSupplyDestination('  ', '東道野辺')).toBe('東道野辺')
  })

  it('両方空 → 空文字（呼び出し側でEmpty処理）', () => {
    expect(formatSupplyDestination(null, null)).toBe('')
  })
})
