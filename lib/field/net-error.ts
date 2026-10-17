/**
 * 現場向けのエラーメッセージ整形（features.md §10 失敗#4「圃場Wi-Fi切断」）。
 *
 * ハウス・畑・配送中は電波が切れやすい。圏外で fetch が失敗すると、ブラウザは
 * TypeError('Failed to fetch') を投げる。これをそのまま toast に出すと現場には
 * 英語の技術文言しか見えず、「なぜ保存できないのか」「どうすれば良いのか」が
 * 分からないまま作業が進んでしまう（＝記録が残らないまま出荷が終わる）。
 *
 * ここで「電波の問題」と「それ以外の失敗」を切り分け、前者は平易な日本語の
 * 行動指示（つながる場所でもう一度）に置き換える。現場の toast は必ずこれを通す。
 */

/** 各ブラウザが圏外・通信断で投げる fetch 失敗メッセージ（Chrome/Firefox/Safari/RN）。 */
const NETWORK_MESSAGE_RE =
  /failed to fetch|networkerror|network request failed|load failed|connection appears to be offline|network ?error/i

/** 通信断（圏外・電波不良）由来のエラーか。ロジックのバグ由来の例外と区別する。 */
export function isNetworkError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : typeof e === 'string' ? e : ''
  return NETWORK_MESSAGE_RE.test(msg)
}

/** ブラウザ自身が圏外を検知しているか（SSR・未対応環境では false）。 */
export function isBrowserOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

/** 圏外時に現場へ出す文言。行動（どうすれば良いか）まで書く。 */
export const OFFLINE_MESSAGE = '電波が とどきません。つながる場所で もう一度 おしてください'

/**
 * toast に出す最終的な文言を決める。
 *   - 圏外・通信断 → OFFLINE_MESSAGE（英語の technical message を現場に見せない）
 *   - それ以外の Error → その message（サーバーからの日本語エラーをそのまま活かす）
 *   - 判別不能 → 呼び出し側が用意した fallback
 */
export function fieldErrorMessage(e: unknown, fallback: string): string {
  if (isNetworkError(e) || isBrowserOffline()) return OFFLINE_MESSAGE
  if (e instanceof Error && e.message.trim()) return e.message
  return fallback
}
