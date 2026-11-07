/**
 * 1箱の入数（パック数）を決める唯一の窓口（オーナー決定 2026-11）。
 *
 * 優先順位:
 *   1. 取引先別ルール   customer_product_rules.packs_per_case
 *   2. 荷姿             pack_configs.base_per_selling
 *        明細に pack_config_id があればその荷姿 → 無ければ その取引先専用 → 取引先共通 の順
 *   3. 品目の標準       products.container_capacity
 *   4. 既定             20
 *
 * - 0・負値・数値でない値は「未設定」として次の段へ進む。
 * - 明細に荷姿が付いていないとき、同じ段（取引先専用 / 取引先共通）に入数の違う荷姿が複数あると
 *   どれを使うか決められないので、その段は使わない（勝手に1つを選んで箱数を変えない）。
 * - 規格の文字列（「入数24」「25入」）や取引先名からの推測は使わない。入数はマスタで決める。
 * - 青梗菜の進捗（目標箱数・残り箱数）を一律20で数える規則（engineering.md §3）は入数とは別の規則。
 *   ここでは扱わない。
 */

export type PacksPerCaseSource = 'customer_rule' | 'pack_config' | 'product' | 'default'

export const DEFAULT_PACKS_PER_CASE = 20

type NumLike = number | string | null | undefined

export interface PackLike {
  base_per_selling?: NumLike
  is_active?: boolean | null
}

export interface ResolvePacksPerCaseInput {
  /** 取引先×品目ルール（無ければ null） */
  rule?: { packs_per_case?: NumLike } | null
  /** 明細で選ばれている荷姿（order_items.pack_config_id の行） */
  packConfig?: PackLike | null
  /** その取引先専用の荷姿（同じ品目のもの） */
  customerPacks?: readonly PackLike[] | null
  /** 取引先共通の荷姿（customer_id が空・同じ品目のもの） */
  sharedPacks?: readonly PackLike[] | null
  /** 品目（products.container_capacity） */
  product?: { container_capacity?: NumLike } | null
}

export interface PacksPerCaseResult {
  value: number
  source: PacksPerCaseSource
}

/** 正の有限数なら数値、それ以外は null（0・負値・空文字・NaN は未設定扱い） */
export function positiveNumber(v: NumLike): number | null {
  if (v == null) return null
  if (typeof v === 'string' && v.trim() === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

/** 有効な荷姿の入数が1種類にそろっていればその値。0件・入数が割れているときは null。 */
export function uniquePackValue(packs: readonly PackLike[] | null | undefined): number | null {
  if (!packs?.length) return null
  const values = new Set<number>()
  for (const p of packs) {
    if (p.is_active === false) continue
    const n = positiveNumber(p.base_per_selling)
    if (n != null) values.add(n)
  }
  return values.size === 1 ? [...values][0]! : null
}

export function resolvePacksPerCase(input: ResolvePacksPerCaseInput): PacksPerCaseResult {
  const fromRule = positiveNumber(input.rule?.packs_per_case)
  if (fromRule != null) return { value: fromRule, source: 'customer_rule' }

  const fromLinePack = positiveNumber(input.packConfig?.base_per_selling)
  if (fromLinePack != null) return { value: fromLinePack, source: 'pack_config' }

  const fromCustomerPack = uniquePackValue(input.customerPacks)
  if (fromCustomerPack != null) return { value: fromCustomerPack, source: 'pack_config' }

  const fromSharedPack = uniquePackValue(input.sharedPacks)
  if (fromSharedPack != null) return { value: fromSharedPack, source: 'pack_config' }

  const fromProduct = positiveNumber(input.product?.container_capacity)
  if (fromProduct != null) return { value: fromProduct, source: 'product' }

  return { value: DEFAULT_PACKS_PER_CASE, source: 'default' }
}

const SOURCE_LABEL: Record<PacksPerCaseSource, string> = {
  customer_rule: '取引先別の設定',
  pack_config: '荷姿',
  product: '品目の標準',
  default: '既定',
}

/** 「取引先別の設定」「荷姿」「品目の標準」「既定」 */
export function packsPerCaseSourceLabel(source: PacksPerCaseSource): string {
  return SOURCE_LABEL[source]
}

/** 「24（取引先別の設定）」 */
export function formatPacksPerCase(r: PacksPerCaseResult): string {
  return `${r.value}（${SOURCE_LABEL[r.source]}）`
}

/**
 * 荷姿の一覧から、ある取引先×品目の「取引先専用」「取引先共通」を取り出す。
 * 非アクティブの荷姿は除く（明細で選ばれている荷姿は packConfig として別に渡す）。
 */
export function splitPacksForCustomer<
  T extends PackLike & { product_id: string; customer_id: string | null },
>(
  packs: readonly T[] | null | undefined,
  customerId: string | null | undefined,
  productId: string,
): { customerPacks: T[]; sharedPacks: T[] } {
  const customerPacks: T[] = []
  const sharedPacks: T[] = []
  for (const p of packs ?? []) {
    if (p.product_id !== productId || p.is_active === false) continue
    if (p.customer_id == null) sharedPacks.push(p)
    else if (customerId && p.customer_id === customerId) customerPacks.push(p)
  }
  return { customerPacks, sharedPacks }
}
