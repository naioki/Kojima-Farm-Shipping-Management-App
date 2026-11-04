/**
 * 請求時の単価決定（純関数・DB非依存）。
 *
 * 価格マスタ(price_rules)は「期間 × 取引先」の単価（CLAUDE.md）。請求時の補完は
 * 明細の納品日に有効なルールだけを使う。未来から有効になる価格や期限切れの価格は使わない。
 *
 * 優先順位:
 *   1. 明細に単価が入っている（> 0）→ そのまま（注文時の確定値を尊重）
 *   2. 納品日に有効な「その取引先専用」ルール（effective_from が最も新しいもの）
 *   3. 納品日に有効な「全取引先共通」ルール（customer_id = null）
 *   4. 商品の標準単価
 *   5. 0
 */
export interface PriceRuleLite {
  product_id: string
  customer_id: string | null
  unit_price: number | string
  effective_from: string | null
  effective_to: string | null
}

/** YYYY-MM-DD の納品日にこのルールが有効か（両端含む。null は無期限）。 */
export function isRuleEffectiveOn(rule: Pick<PriceRuleLite, 'effective_from' | 'effective_to'>, date: string): boolean {
  const from = rule.effective_from?.slice(0, 10) ?? null
  const to = rule.effective_to?.slice(0, 10) ?? null
  if (from && date < from) return false
  if (to && date > to) return false
  return true
}

function pickLatest(rules: PriceRuleLite[]): PriceRuleLite | undefined {
  return [...rules].sort((a, b) => (b.effective_from ?? '').localeCompare(a.effective_from ?? ''))[0]
}

export function resolveBillingUnitPrice(params: {
  currentUnitPrice: number | string | null | undefined
  productId: string | null
  customerId: string
  deliveryDate: string | null
  rules: PriceRuleLite[]
  defaultUnitPrice: number | null | undefined
}): number {
  const current = Number(params.currentUnitPrice ?? 0)
  if (current > 0) return current
  if (!params.productId) return 0

  const date = params.deliveryDate?.slice(0, 10) ?? null
  const effective = params.rules.filter(
    (r) => r.product_id === params.productId && (date ? isRuleEffectiveOn(r, date) : true),
  )
  const own = pickLatest(effective.filter((r) => r.customer_id === params.customerId))
  if (own) return Number(own.unit_price) || 0
  const common = pickLatest(effective.filter((r) => r.customer_id === null))
  if (common) return Number(common.unit_price) || 0

  return Number(params.defaultUnitPrice ?? 0) || 0
}
