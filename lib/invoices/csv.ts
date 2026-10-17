/**
 * 請求書の会計ソフト取り込み用 CSV 生成（マネーフォワード / freee 等）。
 *
 * 方針：MF・freee いずれも取り込みウィザードで列マッピングできるため、
 * ベンダー固有フォーマットに固定せず「明細1行＝CSV1行」の素直な構造にする。
 * 税率別に分かれた明細（軽減8% / 標準10%）をそのまま行に持つので、
 * freee の税区分・インボイス（適格請求書）要件にも対応しやすい。
 *
 * 金額計算は一切しない（tax.md：金額は DB の生成列を信頼）。ここは整形のみ。
 */

/** CSV 1行ぶんの入力（請求書ヘッダー × 明細を結合した平坦な形）。 */
export interface InvoiceCsvRow {
  invoice_number: string
  issue_date: string | null
  customer_name: string
  /** 'YYYY-MM'（採番・表示用） */
  billing_month: string
  period_start: string | null
  period_end: string | null
  product_name: string
  quantity: number
  unit: string
  unit_price: number
  /** 8 | 10 */
  tax_rate: number
  /** 税抜金額（DB 生成列） */
  subtotal: number
  /** 消費税額（DB 生成列） */
  tax_amount: number
  /** 税込金額（DB 生成列） */
  line_total: number
  /** 適格請求書発行事業者 登録番号（インボイス）。請求書または発行者設定から。 */
  registration_number: string | null
}

/** ヘッダー行（日本語。MF/freee の取り込みウィザードで各列を対応づけられる）。 */
export const INVOICE_CSV_HEADER = [
  '請求書番号',
  '発行日',
  '取引先',
  '請求月',
  '対象期間開始',
  '対象期間終了',
  '品目',
  '数量',
  '単位',
  '単価',
  '税率',
  '税区分',
  '税抜金額',
  '消費税額',
  '税込金額',
  '登録番号',
] as const

/** freee の税区分に寄せた表記（軽減税率を明示）。 */
function taxCategory(rate: number): string {
  if (rate === 8) return '課税売上8%（軽減）'
  return `課税売上${rate}%`
}

/** RFC4180 風エスケープ：カンマ・改行・ダブルクオートを含む場合のみ "" で囲う。 */
function csvCell(value: string | number | null): string {
  const s = value == null ? '' : String(value)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Excel / 会計ソフトが UTF-8 を文字化けせず開けるよう先頭に付ける BOM。 */
export const CSV_BOM = '﻿'

/** 明細行配列 → CSV 本文（ヘッダー込み・CRLF 改行）。BOM は付けない（呼び出し側で付与）。 */
export function buildInvoiceCsv(rows: InvoiceCsvRow[]): string {
  const lines: string[] = [INVOICE_CSV_HEADER.join(',')]
  for (const r of rows) {
    lines.push(
      [
        r.invoice_number,
        r.issue_date ?? '',
        r.customer_name,
        r.billing_month,
        r.period_start ?? '',
        r.period_end ?? '',
        r.product_name,
        r.quantity,
        r.unit,
        r.unit_price,
        `${r.tax_rate}%`,
        taxCategory(r.tax_rate),
        r.subtotal,
        r.tax_amount,
        r.line_total,
        r.registration_number ?? '',
      ]
        .map(csvCell)
        .join(','),
    )
  }
  return lines.join('\r\n')
}
