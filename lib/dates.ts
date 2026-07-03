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
