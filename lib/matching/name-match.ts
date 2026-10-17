/**
 * 商品名の名寄せ（features.md §4）。
 * OCR/手書きの raw_name を products.name / aliases に突き合わせる。
 * 一致度 < 0.7 は要確認フラグ（is_flagged）にする。
 *
 * Python difflib.SequenceMatcher の代替として、正規化文字列の
 * Levenshtein 距離ベースの類似度（0..1）を使う。日本語の表記ゆれに耐えるため
 * 全角/半角・空白・記号を正規化してから比較する。
 */

export const NAME_MATCH_THRESHOLD = 0.7

/** 比較用正規化：全角英数→半角、空白/記号除去、小文字化 */
export function normalizeForMatch(s: string): string {
  return s
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[\s　・,，.。\-―ー（）()]/g, '')
    .toLowerCase()
}

/** Levenshtein 距離（編集距離） */
export function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m
  let prev = Array.from({ length: n + 1 }, (_, i) => i)
  let curr = new Array<number>(n + 1).fill(0)
  for (let i = 1; i <= m; i++) {
    curr[0] = i
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost)
    }
    ;[prev, curr] = [curr, prev]
  }
  return prev[n]!
}

/** 0..1 の類似度（1=完全一致）。正規化後に比較する。 */
export function similarity(a: string, b: string): number {
  const na = normalizeForMatch(a)
  const nb = normalizeForMatch(b)
  if (na === '' && nb === '') return 1
  const maxLen = Math.max(na.length, nb.length)
  if (maxLen === 0) return 1
  return 1 - levenshtein(na, nb) / maxLen
}

export interface ProductCandidate {
  id: string
  name: string
  aliases: string[]
}

export interface NameMatchResult {
  productId: string | null
  score: number
  /** score < 閾値 → 人間確認が必要（UI赤・is_flagged） */
  needsConfirmation: boolean
}

/**
 * raw_name を候補商品に突き合わせ、最良一致を返す。
 * name と全 aliases の中で最大の類似度を商品スコアとする。
 */
export function matchProductName(
  rawName: string,
  candidates: ProductCandidate[],
): NameMatchResult {
  let best: { id: string; score: number } | null = null
  for (const c of candidates) {
    const names = [c.name, ...c.aliases]
    let score = 0
    for (const n of names) {
      const s = similarity(rawName, n)
      if (s > score) score = s
    }
    if (!best || score > best.score) best = { id: c.id, score }
  }
  if (!best) return { productId: null, score: 0, needsConfirmation: true }
  return {
    productId: best.score >= NAME_MATCH_THRESHOLD ? best.id : null,
    score: best.score,
    needsConfirmation: best.score < NAME_MATCH_THRESHOLD,
  }
}
