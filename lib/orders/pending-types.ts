/**
 * 承認待ち注文の型定義および判定ヘルパー（クライアント・サーバー共用）。
 * 'server-only' を含めないことで、'use client' コンポーネントからも安全にインポート可能。
 */

export interface PackConfigOption {
  id: string
  label: string
}

export interface PendingOrderItem {
  id: string
  productId: string | null
  productName: string
  quantity: number
  quantityRaw?: string | null
  unit: string
  spec?: string | null
  containerType?: string | null
  lineNote?: string | null
  confidence: number | null
  /** 楽観ロック用。編集（数量変更）の PATCH に必要。 */
  version: number
  /** 荷姿マスタ確定済みID（未確定は null） */
  packConfigId: string | null
  /** この商品×取引先で選べる荷姿（0件＝マスタ未登録なのでゲート対象外） */
  packConfigOptions: PackConfigOption[]
}

export interface DestinationOption {
  id: string
  label: string
}

/** 承認画面で原本（Kojima-FAX が Google Drive に保存した FAX PDF・メール本文）を比較表示するための情報。 */
export interface ReceiptOriginalInfo {
  id: string
  channel: string
  /** Google Drive 原本URL等があるか */
  hasOriginal: boolean
  /** iframe 埋め込み用 Google Drive プレビューURL (`/preview`) */
  previewUrl?: string | null
  /** 別タブ閲覧用 Google Drive URL (`/view`) */
  originalUrl?: string | null
  /** テキストメールまたは受信メタデータ本文 */
  emailText: string | null
  /** 「同じFAXに追記して再送」された差分受信か */
  isRevision: boolean
  /** 再送の場合の元受信（無ければ null） */
  parent: {
    id: string
    hasOriginal: boolean
    previewUrl?: string | null
    originalUrl?: string | null
    emailText: string | null
  } | null
}

export interface PendingOrder {
  id: string
  source: string
  deliveryDate: string | null
  customerId: string | null
  customerName: string
  customerColor: string | null
  /** 確定済み納入先の表示名（未確定・納入先なしの取引先は null）。取引先＞納入先の表記に使う。 */
  destinationName: string | null
  /** 伝票No・特記事項・数量変更メモ・要確認理由など（orders.note） */
  notes?: string | null
  items: PendingOrderItem[]
  /** 最低確信度（null は確信度なし＝要注意） */
  minConfidence: number | null
  /** 納品日が未確定（承認時に入力が必要） */
  needsDeliveryDate: boolean
  /** 納入先未確定（取引先に納入先が登録されているのに未選択。承認時に選択が必要） */
  needsDestination: boolean
  /** 選べる納入先（取引先に登録がなければ0件） */
  destinationOptions: DestinationOption[]
  /** スタッフでも承認できるか（高確信・取引先一致・納品日確定） */
  staffApprovable: boolean
  /** 受信原本（手動入力・ポータル注文は null＝原本なし） */
  receipt: ReceiptOriginalInfo | null
}

/** 要確認の理由（やさしい日本語のバッジ／注意喚起に使う・admin/field 共通）。 */
export function pendingReasons(o: PendingOrder): string[] {
  const r: string[] = []
  if (!o.customerId) r.push('取引先 みとうろく')
  if (o.needsDeliveryDate) r.push('のうひん日 みてい')
  if (o.needsDestination) r.push('のうにゅうさき みてい')
  if (o.items.some((it) => it.packConfigOptions.length > 0 && !it.packConfigId)) r.push('荷姿 みてい')
  if (o.minConfidence == null || o.minConfidence < 0.7) r.push('AI じしんなし')
  return r
}
