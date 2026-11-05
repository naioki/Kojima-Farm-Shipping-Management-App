import { describe, it, expect } from 'vitest'
import { resolveBillingUnitPrice, isRuleEffectiveOn, type PriceRuleLite } from './pricing'

const C = 'cust-1'
const P = 'prod-1'
const rules: PriceRuleLite[] = [
  { product_id: P, customer_id: C, unit_price: 100, effective_from: '2026-01-01', effective_to: '2026-06-30' },
  { product_id: P, customer_id: C, unit_price: 120, effective_from: '2026-07-01', effective_to: null },
  { product_id: P, customer_id: C, unit_price: 999, effective_from: '2027-01-01', effective_to: null }, // 未来
  { product_id: P, customer_id: null, unit_price: 80, effective_from: '2025-01-01', effective_to: null },
]
const base = { productId: P, customerId: C, rules, defaultUnitPrice: 50 }

describe('isRuleEffectiveOn', () => {
  it('両端を含む', () => {
    expect(isRuleEffectiveOn({ effective_from: '2026-01-01', effective_to: '2026-06-30' }, '2026-01-01')).toBe(true)
    expect(isRuleEffectiveOn({ effective_from: '2026-01-01', effective_to: '2026-06-30' }, '2026-06-30')).toBe(true)
    expect(isRuleEffectiveOn({ effective_from: '2026-01-01', effective_to: '2026-06-30' }, '2026-07-01')).toBe(false)
  })
})

describe('resolveBillingUnitPrice', () => {
  it('明細に単価があればそれを使う', () => {
    expect(resolveBillingUnitPrice({ ...base, currentUnitPrice: 130, deliveryDate: '2026-11-01' })).toBe(130)
  })
  it('納品日に有効な取引先ルールを使う（未来の価格は使わない）', () => {
    expect(resolveBillingUnitPrice({ ...base, currentUnitPrice: 0, deliveryDate: '2026-11-01' })).toBe(120)
  })
  it('過去の納品日には当時の価格を使う（遡及しない）', () => {
    expect(resolveBillingUnitPrice({ ...base, currentUnitPrice: 0, deliveryDate: '2026-03-15' })).toBe(100)
  })
  it('取引先ルールが無い期間は共通ルール', () => {
    expect(resolveBillingUnitPrice({ ...base, currentUnitPrice: 0, deliveryDate: '2025-12-01' })).toBe(80)
  })
  it('ルールが何も無ければ標準単価', () => {
    expect(resolveBillingUnitPrice({ ...base, rules: [], currentUnitPrice: null, deliveryDate: '2026-11-01' })).toBe(50)
  })
  it('商品未紐付けは0', () => {
    expect(resolveBillingUnitPrice({ ...base, productId: null, currentUnitPrice: 0, deliveryDate: '2026-11-01' })).toBe(0)
  })
})
