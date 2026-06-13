import { describe, it, expect } from 'vitest'
import { buildInvoiceCsv, INVOICE_CSV_HEADER, CSV_BOM, type InvoiceCsvRow } from './csv'

const base: InvoiceCsvRow = {
  invoice_number: '202506-0001',
  issue_date: '2026-06-30',
  customer_name: 'マルショク',
  billing_month: '2026-06',
  period_start: '2026-06-01',
  period_end: '2026-06-30',
  product_name: 'トマト',
  quantity: 58,
  unit: '個',
  unit_price: 120,
  tax_rate: 8,
  subtotal: 6960,
  tax_amount: 556,
  line_total: 7516,
  registration_number: 'T1234567890123',
}

describe('buildInvoiceCsv', () => {
  it('1行目はヘッダー、改行は CRLF', () => {
    const csv = buildInvoiceCsv([base])
    const lines = csv.split('\r\n')
    expect(lines[0]).toBe(INVOICE_CSV_HEADER.join(','))
    expect(lines).toHaveLength(2)
  })

  it('税率8%は軽減税率の税区分になる', () => {
    const csv = buildInvoiceCsv([base])
    expect(csv).toContain('課税売上8%（軽減）')
    expect(csv).toContain('8%')
  })

  it('税率10%は標準税区分になる', () => {
    const csv = buildInvoiceCsv([{ ...base, tax_rate: 10 }])
    expect(csv).toContain('課税売上10%')
  })

  it('カンマ・ダブルクオートを含む値はエスケープされる', () => {
    const csv = buildInvoiceCsv([{ ...base, product_name: 'トマト,大玉"特"' }])
    expect(csv).toContain('"トマト,大玉""特"""')
  })

  it('null フィールドは空文字になる', () => {
    const csv = buildInvoiceCsv([
      { ...base, issue_date: null, period_start: null, period_end: null, registration_number: null },
    ])
    const cols = csv.split('\r\n')[1]!.split(',')
    // 発行日(idx1)・対象期間開始(idx4)・対象期間終了(idx5)・登録番号(末尾)が空
    expect(cols[1]).toBe('')
    expect(cols[4]).toBe('')
    expect(cols[5]).toBe('')
    expect(cols[cols.length - 1]).toBe('')
  })

  it('複数明細を行として並べる', () => {
    const csv = buildInvoiceCsv([base, { ...base, product_name: 'きゅうり', tax_rate: 8 }])
    expect(csv.split('\r\n')).toHaveLength(3)
  })

  it('BOM は Excel 文字化け対策の U+FEFF', () => {
    expect(CSV_BOM).toBe('﻿')
    expect(CSV_BOM.charCodeAt(0)).toBe(0xfeff)
  })
})
