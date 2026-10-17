/**
 * Gemini モデルの候補リストと優先順位リゾルバ（純データ・server/client 共有）。
 * 'server-only' を付けない。設定画面（client）・AIルール画面（client）・解析（server）から共用する。
 *
 * 【運用改善（2026-10）】
 * Google による新モデル追加（gemini-3.5-flash / gemini-3.8-flash / gemini-2.5-pro 等）や
 * 旧モデル廃止のたびにコード修正・再デプロイが必要になるのを防ぐため、
 * UI側は「自由入力（テキスト＋候補サジェスト）」とし、カンマ区切りでのフォールバック指定にも対応する。
 */

/**
 * 自動モード（未指定・空文字）のときに先頭から順に試行する標準フォールバック鎖。
 * 429（レート制限）/ 503（過負荷）/ 404（モデル廃止・未提供）のときのみ次のモデルへ自動切替する。
 */
export const GEMINI_FALLBACK_ORDER = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-flash-latest',
] as const

/**
 * 設定画面およびAIルール管理画面で表示する入力サジェスト候補（自由入力の補助）。
 * ここに無い新モデル名（例: gemini-3.5-flash, gemini-3.8-flash 等）もそのまま手入力して利用できる。
 */
export const GEMINI_MODEL_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: '自動（推奨: gemini-2.5-flash → lite → latest）' },
  { value: 'gemini-2.5-flash', label: 'gemini-2.5-flash（標準・高精度バランス）' },
  { value: 'gemini-2.5-flash-lite', label: 'gemini-2.5-flash-lite（高速・低コスト）' },
  { value: 'gemini-2.5-pro', label: 'gemini-2.5-pro（高精度・難読手書きFAX向け）' },
  { value: 'gemini-flash-latest', label: 'gemini-flash-latest（常に最新のFlashエイリアス）' },
  { value: 'gemini-3.5-flash', label: 'gemini-3.5-flash（次世代Flashモデル）' },
  { value: 'gemini-3.8-flash', label: 'gemini-3.8-flash（次世代Flashモデル）' },
]

/**
 * 設定された希望モデル文字列（単一モデル名 または カンマ区切りのモデル名リスト）を先頭にした
 * 「試行順リスト」を返す。
 *
 * - 空欄（自動）なら `GEMINI_FALLBACK_ORDER` をそのまま返す。
 * - `"gemini-2.5-pro"` や `"gemini-3.5-flash, gemini-2.5-flash"` のように入力された場合は、
 *   指定されたモデルを先頭に並べ、万が一404/429/503になった場合の保険として標準フォールバックを後ろに繋げる。
 */
export function modelTryOrder(preferred: string | null | undefined): string[] {
  const raw = preferred?.trim()
  if (!raw) return [...GEMINI_FALLBACK_ORDER]

  const customModels = raw
    .split(/[,、\s]+/)
    .map((m) => m.trim())
    .filter(Boolean)

  if (customModels.length === 0) return [...GEMINI_FALLBACK_ORDER]

  const seen = new Set<string>()
  const result: string[] = []
  for (const m of [...customModels, ...GEMINI_FALLBACK_ORDER]) {
    if (!seen.has(m)) {
      seen.add(m)
      result.push(m)
    }
  }
  return result
}
