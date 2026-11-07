/**
 * 承認待ち注文の型定義および判定ヘルパー（クライアント・サーバー共用）。
 * 'server-only' を含めないことで、'use client' コンポーネントからも安全にインポート可能。
 */
import { foldKana } from '@/lib/normalize/kana'
import { ANOMALY_FACTOR } from './quantity-anomaly'

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
  /** 過去の承認済み数量と比べて多すぎ/少なすぎ（lib/orders/quantity-anomaly） */
  quantityAnomaly?: 'high' | 'low' | null
  /** いつもの数量（同じ取引先×品目の中央値） */
  usualQuantity?: number | null
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
  /**
   * 納入先の表示名（取引先＞納入先の表記に使う）。承認時にサーバーが確定させるのと同じ判定
   * （登録済みの納入先・納入先が1件だけ・メモにマスタの名前/別名がある）で決まったときだけ入る。
   * 未確定・納入先なしの取引先は null。
   */
  destinationName: string | null
  /** FAX・メモに書かれていた納入先の文字（マスタと照合できなくても参考表示する。「FAXの記載: ○○」） */
  destinationHint: string | null
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

/** 要確認の理由（kana=false で漢字表記＝管理画面用。既定はやさしい日本語＝現場用）。 */
export function pendingReasons(o: PendingOrder, opts: { kana?: boolean } = {}): string[] {
  const kana = opts.kana ?? true
  const r: string[] = []
  if (!o.customerId) r.push(kana ? '取引先 みとうろく' : '取引先 未登録')
  if (o.needsDeliveryDate) r.push(kana ? 'のうひん日 みてい' : '納品日 未定')
  if (o.needsDestination) r.push(kana ? 'のうにゅうさき みてい' : '納入先 未定')
  if (o.items.some((it) => it.packConfigOptions.length > 0 && !it.packConfigId)) r.push(kana ? '荷姿 みてい' : '荷姿 未定')
  if (o.minConfidence == null || o.minConfidence < 0.7) r.push(kana ? 'AI じしんなし' : 'AIの読み取りに自信なし')
  if (o.items.some((it) => it.quantityAnomaly)) r.push(kana ? 'かず が いつもと ちがう' : '数量がいつもと違う')
  return r
}

/** 照合に使う納入先マスタ（code / full_name / aliases）。 */
export interface DestinationCandidate {
  id: string
  code: string | null
  full_name: string
  aliases?: string[] | null
}

/**
 * 承認待ち注文の納入先を、承認API（lib/orders/approve.ts）と同じ規則で判定する（純関数）。
 *  - 注文に納入先が登録済み → それ
 *  - 取引先に納入先が無い → 納入先なし（判定不要）
 *  - 納入先が1件だけ → その1件（承認時に自動で付く）
 *  - 複数 → メモと品目名に、マスタの code / full_name / 別名（3文字以上）が含まれていればそれ
 *  - 決まらなければ「納入先 未定」（取引先設定で納入先を指定しない取引先は除く）
 * メモの文字列だけ（マスタと照合できない）では確定扱いにしない。承認画面とサーバーの判定を揃えるため。
 */
export function resolvePendingDestination(input: {
  destinationId: string | null
  destinations: DestinationCandidate[]
  noteText: string | null
  productNames: string[]
  skipsGate?: boolean
}): { destinationId: string | null; needsDestination: boolean } {
  const { destinationId, destinations } = input
  if (destinationId) return { destinationId, needsDestination: false }
  if (destinations.length === 0) return { destinationId: null, needsDestination: false }
  if (destinations.length === 1) return { destinationId: destinations[0]!.id, needsDestination: false }
  const norm = (s: string) => foldKana(s.normalize('NFKC').toLowerCase())
  const text = norm(`${input.noteText ?? ''} ${input.productNames.join(' ')}`)
  const matched = destinations.find((d) =>
    [d.code, d.full_name, ...(d.aliases ?? [])]
      .filter((c): c is string => Boolean(c))
      .map(norm)
      .some((c) => c.length >= 3 && text.includes(c)),
  )
  if (matched) return { destinationId: matched.id, needsDestination: false }
  return { destinationId: null, needsDestination: !input.skipsGate }
}

/** メモ（orders.note）に書かれた納入先の文字を取り出す（参考表示用。確定には使わない）。 */
export function extractDestinationHint(noteText?: string | null): string | null {
  if (!noteText) return null
  const m1 = noteText.match(/(?:納入先|お届け先|配送先)(?:\(OCR\))?[:：\s]+([^\n,、・\]】]+)/)
  if (m1?.[1]) return m1[1].trim()
  const m2 = noteText.match(/【(?:納入先|お届け先|配送先)[:：\s]*([^】]+)】/)
  if (m2?.[1]) return m2[1].trim()
  return null
}

/**
 * 画面で数量を直したあとの「いつもと違う」判定（純関数）。いつもの数量（中央値）があれば、
 * サーバー（lib/orders/quantity-anomaly）と同じ倍率で判定し直す。いつもの数量が無ければ判定しない。
 */
export function quantityAnomalyFor(quantity: number, usual: number | null | undefined): 'high' | 'low' | null {
  if (usual == null || !(usual > 0) || !(quantity > 0)) return null
  if (quantity >= usual * ANOMALY_FACTOR) return 'high'
  if (quantity <= usual / ANOMALY_FACTOR) return 'low'
  return null
}

/** 承認前に荷姿を選ぶ必要がある品目名（荷姿の登録がある品目で未選択のもの）。 */
export function itemsMissingPack(
  items: Pick<PendingOrderItem, 'productName' | 'packConfigId' | 'packConfigOptions'>[],
): string[] {
  return items.filter((it) => it.packConfigOptions.length > 0 && !it.packConfigId).map((it) => it.productName)
}
