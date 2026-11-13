/**
 * 承認時の統合（同じ取引先・納入先・納品日の承認済み注文へ明細をまとめる。lib/orders/approve.ts）で、
 * 同じ品目の数量を「上書き」するか「加算」するかを、統合元の注文の受け方から決める。
 *
 * 判定に使う値（migrations/0001・0030、書き込み側）:
 * - orders.source: 'fax' | 'email' | 'portal' | 'manual'（NOT NULL・CHECK 制約あり）
 *   - 'fax' / 'email' … 取り込み（lib/ingestion/process-receipt.ts、受信票の channel をそのまま入れる）
 *   - 'portal'        … 取引先ポータル（app/api/portal/orders）
 *   - 'manual'        … 手入力（/api/orders・/api/shipments・/api/shipments/cell）
 * - orders.intake_channel: 'fax' | 'email' | 'portal' | 'phone' | 'line' | 'paper' | 'other' | NULL
 *   - 手入力の内訳（電話・LINE・紙など）。取り込みは書かないので NULL（0030 で過去分は source から補完）
 *
 * 規則（オーナー判断 2026-11-13）:
 * - FAX・メールの取り込み（丸ごと再送を想定） → 上書き（従来どおり）
 * - ポータル・手入力（電話・LINE・紙・その他・内訳不明）など別口の追加注文 → 加算
 * - 上の組み合わせに当てはまらないもの（人が FAX・メールを見て手入力した注文＝再送か追加か区別できない、
 *   source と intake_channel が食い違う、未知の値） → 判断できない（統合しない）
 */
export type MergeMode = 'overwrite' | 'add' | 'unknown'

export const MERGE_MODE_JA: Record<MergeMode, string> = {
  overwrite: '上書き',
  add: '加算',
  unknown: '判断できない',
}

export function decideMergeMode(source: {
  source: string | null | undefined
  intake_channel: string | null | undefined
}): MergeMode {
  const src = source.source ?? null
  const ch = source.intake_channel ?? null
  if (src === 'fax' || src === 'email') {
    return ch === null || ch === src ? 'overwrite' : 'unknown'
  }
  if (src === 'portal') {
    return ch === null || ch === 'portal' ? 'add' : 'unknown'
  }
  if (src === 'manual') {
    if (ch === null || ch === 'phone' || ch === 'line' || ch === 'paper' || ch === 'other') return 'add'
    return 'unknown'
  }
  return 'unknown'
}
