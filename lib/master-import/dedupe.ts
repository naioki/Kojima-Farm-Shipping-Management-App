/**
 * 写真からマスタ一括取込の重複判定（名寄せ）。純粋関数のみ。
 * client（確認画面）と server（登録API）の双方から使うため副作用を持たない。
 */

export type Dup = 'new' | 'duplicate'

/**
 * 名寄せの基準キー: NFKC 正規化 + 空白除去 + 小文字化。
 * 全角半角・前後空白・大小文字の差を吸収して「同じ名前」を同一視する。
 */
export function normalizeName(s: string): string {
  return s.normalize('NFKC').replace(/\s+/g, '').toLowerCase()
}

/**
 * バッチ内重複（信頼度が高い方を残す）＋ 既存DB重複を判定して dup/checked を付与する。
 * - 既存DBに同名がある → duplicate（チェックOFF）
 * - バッチ内に同名が複数 → 最も confidence が高い1件だけ new、残りは duplicate
 * - それ以外 → new（チェックON）
 *
 * keyFn が同じ文字列を返すものを「同一」とみなす。
 */
export function classify<T extends { confidence: number }>(
  items: T[],
  keyFn: (t: T) => string,
  existingSet: Set<string>,
): (T & { dup: Dup; checked: boolean })[] {
  const bestIdxByKey = new Map<string, number>()
  items.forEach((it, i) => {
    const k = keyFn(it)
    const prev = bestIdxByKey.get(k)
    if (prev === undefined || items[prev]!.confidence < it.confidence) bestIdxByKey.set(k, i)
  })
  return items.map((it, i) => {
    const k = keyFn(it)
    const inDb = existingSet.has(k)
    const isBatchBest = bestIdxByKey.get(k) === i
    const dup: Dup = inDb || !isBatchBest ? 'duplicate' : 'new'
    return { ...it, dup, checked: dup === 'new' }
  })
}
