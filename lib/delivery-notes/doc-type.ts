/**
 * 同じ「取引先×その日の明細」を、用途違いの2種類の書面として出し分ける。
 *   - delivery           … 納品書（納品の事実。納品時に渡す）
 *   - order_confirmation … ご注文確認書（注文を承った確認。受注時に相手方へ）
 *
 * データは共通（order_items）。タイトル・文言・日付ラベルだけ変える＝新テーブル/運用は不要。
 * ※「ご注文確認書」は“受領の確認”であり、契約成立を承諾する「注文請書」とは区別する
 *   （請書は印紙税の対象になり得るため、ここでは確認書にとどめる）。
 */

export type DeliveryDocType = 'delivery' | 'order_confirmation'

export const DELIVERY_DOC_TYPES: { value: DeliveryDocType; label: string }[] = [
  { value: 'delivery', label: '納品書' },
  { value: 'order_confirmation', label: 'ご注文確認書' },
]

export interface DocTypeMeta {
  title: string
  lead: string
  dateLabel: string
}

const META: Record<DeliveryDocType, DocTypeMeta> = {
  delivery: {
    title: '納品書',
    lead: '下記のとおり納品いたしました。',
    dateLabel: '納品日',
  },
  order_confirmation: {
    title: 'ご注文確認書',
    lead: '下記のとおりご注文を承りました。',
    dateLabel: '納品予定日',
  },
}

/** クエリ/保存値を安全に DeliveryDocType へ。未知値は fallback（既定 delivery）。 */
export function parseDocType(value: string | null | undefined, fallback: DeliveryDocType = 'delivery'): DeliveryDocType {
  return value === 'delivery' || value === 'order_confirmation' ? value : fallback
}

export function docTypeMeta(type: DeliveryDocType): DocTypeMeta {
  return META[type]
}
