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

export function resolveIntakeChannel(
  fixed: 'fax' | 'email' | null | undefined,
  selected: ManualIntakeChannelValue | null | undefined,
): IntakeChannelValue | null {
  return fixed ?? selected ?? null
}
