import { describe, it, expect } from 'vitest'
import {
  normalizeRawName,
  buildCustomerHintText,
  shouldLearnCorrection,
  lookupHint,
  type ParseHint,
} from './learning'

describe('normalizeRawName', () => {
  it('全角・空白・記号を吸収して一致させる', () => {
    expect(normalizeRawName('桃太郎 ')).toBe(normalizeRawName('桃太郎'))
    expect(normalizeRawName('ＴＯＭＡＴＯ')).toBe('tomato')
    expect(normalizeRawName('胡瓜・特')).toBe(normalizeRawName('胡瓜特'))
  })
})

describe('buildCustomerHintText', () => {
  it('ヒント無しは空文字', () => {
    expect(buildCustomerHintText([])).toBe('')
    expect(buildCustomerHintText([{ rawName: '桃太郎', correctedName: '' }])).toBe('')
  })
  it('出現回数の多い順に並べて few-shot 文を作る', () => {
    const hints: ParseHint[] = [
      { rawName: 'A', correctedName: 'トマト', hitCount: 1 },
      { rawName: 'B', correctedName: 'キュウリ', hitCount: 5 },
    ]
    const text = buildCustomerHintText(hints)
    expect(text).toContain('「B」→ キュウリ')
    expect(text.indexOf('B')).toBeLessThan(text.indexOf('A')) // 回数多い B が先
  })
  it('max 件で打ち切る', () => {
    const hints: ParseHint[] = Array.from({ length: 30 }, (_, i) => ({ rawName: `r${i}`, correctedName: `p${i}` }))
    const lines = buildCustomerHintText(hints, 5).split('\n').filter((l) => l.startsWith('- '))
    expect(lines).toHaveLength(5)
  })
})

describe('shouldLearnCorrection', () => {
  it('rawName/correctedName が空なら学習しない', () => {
    expect(shouldLearnCorrection({ rawName: '', correctedName: 'トマト' })).toBe(false)
    expect(shouldLearnCorrection({ rawName: '桃太郎', correctedName: '' })).toBe(false)
  })
  it('AI出力と正解が同じなら学習不要', () => {
    expect(shouldLearnCorrection({ rawName: '桃太郎', correctedName: 'トマト', aiName: 'トマト' })).toBe(false)
  })
  it('AIが間違えた時だけ学習する', () => {
    expect(shouldLearnCorrection({ rawName: '桃太郎', correctedName: 'トマト', aiName: 'いちご' })).toBe(true)
    expect(shouldLearnCorrection({ rawName: '桃太郎', correctedName: 'トマト' })).toBe(true)
  })
})

describe('lookupHint', () => {
  it('正規化一致で正解名を引く', () => {
    const hints: ParseHint[] = [{ rawName: '桃太郎', correctedName: 'トマト' }]
    expect(lookupHint(hints, ' 桃太郎 ')).toBe('トマト')
    expect(lookupHint(hints, '不明')).toBeNull()
  })
})
