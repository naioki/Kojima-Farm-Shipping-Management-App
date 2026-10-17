import { describe, it, expect } from 'vitest'
import {
  calculateTax,
  calculateLineTotal,
  sumInvoiceTotals,
  formatInvoiceNumber,
  formatYen,
} from './tax'

describe('calculateTax — 浮動小数点を使わない税額', () => {
  it('8% 軽減税率', () => {
    expect(calculateTax(1000, 8).toNumber()).toBe(80)
  })
  it('10% 標準税率', () => {
    expect(calculateTax(1000, 10).toNumber()).toBe(100)
  })
  it('端数は四捨五入で2桁（333 * 8% = 26.64）', () => {
    expect(calculateTax(333, 8).toString()).toBe('26.64')
  })
  it('浮動小数点誤差が出る値でも正確（0.1*3相当のズレが無い）', () => {
    // 105 * 10% = 10.5 ちょうど
    expect(calculateTax(105, 10).toString()).toBe('10.5')
  })
})

describe('calculateLineTotal — 行単位の税抜/税額/税込', () => {
  it('数量3 × 単価198 × 8% → 税抜594 / 税47.52 / 税込641.52', () => {
    const r = calculateLineTotal(3, 198, 8)
    expect(r.subtotal.toNumber()).toBe(594)
    expect(r.taxAmount.toString()).toBe('47.52')
    expect(r.lineTotal.toString()).toBe('641.52')
  })
})

describe('sumInvoiceTotals — 税率別バケットで合計してから課税', () => {
  it('8%と10%が混在する明細を税率別に集計', () => {
    const totals = sumInvoiceTotals([
      { quantity: 10, unitPrice: 100, taxRate: 8 }, // 1000 (8%)
      { quantity: 5, unitPrice: 200, taxRate: 8 }, // 1000 (8%) → 8%計2000
      { quantity: 1, unitPrice: 500, taxRate: 10 }, // 500 (10%)
    ])
    expect(totals.reduced.subtotal.toNumber()).toBe(2000)
    expect(totals.reduced.tax.toNumber()).toBe(160)
    expect(totals.standard.subtotal.toNumber()).toBe(500)
    expect(totals.standard.tax.toNumber()).toBe(50)
    // 総額 = 2000 + 160 + 500 + 50
    expect(totals.total.toNumber()).toBe(2710)
  })

  it('空明細は全て0', () => {
    const t = sumInvoiceTotals([])
    expect(t.total.toNumber()).toBe(0)
  })
})

describe('formatInvoiceNumber — 欠番なし採番の整形', () => {
  it('"2025-01" + 1 → "202501-0001"', () => {
    expect(formatInvoiceNumber('2025-01', 1)).toBe('202501-0001')
  })
  it('4桁を超える連番もゼロ詰めはそのまま桁あふれ', () => {
    expect(formatInvoiceNumber('2025-12', 12345)).toBe('202512-12345')
  })
  it('不正な月はエラー', () => {
    expect(() => formatInvoiceNumber('2025/01', 1)).toThrow()
  })
  it('連番0以下はエラー', () => {
    expect(() => formatInvoiceNumber('2025-01', 0)).toThrow()
  })
})

describe('formatYen', () => {
  it('3桁区切りで円記号付与', () => {
    expect(formatYen(2500000)).toBe('¥2,500,000')
  })
})
