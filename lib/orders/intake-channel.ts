/**
 * 手入力で作る注文の受注経路（orders.intake_channel）を決める共通の規則（CLAUDE.md「手入力で注文を作る経路は
 * intake_channel を必ず埋める」・評価指標④紙の卒業）。
 *
 * - 受信ボックスの原本から来た注文（FAX・メール）は固定の経路を使う。
 * - それ以外は画面で選ばれた経路（電話・LINE・紙・その他）。未選択なら null を返し、呼び出し側は登録を止めて
 *   利用者に選んでもらう（勝手な既定値で集計を歪めない）。
 */
export type ManualIntakeChannelValue = 'phone' | 'line' | 'paper' | 'other'
export type IntakeChannelValue = ManualIntakeChannelValue | 'fax' | 'email'

export const MANUAL_INTAKE_CHANNELS: readonly ManualIntakeChannelValue[] = ['phone', 'line', 'paper', 'other']

/** 未選択のまま登録しようとしたときの案内（現場・事務向け） */
export const INTAKE_CHANNEL_REQUIRED_MESSAGE = '受注経路（電話・LINE・紙・その他）を選んでから登録してください'

/** API が返すエラーコード（/api/shipments/cell が新しい注文を作るのに経路が無いとき） */
export const INTAKE_CHANNEL_REQUIRED_ERROR = 'intake_channel_required'

export type ShipmentWriteMode = 'create' | 'increase' | 'decrease' | 'set'

/**
 * その操作が「新しい注文を作りうる」か（＝受注経路を選んでもらう必要があるか）を決める。
 *
 * サーバー（/api/shipments・/api/shipments/cell）は、同じ取引先・納品日・納入先の注文が無ければ、
 * どの mode でも数量が 1 以上なら新しい注文を作る。既存の注文への変更では経路を使わない。
 *
 * - 数量 0（取消・0 上書き）: 新しい注文は作らない → 不要
 * - 既存の注文があると画面が確実に分かっている加算・減量・上書き（increase / decrease / set）: 不要
 * - 'create'（新規として追加）: 必要（名前どおり新規の操作として扱う）
 * - それ以外（既存の注文があるか分からない、数量が数えられない）: 新規かもしれないので必要（安全側）
 */
export function requiresIntakeChannel(op: {
  mode: ShipmentWriteMode
  /** 送る数量（パック数）。0 は取消。数えられないときは null */
  quantity: number | null
  /** 同じ取引先・納品日・納入先の注文があると画面が確実に分かっているときだけ true。分からなければ false/null */
  existingOrderKnown: boolean | null | undefined
}): boolean {
  if (op.quantity === 0) return false
  if (op.mode === 'create') return true
  return op.existingOrderKnown !== true
}

/**
 * 「既存の出荷があるか」の照会（GET /api/shipments）の結果から、既存の注文があると確実に言えるかを決める。
 * 照会は納入先を指定しないと別の納入先の注文も拾う（登録側は「納入先なし」の注文だけを探す）ため、
 * 納入先を指定して照会したとき、または取引先に納入先が1件も無い（注文はすべて納入先なし）ときだけ確実とみなす。
 */
export function existingOrderKnownFromLookup(args: {
  existingFound: boolean
  destinationId: string | null | undefined
  customerHasDestinations: boolean
}): boolean {
  if (!args.existingFound) return false
  return Boolean(args.destinationId) || !args.customerHasDestinations
}

export function resolveIntakeChannel(
  fixed: 'fax' | 'email' | null | undefined,
  selected: ManualIntakeChannelValue | null | undefined,
): IntakeChannelValue | null {
  return fixed ?? selected ?? null
}
