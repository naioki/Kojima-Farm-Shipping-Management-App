import Decimal from 'decimal.js'

/**
 * 税額・請求計算（tax.md 厳守）。
 * - 浮動小数点演算は禁止。すべて Decimal.js。
 * - 税率は 8 / 10 のみ。
 * - 端数処理は四捨五入（ROUND_HALF_UP）で 2 桁固定。
 * - 税率は注文時の確定値（order_items.tax_rate / invoice_items.tax_rate）を使う。
 *   products.default_tax_rate で計算してはならない。
 */

export type TaxRate = 8 | 10

/** 軽減税率(8%)対象の代表例。判定の唯一の正は order_items.tax_rate（冗長保持値）。 */
export const REDUCED_TAX_RATE: TaxRate = 8
export const STANDARD_TAX_RATE: TaxRate = 10

/** subtotal（税抜）から税額を算出。四捨五入で2桁。 */
export function calculateTax(subtotal: Decimal.Value, taxRate: TaxRate): Decimal {
  return new Decimal(subtotal)
    .times(taxRate)
    .dividedBy(100)
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
}

export interface LineTotal {
  subtotal: Decimal
  taxAmount: Decimal
  lineTotal: Decimal
}

/** 数量×単価→税抜・税額・税込。DBの生成列と同じ式（tax.md）。 */
export function calculateLineTotal(
  quantity: Decimal.Value,
  unitPrice: Decimal.Value,
  taxRate: TaxRate,
): LineTotal {
  const subtotal = new Decimal(quantity).times(unitPrice).toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
  const taxAmount = calculateTax(subtotal, taxRate)
  return { subtotal, taxAmount, lineTotal: subtotal.plus(taxAmount) }
}

export interface TaxBucket {
  /** 税抜合計 */
  subtotal: Decimal
  /** 消費税額 */
  tax: Decimal
}

export interface InvoiceTotals {
  /** 8% 対象 */
  reduced: TaxBucket
  /** 10% 対象 */
  standard: TaxBucket
  /** 税込総額 */
  total: Decimal
}

export interface InvoiceLineInput {
  quantity: Decimal.Value
  unitPrice: Decimal.Value
  taxRate: TaxRate
}

/**
 * 請求書の税率別合計（tax.md「軽減税率・標準税率を別々に合計」）。
 * インボイス制度：税率ごとに税抜合計→税額を出し、最後に合算する。
 * （行ごとに丸めた税額の単純合算ではなく、税率バケット単位で税抜を合計してから課税する）
 */
export function sumInvoiceTotals(lines: InvoiceLineInput[]): InvoiceTotals {
  let sub8 = new Decimal(0)
  let sub10 = new Decimal(0)

  for (const line of lines) {
    const subtotal = new Decimal(line.quantity)
      .times(line.unitPrice)
      .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
    if (line.taxRate === REDUCED_TAX_RATE) sub8 = sub8.plus(subtotal)
    else sub10 = sub10.plus(subtotal)
  }

  const tax8 = calculateTax(sub8, REDUCED_TAX_RATE)
  const tax10 = calculateTax(sub10, STANDARD_TAX_RATE)
  const total = sub8.plus(tax8).plus(sub10).plus(tax10)

  return {
    reduced: { subtotal: sub8, tax: tax8 },
    standard: { subtotal: sub10, tax: tax10 },
    total,
  }
}

/**
 * 請求書番号の整形（tax.md）。"2025-01" + 連番1 → "202501-0001"。
 * 連番自体の払い出し（欠番なし）は DB の get_next_invoice_number に委譲する。
 */
export function formatInvoiceNumber(billingMonth: string, seq: number): string {
  const month = billingMonth.replace('-', '')
  if (!/^\d{6}$/.test(month)) {
    throw new Error(`billingMonth は "YYYY-MM" 形式である必要があります: ${billingMonth}`)
  }
  if (!Number.isInteger(seq) || seq < 1) {
    throw new Error(`連番は1以上の整数である必要があります: ${seq}`)
  }
  return `${month}-${String(seq).padStart(4, '0')}`
}

/** 金額の円表示（font-mono + tabular-nums 前提。記号付与のみ担当）。 */
export function formatYen(amount: Decimal.Value): string {
  const n = new Decimal(amount).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber()
  return `¥${n.toLocaleString('ja-JP')}`
}
