import { jstTodayStr, shiftDateStr } from '@/lib/dates'

/**
 * チャット（Discord/LINE WORKS 等）本文からの日付解決。v4 `_resolve_date_from_text` 相当。
 *
 * 受け付ける表記（すべて JST 基準で YYYY-MM-DD に解決。解決不能は null）:
 *   - 相対語         : 今日/きょう/today, 明日/あした, 昨日/きのう
 *   - 数字ショートカット: 1=昨日 / 2=今日 / 3=明日（全角・丸数字①②③も可）
 *   - 月日           : 6/15
 *   - 完全指定        : 2026-06-15, 2026/6/15
 *   - MMDD           : 0615
 *
 * 業務日付は必ず lib/dates.ts（JST 統一）を基準に計算する。new Date().toISOString() 由来の
 * 素朴な日付生成は禁止（Cloud Run=UTC で1日ズレる）。
 * チャネル非依存の純関数（Discord/LINE の形式は持ち込まない）。
 */

const pad = (n: number): string => String(n).padStart(2, '0')

function buildDate(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(month) || !Number.isInteger(day)) return null
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return `${year}-${pad(month)}-${pad(day)}`
}

export function resolveDateFromText(text: string | null | undefined): string | null {
  if (!text) return null

  const today = jstTodayStr()
  const year = Number(today.slice(0, 4))

  // NFKC で全角数字・丸数字（①②③→1 2 3）・全角区切り（／－　）を半角化。
  // 「印刷」「いんさつ」等のノイズ語と空白を除去してから判定する。
  const s = text
    .normalize('NFKC')
    .replace(/(印刷して|印刷|いんさつ|プリント|print|してください|して|ください|下さい|お願いします|おねがいします)/gi, '')
    .replace(/\s+/g, '')

  if (s === '') return null

  // 1) 完全指定 YYYY-MM-DD / YYYY/M/D
  const iso = s.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)
  if (iso) return buildDate(Number(iso[1]), Number(iso[2]), Number(iso[3]))

  // 2) M/D（年は今年 JST）
  const md = s.match(/(\d{1,2})\/(\d{1,2})/)
  if (md) return buildDate(year, Number(md[1]), Number(md[2]))

  // 3) MMDD（4桁ちょうど・年は今年 JST）例 "0615"
  const mmdd = s.match(/^(\d{2})(\d{2})$/)
  if (mmdd) return buildDate(year, Number(mmdd[1]), Number(mmdd[2]))

  // 4) 相対語
  if (/今日|きょう|today/i.test(s)) return today
  if (/明日|あした|みょうにち/.test(s)) return shiftDateStr(today, 1)
  if (/昨日|きのう/.test(s)) return shiftDateStr(today, -1)

  // 5) 数字ショートカット（1=昨日, 2=今日, 3=明日）。丸数字は NFKC で 1/2/3 に正規化済み。
  if (s === '1') return shiftDateStr(today, -1)
  if (s === '2') return today
  if (s === '3') return shiftDateStr(today, 1)

  return null
}
