import { describe, it, expect } from 'vitest'
import { resolvePrice, lineAmount, type PriceRule } from './resolve'

const base = (over: Partial<PriceRule>): PriceRule => ({
  id: 'r',
  product_id: 'P',
  customer_id: null,
  pack_config_id: null,
  channel: null,
  price_unit: 'base',
  unit_price: 100,
  tax_rate: 8,
  effective_from: '2026-01-01',
  effective_to: null,
  ...over,
})

const query = {
  productId: 'P',
  customerId: 'C',
  packConfigId: 'PK',
  channel: 'fax',
  referenceDate: '2026-06-15',
}

describe('resolvePrice', () => {
  it('該当ルールが無ければ null（価格未設定で止める）', () => {
    expect(resolvePrice([], query)).toBeNull()
    expect(resolvePrice([base({ product_id: 'OTHER' })], query)).toBeNull()
  })

  it('定価（全NULL）に当たる', () => {
    const r = resolvePrice([base({ id: 'list', unit_price: 100 })], query)
    expect(r?.rule.id).toBe('list')
  })

  it('取引先別価格が定価より優先される（特異性）', () => {
    const rules = [
      base({ id: 'list', customer_id: null, unit_price: 100 }),
      base({ id: 'cust', customer_id: 'C', unit_price: 120 }),
    ]
    expect(resolvePrice(rules, query)?.rule.id).toBe('cust')
  })

  it('別の取引先向けルールは適用されない', () => {
    const rules = [base({ id: 'other', customer_id: 'OTHER', unit_price: 999 })]
    expect(resolvePrice(rules, query)).toBeNull()
  })

  it('同一範囲では effective_from が最新のものを採用（後決め＝後から価格が立つ）', () => {
    const rules = [
      base({ id: 'old', customer_id: 'C', unit_price: 100, effective_from: '2026-01-01' }),
      base({ id: 'new', customer_id: 'C', unit_price: 150, effective_from: '2026-06-01' }),
      base({ id: 'future', customer_id: 'C', unit_price: 200, effective_from: '2026-12-01' }),
    ]
    // 基準日 2026-06-15 では new(6/1) が有効、future(12/1) はまだ無効
    expect(resolvePrice(rules, query)?.rule.id).toBe('new')
  })

  it('基準日より後の effective_from は無効', () => {
    const rules = [base({ id: 'future', customer_id: 'C', effective_from: '2026-07-01' })]
    expect(resolvePrice(rules, query)).toBeNull()
  })

  it('effective_to を過ぎたルールは無効（廃止）', () => {
    const rules = [base({ id: 'ended', customer_id: 'C', effective_from: '2026-01-01', effective_to: '2026-06-01' })]
    expect(resolvePrice(rules, query)).toBeNull()
  })

  it('荷姿別価格は荷姿非依存より優先', () => {
    const rules = [
      base({ id: 'cust', customer_id: 'C', pack_config_id: null, unit_price: 120 }),
      base({ id: 'pack', customer_id: 'C', pack_config_id: 'PK', unit_price: 130 }),
    ]
    expect(resolvePrice(rules, query)?.rule.id).toBe('pack')
  })

  it('チャネル一致が同特異性の最後の決め手になる', () => {
    const rules = [
      base({ id: 'anychan', customer_id: 'C', channel: null, unit_price: 120 }),
      base({ id: 'fax', customer_id: 'C', channel: 'fax', unit_price: 125 }),
    ]
    expect(resolvePrice(rules, query)?.rule.id).toBe('fax')
  })
})

describe('lineAmount', () => {
  it('数量×単価を Decimal で計算し2桁に丸める', () => {
    const r = base({ unit_price: 128 })
    expect(lineAmount(r, 36).toNumber()).toBe(4608)
  })

  it('小数数量（kg）でも誤差なく丸める', () => {
    const r = base({ unit_price: 333.33 })
    expect(lineAmount(r, 3).toNumber()).toBe(999.99)
  })
})
