import Decimal from 'decimal.js'
import { decomposeByContainer } from '@/lib/calculations/parse-quantity'

/**
 * 総数を「総数 / 荷姿表記」に整形（出荷一覧・配送リストで共用）。
 * 荷姿(pack_config)があれば「総数 / N{販売単位}+端数」、無ければ container_capacity で分解。
 * ケース数が0のときは端数表記（0c10 等）を出さず総数のみにする（見やすさ）。
 */
export function formatQty(
  quantity: number,
  capacity: number | null,
  pack?: { base: number; unit: string } | null,
): string {
  const total = new Decimal(quantity)
  // 荷姿優先
  if (pack && pack.base > 0) {
    const b = decomposeByContainer(total, pack.base)
    if (b && b.containers >= 1) {
      if (b.remainder.isZero()) {
        return `${total.toString()} / ${b.containers}${pack.unit}`
      }
      return `${total.toString()} / ${b.containers}${pack.unit}＋端数1コンテナ(${b.remainder.toString()}P) 計${b.containers + 1}箱`
    }
    if (b && b.containers === 0 && !b.remainder.isZero()) {
      return `${total.toString()} / 端数1コンテナ(${b.remainder.toString()}P)`
    }
    return total.toString()
  }
  // 旧 container_capacity フォールバック
  const b = decomposeByContainer(total, capacity)
  if (!b || b.containers < 1) {
    if (b && !b.remainder.isZero()) {
      return `${total.toString()} / 端数1コンテナ(${b.remainder.toString()}P)`
    }
    return total.toString()
  }
  if (b.remainder.isZero()) {
    return `${total.toString()} / ${b.containers}c`
  }
  return `${total.toString()} / ${b.containers}c＋端数1コンテナ(${b.remainder.toString()}P) 計${b.containers + 1}箱`
}
