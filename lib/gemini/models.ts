/**
 * Gemini モデルの候補リスト（純データ・server/client 共有）。
 * 'server-only' を付けない。設定画面（client）と解析（server）の双方から import する。
 *
 * 「自動」(空文字) のときは GEMINI_FALLBACK_ORDER を新→古の順に試し、混雑(429/503)や
 * 未提供(404)のときだけ次のモデルへフォールバックする。特定モデルを選んだ場合は
 * そのモデルを先頭に、残りをフォールバック先として後ろに並べる。
 */

/** 新→古の順。先頭から順に試し、429/503/404 のときのみ次へフォールバックする。
 *  ※ gemini-2.0-flash / 2.0-flash-lite は 2026-06-01 でシャットダウン済みのため除外。 */
export const GEMINI_FALLBACK_ORDER = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-flash-latest',
] as const

/** 設定画面のプルダウン選択肢。value='' は「自動」。 */
export const GEMINI_MODEL_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: '自動（推奨・混雑時は自動で切替）' },
  { value: 'gemini-2.5-flash', label: 'gemini-2.5-flash（標準）' },
  { value: 'gemini-2.5-flash-lite', label: 'gemini-2.5-flash-lite（軽量・速い）' },
  { value: 'gemini-flash-latest', label: 'gemini-flash-latest（最新エイリアス）' },
]

/**
 * 設定された希望モデルを先頭にした「試行順」を返す。
 * preferred が空（自動）なら GEMINI_FALLBACK_ORDER そのまま。
 * preferred 指定時は [preferred, ...残りのフォールバック] とし、まず希望モデルを使う。
 */
export function modelTryOrder(preferred: string | null | undefined): string[] {
  const p = preferred?.trim()
  if (!p) return [...GEMINI_FALLBACK_ORDER]
  return [p, ...GEMINI_FALLBACK_ORDER.filter((m) => m !== p)]
}
