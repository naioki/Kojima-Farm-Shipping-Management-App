/**
 * 表示専用の軽量フォーマッタ（クライアントバンドル安全＝Decimal.js非依存）。
 * 金額の「計算」は lib/calculations/tax.ts（Decimal.js）を使うこと。ここは描画用のみ。
 */

/** 円表示。例: 348600 → '¥348,600'。null/NaN は '—'。 */
export function yen(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—'
  return `¥${Math.round(n).toLocaleString('ja-JP')}`
}

/** 万円（軸ラベル等）。例: 2193400 → '219'。 */
export function man(n: number): string {
  return Math.round(n / 10000).toLocaleString('ja-JP')
}

/** 符号付きパーセント。例: 12.3 → '+12.3%'、-5 → '-5%'。 */
export function signedPct(n: number): string {
  const rounded = Math.round(n * 10) / 10
  return `${rounded >= 0 ? '+' : ''}${rounded}%`
}
