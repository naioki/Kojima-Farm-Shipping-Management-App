/**
 * 配送単位（取引先×納入先）のキー。
 *
 * deliveries テーブルの UNIQUE(uq_delivery_unit) と同じ組み立て方（migrations/0015）。
 * 配送リスト・配送実績・経営ダッシュボードの突き合わせがこのキーで行われるため、
 * 各所でテンプレート文字列を手書きせず必ずこの関数を通す
 * （書き方がずれると「同じ配送先なのに別物」として集計され、数字が食い違う）。
 *
 * 納入先なし（1取引先1配送先）は空文字で表す。null と '' を混在させない。
 */
export function deliveryUnitKey(customerId: string, destinationId: string | null | undefined): string {
  return `${customerId}:${destinationId ?? ''}`
}
