import Decimal from 'decimal.js'

/**
 * 価格解決エンジン（純ロジック・単体テスト必須）。
 *
 * 後決め商流に対応するため、価格は「期間×取引先×荷姿×チャネル」の price_rules から
 * **基準日**で解決する。解決は次の2段階:
 *   1. 適用範囲の「特異性」で優先順位（取引先・荷姿・チャネルが具体的なほど優先）
 *   2. 同一特異性の中では effective_from ≤ 基準日 の **最新** を採用（開始日のみ＋最新優先）
 *
 * 金額計算は Decimal（tax.md：浮動小数点禁止）。price_unit が 'pack' なら
 * 「販売単位あたり価格」、'base' なら「基準単位あたり価格」を表す。
 */

export interface PriceRule {
  id: string
  product_id: string
  customer_id: string | null
  pack_config_id: string | null
  channel: string | null
  price_unit: 'base' | 'pack'
  unit_price: number
  tax_rate: 8 | 10
  effective_from: string // 'YYYY-MM-DD'
  effective_to: string | null
}

export interface PriceQuery {
  productId: string
  customerId: string | null
  packConfigId: string | null
  channel: string | null
  /** 基準日（既定は出荷日）。'YYYY-MM-DD' */
  referenceDate: string
}

export interface ResolvedPrice {
  rule: PriceRule
  /** 特異性スコア（高いほど具体的）。デバッグ・説明用。 */
  specificity: number
}

/**
 * 適用範囲の特異性スコア。具体的な次元に一致するほど高い。
 * customer(4) > pack(2) > channel(1) の重みで、定価(全NULL)が最弱。
 */
function specificityOf(rule: PriceRule): number {
  return (rule.customer_id ? 4 : 0) + (rule.pack_config_id ? 2 : 0) + (rule.channel ? 1 : 0)
}

/** ルールがクエリに適用可能か（次元が一致 or ルール側が NULL=ワイルドカード）。 */
function isApplicable(rule: PriceRule, q: PriceQuery): boolean {
  if (rule.product_id !== q.productId) return false
  if (rule.customer_id != null && rule.customer_id !== q.customerId) return false
  if (rule.pack_config_id != null && rule.pack_config_id !== q.packConfigId) return false
  if (rule.channel != null && rule.channel !== q.channel) return false
  // 有効期間: effective_from ≤ 基準日 ＜ (effective_to があればそれ)
  if (rule.effective_from > q.referenceDate) return false
  if (rule.effective_to != null && q.referenceDate >= rule.effective_to) return false
  return true
}

/**
 * 価格を解決する。該当なしは null（呼び出し側で「価格未設定」として承認/請求を止める）。
 * 優先順位: 特異性 → effective_from 新しい順 → （同点は id で安定化）。
 */
export function resolvePrice(rules: PriceRule[], q: PriceQuery): ResolvedPrice | null {
  const applicable = rules.filter((r) => isApplicable(r, q))
  if (applicable.length === 0) return null

  applicable.sort((a, b) => {
    const sa = specificityOf(a)
    const sb = specificityOf(b)
    if (sa !== sb) return sb - sa // 特異性が高い順
    if (a.effective_from !== b.effective_from) return a.effective_from < b.effective_from ? 1 : -1 // 新しい順
    return a.id < b.id ? -1 : 1 // 安定化
  })

  const best = applicable[0]!
  return { rule: best, specificity: specificityOf(best) }
}

/**
 * 解決した単価と数量から税抜金額を求める（Decimal）。
 * price_unit='base' は基準単位あたり、'pack' は販売単位あたり。
 * @param billableQty 請求対象数量（price_unit の単位での数量。基準単位 or 販売単位）
 */
export function lineAmount(rule: PriceRule, billableQty: number): Decimal {
  return new Decimal(billableQty).times(rule.unit_price).toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
}
