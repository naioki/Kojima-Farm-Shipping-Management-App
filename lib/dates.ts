/**
 * 業務日付（YYYY-MM-DD）は必ず日本時間で計算する。
 * `new Date().toISOString().slice(0,10)` はUTCの日付を返すため、
 * Cloud Run（UTC）では朝9時まで「昨日」になり、当日出荷リスト・納品書・
 * 請求発行日がすべて1日ズレる。ブラウザ側でも同じズレが起きる。
 * 業務日付の取得はこのファイルの関数だけを使うこと。
 */

/** Date を日本時間の YYYY-MM-DD に整形（sv-SE ロケールは ISO 形式を返す） */
export function jstDateStr(d: Date): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(d)
}

/** 日本時間での今日（YYYY-MM-DD） */
export function jstTodayStr(): string {
  return jstDateStr(new Date())
}

/** YYYY-MM-DD を n 日ずらす（タイムゾーン非依存のカレンダー計算） */
export function shiftDateStr(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + days)
  return dt.toISOString().slice(0, 10)
}

const WEEKDAY_JA = ['日', '月', '火', '水', '木', '金', '土']

/** YYYY-MM-DD → "2026年7月15日"（日本で一般的な年月日順）。不正な値はそのまま返す。 */
export function formatJpDate(dateStr: string | null | undefined): string {
  if (!dateStr) return ''
  const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return dateStr
  return `${Number(m[1])}年${Number(m[2])}月${Number(m[3])}日`
}

/** YYYY-MM-DD → "7/15(水)"（一覧・カードの省スペース表示・曜日付き）。不正な値はそのまま返す。 */
export function formatJpDateShort(dateStr: string | null | undefined): string {
  if (!dateStr) return ''
  const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return dateStr
  const [, y, mo, d] = m
  const wd = WEEKDAY_JA[new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d))).getUTCDay()]
  return `${Number(mo)}/${Number(d)}(${wd})`
}

/** YYYY-MM → "2026年7月"（請求対象月・締め表示）。不正な値はそのまま返す。 */
export function formatJpMonth(monthStr: string | null | undefined): string {
  if (!monthStr) return ''
  const m = monthStr.match(/^(\d{4})-(\d{2})/)
  if (!m) return monthStr
  return `${Number(m[1])}年${Number(m[2])}月`
}

/** ISO日時（timestamptz）→ "2026年7月15日 20:05"（監査ログ・受信日時等）。日本時間で表示。不正な値はそのまま返す。 */
export function formatJpDateTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const dt = new Date(iso)
  if (Number.isNaN(dt.getTime())) return iso
  const datePart = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'long', day: 'numeric' }).format(dt)
  const timePart = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hour12: false }).format(dt)
  return `${datePart} ${timePart}`
}
