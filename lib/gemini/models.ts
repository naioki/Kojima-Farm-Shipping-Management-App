/**
 * Gemini モデルの候補リストと優先順位リゾルバ（純データ・server/client 共有）。
 * 'server-only' を付けない。設定画面（client）・AIルール画面（client）・解析（server）から共用する。
 *
 * 【2段階モデル運用（2026-10）】
 * 1. メインモデル (`GEMINI_MODEL`):
 *    日常の通常FAX・テキスト読取で使う高速・低コストモデル（既定: `gemini-3.5-flash-lite`）。
 * 2. 重要箇所モデル (`GEMINI_MODEL_HIGH`):
 *    低確信・要確認時の自動再検証、手書き修正（差分検出）、AI対話修正・ルール学習など、
 *    大切なところだけで使う高精度モデル（既定: `gemini-3.8-flash`）。
 * 3. 自由入力＋表記ゆれ自動補正＋自動フォールバック:
 *    `gemini3.5flashlite` や `gemini3.8flash` のようなハイフン無し手入力も自動で正式IDへ正規化し、
 *    万一API側で未提供(404)や混雑(429/503)が返った場合は自動で後続モデルへフォールバックする。
 */

export const DEFAULT_MAIN_GEMINI_MODEL = 'gemini-3.5-flash-lite'
export const DEFAULT_HIGH_GEMINI_MODEL = 'gemini-3.8-flash'

/**
 * メインモデル（通常読取・高速軽量）の標準フォールバック鎖。
 * 429（レート制限）/ 503（過負荷）/ 404（モデル未提供）のときのみ次のモデルへ自動切替する。
 */
export const GEMINI_FALLBACK_ORDER = [
  'gemini-3.5-flash-lite',
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-flash-latest',
] as const

/**
 * 重要箇所モデル（低確信時の再検証・手書き修正・ルール学習・マスタ取込）の標準フォールバック鎖。
 */
export const GEMINI_HIGH_FALLBACK_ORDER = [
  'gemini-3.8-flash',
  'gemini-2.5-flash',
  'gemini-2.5-pro',
  'gemini-flash-latest',
] as const

/**
 * メインモデル用サジェスト候補（自由入力の補助）。
 */
export const GEMINI_MODEL_OPTIONS: { value: string; label: string }[] = [
  { value: 'gemini-3.5-flash-lite', label: 'gemini-3.5-flash-lite（推奨メイン：高速・省コスト）' },
  { value: 'gemini-2.5-flash-lite', label: 'gemini-2.5-flash-lite（安定版Lite）' },
  { value: 'gemini-2.5-flash', label: 'gemini-2.5-flash（標準Flash）' },
  { value: 'gemini-3.8-flash', label: 'gemini-3.8-flash（高精度Flash）' },
  { value: 'gemini-flash-latest', label: 'gemini-flash-latest（最新エイリアス）' },
  { value: '', label: '自動（gemini-3.5-flash-lite → 2.5-flash-lite 順）' },
]

/**
 * 重要箇所モデル用サジェスト候補（自由入力の補助）。
 */
export const GEMINI_HIGH_MODEL_OPTIONS: { value: string; label: string }[] = [
  { value: 'gemini-3.8-flash', label: 'gemini-3.8-flash（推奨：重要箇所・再検証・ルール学習用）' },
  { value: 'gemini-2.5-flash', label: 'gemini-2.5-flash（安定版高精度Flash）' },
  { value: 'gemini-2.5-pro', label: 'gemini-2.5-pro（最高精度Pro・難読手書き向け）' },
  { value: 'gemini-3.5-flash', label: 'gemini-3.5-flash（次世代Flash）' },
  { value: '', label: '自動（gemini-3.8-flash → 2.5-flash → 2.5-pro 順）' },
]

/**
 * 手入力されたモデル名（例: `gemini3.5flashlite`, `gemini3.8flash` 等）を
 * Google Generative AI API の標準モデルID形式（`gemini-3.5-flash-lite`, `gemini-3.8-flash`）に正規化する。
 */
export function normalizeModelId(raw: string): string {
  const s = raw.trim().toLowerCase().replace(/^models\//, '')
  if (!s) return ''
  // ハイフンや空白を除去したコンパクト文字列で主要な手入力パターンを吸収
  const compact = s.replace(/[\s_-]+/g, '')
  const match = compact.match(/^gemini(\d+(?:\.\d+)?)(flashlite|flash|pro)(preview|latest|exp)?$/)
  if (match) {
    const ver = match[1]!
    const tier = match[2] === 'flashlite' ? 'flash-lite' : match[2]!
    const suffix = match[3] ? `-${match[3]}` : ''
    return `gemini-${ver}-${tier}${suffix}`
  }
  if (compact === 'geminiflashlatest') return 'gemini-flash-latest'
  if (compact === 'geminiprolatest') return 'gemini-pro-latest'
  return s
}

/**
 * メインモデル（通常読取）の試行順リストを返す。
 */
export function modelTryOrder(preferred: string | null | undefined): string[] {
  const raw = preferred?.trim() ?? ''
  if (raw === '') return [...GEMINI_FALLBACK_ORDER]

  const userModels = raw
    .split(/[,、\s]+/)
    .map((m) => normalizeModelId(m))
    .filter((m) => m.length > 0)

  if (userModels.length === 0) return [...GEMINI_FALLBACK_ORDER]

  const seen = new Set<string>()
  const result: string[] = []
  for (const m of [...userModels, ...GEMINI_FALLBACK_ORDER]) {
    if (!seen.has(m)) {
      seen.add(m)
      result.push(m)
    }
  }
  return result
}

/**
 * 重要箇所モデル（低確信時の自動再検証・手書き修正・対話修正・ルール学習）の試行順リストを返す。
 */
export function highModelTryOrder(preferredHigh: string | null | undefined): string[] {
  const raw = preferredHigh?.trim() ?? ''
  if (raw === '') return [...GEMINI_HIGH_FALLBACK_ORDER]

  const userModels = raw
    .split(/[,、\s]+/)
    .map((m) => normalizeModelId(m))
    .filter((m) => m.length > 0)

  if (userModels.length === 0) return [...GEMINI_HIGH_FALLBACK_ORDER]

  const seen = new Set<string>()
  const result: string[] = []
  for (const m of [...userModels, ...GEMINI_HIGH_FALLBACK_ORDER]) {
    if (!seen.has(m)) {
      seen.add(m)
      result.push(m)
    }
  }
  return result
}
