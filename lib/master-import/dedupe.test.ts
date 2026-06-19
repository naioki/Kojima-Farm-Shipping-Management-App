import { describe, it, expect } from 'vitest'
import { normalizeName, classify } from './dedupe'

describe('normalizeName', () => {
  it('NFKC で全角英数字・記号を半角化する', () => {
    expect(normalizeName('ＡＢＣ１２３')).toBe('abc123')
  })
  it('空白（前後・中間・全角）を除去する', () => {
    expect(normalizeName(' トマト 　箱 ')).toBe('トマト箱')
  })
  it('大文字小文字を統一する', () => {
    expect(normalizeName('MaruShoku')).toBe('marushoku')
  })
  it('半角カナはNFKCで全角になり一致する', () => {
    expect(normalizeName('ﾄﾏﾄ')).toBe(normalizeName('トマト'))
  })
})

interface Item {
  name: string
  confidence: number
}
const key = (x: Item) => normalizeName(x.name)

describe('classify', () => {
  it('既存DBに無い新規は new・チェックON', () => {
    const out = classify<Item>([{ name: 'なす', confidence: 0.9 }], key, new Set())
    expect(out[0]!.dup).toBe('new')
    expect(out[0]!.checked).toBe(true)
  })

  it('既存DBに同名（表記ゆれ含む）があれば duplicate・チェックOFF', () => {
    const existing = new Set([normalizeName('トマト')])
    const out = classify<Item>([{ name: ' ト マト ', confidence: 0.95 }], key, existing)
    expect(out[0]!.dup).toBe('duplicate')
    expect(out[0]!.checked).toBe(false)
  })

  it('バッチ内重複は confidence が高い1件だけ new、残りは duplicate', () => {
    const out = classify<Item>(
      [
        { name: 'きゅうり', confidence: 0.4 },
        { name: 'キュウリ', confidence: 0.8 }, // NFKCでは別物だが…下のケースで確認
        { name: 'きゅうり', confidence: 0.9 },
      ],
      key,
      new Set(),
    )
    // 'きゅうり' は2件 → 0.9 のものだけ new
    const kyuuri = out.filter((o) => normalizeName(o.name) === normalizeName('きゅうり'))
    expect(kyuuri.filter((o) => o.dup === 'new')).toHaveLength(1)
    expect(kyuuri.find((o) => o.dup === 'new')!.confidence).toBe(0.9)
    expect(kyuuri.filter((o) => o.dup === 'duplicate')).toHaveLength(1)
  })

  it('既存DB重複はバッチ内で最高 confidence でも duplicate', () => {
    const existing = new Set([normalizeName('ねぎ')])
    const out = classify<Item>([{ name: 'ねぎ', confidence: 1 }], key, existing)
    expect(out[0]!.dup).toBe('duplicate')
  })

  it('複合キー（品目|規格）で規格の重複を判定できる', () => {
    const skey = (x: { product: string; label: string; confidence: number }) =>
      `${normalizeName(x.product)}|${normalizeName(x.label)}`
    const existing = new Set([`${normalizeName('トマト')}|${normalizeName('Lサイズ 4kg箱')}`])
    const out = classify(
      [
        { product: 'トマト', label: 'Lサイズ 4kg箱', confidence: 0.9 }, // 既存と一致→duplicate
        { product: 'トマト', label: 'Mサイズ 4kg箱', confidence: 0.9 }, // 別規格→new
      ],
      skey,
      existing,
    )
    expect(out[0]!.dup).toBe('duplicate')
    expect(out[1]!.dup).toBe('new')
  })
})
