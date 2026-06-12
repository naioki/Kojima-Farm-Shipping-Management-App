import { describe, it, expect } from 'vitest'
import { matchProductName, similarity, normalizeForMatch } from './name-match'

const products = [
  { id: 'tomato', name: 'トマト', aliases: ['とまと', 'tomato'] },
  { id: 'cucumber', name: 'キュウリ', aliases: ['胡瓜', 'きゅうり'] },
  { id: 'komatsuna', name: '小松菜', aliases: ['こまつな'] },
]

describe('normalizeForMatch', () => {
  it('全角英数→半角・記号/空白除去・小文字化', () => {
    expect(normalizeForMatch('ＴＯＭＡＴＯ （Ａ）')).toBe('tomatoa')
  })
})

describe('similarity', () => {
  it('完全一致は1', () => {
    expect(similarity('トマト', 'トマト')).toBe(1)
  })
  it('全く異なると低い', () => {
    expect(similarity('トマト', 'キュウリ')).toBeLessThan(0.5)
  })
})

describe('matchProductName — 名寄せ', () => {
  it('alias 経由で一致（"とまと" → tomato）', () => {
    const r = matchProductName('とまと', products)
    expect(r.productId).toBe('tomato')
    expect(r.needsConfirmation).toBe(false)
  })

  it('表記ゆれ "胡瓜" は alias 一致で cucumber', () => {
    const r = matchProductName('胡瓜', products)
    expect(r.productId).toBe('cucumber')
  })

  it('一致度が低い未知語は要確認（productId=null）', () => {
    const r = matchProductName('ドラゴンフルーツ', products)
    expect(r.productId).toBeNull()
    expect(r.needsConfirmation).toBe(true)
  })

  it('候補が空なら要確認', () => {
    const r = matchProductName('トマト', [])
    expect(r.productId).toBeNull()
    expect(r.needsConfirmation).toBe(true)
  })
})
