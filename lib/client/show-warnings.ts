import toast from 'react-hot-toast'

/**
 * API の成功応答に載った `warnings: string[]`（本体は保存済みだが付随更新に失敗した、など。
 * lib/api/side-effects.ts）をトーストで出す。黙って成功扱いにしないための共通処理。
 * 文言は API 側で現場向けに作ってあるので、そのまま表示する。表示した件数を返す。
 */
export function showResponseWarnings(json: unknown): number {
  const list = extractWarnings(json)
  for (const w of list) toast(w, { icon: '⚠️', duration: 8000 })
  return list.length
}

/** 応答から warnings（文字列のみ・重複なし）を取り出す。テスト用に分けてある。 */
export function extractWarnings(json: unknown): string[] {
  if (!json || typeof json !== 'object') return []
  const w = (json as { warnings?: unknown }).warnings
  if (!Array.isArray(w)) return []
  return Array.from(new Set(w.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)))
}
