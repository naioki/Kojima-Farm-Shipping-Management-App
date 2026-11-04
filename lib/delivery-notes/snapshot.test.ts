import { describe, it, expect } from 'vitest'
import { isSameNoteSnapshot } from './snapshot'

const header = { amount_mode: 'with_price', issuer_name: '小島農園', issuer_address: null, issuer_tel: null, total_amount: 1080 }
const items = [{ product_name: 'トマト', quantity: 10, unit: '個', unit_price: 100, tax_rate: 8 }]

describe('isSameNoteSnapshot', () => {
  it('DBの数値が文字列でも同じ内容なら同一', () => {
    expect(
      isSameNoteSnapshot(
        { header: { ...header, total_amount: '1080.00' }, items: [{ ...items[0]!, quantity: '10.00', unit_price: '100.00' }] },
        { header, items },
      ),
    ).toBe(true)
  })
  it('数量が違えば別内容（新しい番号で発行する）', () => {
    expect(isSameNoteSnapshot({ header, items }, { header, items: [{ ...items[0]!, quantity: 11 }] })).toBe(false)
  })
  it('発行元が違えば別内容', () => {
    expect(isSameNoteSnapshot({ header, items }, { header: { ...header, issuer_name: 'アイプラス' }, items })).toBe(false)
  })
})
