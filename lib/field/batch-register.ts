import { foldKana } from '@/lib/normalize/kana'

/**
 * 一括登録（FAX・Excel 等の複数明細）用の純粋関数群。
 * 原則: 照合に失敗したデータを黙って空値で保存・上書き・破棄しない。
 */

/** 照合用の正規化（カナ統一・空白/括弧/中点除去・小文字化） */
export function normalizeForMatch(s: string): string {
  return foldKana(s).replace(/[\s　()（）・]/g, '').toLowerCase()
}

/**
 * 納入先名を候補から照合する。
 * 1) 正規化後の完全一致 → 2) 3文字以上同士の部分一致（短い別名の誤吸収防止）。
 * 名前が空なら候補が1件のときのみそれを返す。見つからなければ undefined（呼び出し側で自動登録）。
 */
export function matchDestination<T extends { label: string }>(name: string, pool: T[]): T | undefined {
  const n = normalizeForMatch(name.trim())
  if (!n) return pool.length === 1 ? pool[0] : undefined
  const exact = pool.find((d) => normalizeForMatch(d.label) === n)
  if (exact) return exact
  return pool.find((d) => {
    const l = normalizeForMatch(d.label)
    return l.length >= 3 && n.length >= 3 && (l.includes(n) || n.includes(l))
  })
}

/** 伝票の日付をそのまま使う（表示中の日付へ寄せない）。日付がない場合のみ fallback。 */
export function resolveBatchDate(slipDate: string | null | undefined, fallback: string): string {
  return slipDate && /^\d{4}-\d{2}-\d{2}$/.test(slipDate) ? slipDate : fallback
}

/**
 * 同一バッチ内で同じキー（取引先×品目×納入先×日付）の2件目以降は上書きせず加算する。
 * 返り値の関数を明細ごとに呼ぶと 'set' | 'increase' を返す。
 */
export function createBatchModePlanner() {
  const seen = new Set<string>()
  return (k: { customerId: string; productId: string; destinationId: string | null; date: string }) => {
    const key = `${k.customerId}:${k.productId}:${k.destinationId ?? '-'}:${k.date}`
    const mode: 'set' | 'increase' = seen.has(key) ? 'increase' : 'set'
    seen.add(key)
    return mode
  }
}
