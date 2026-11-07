import { parsePaymentSchedule, type PaymentSchedule } from './payment-terms'

/**
 * 取引先ごとの運用設定（customers.channel_identifiers JSONB に保存。マイグレーション不要）。
 */

/**
 * 「納入先を指定しない取引先」か（承認時の納入先ゲートを飛ばす）。
 * 納入先マスタが複数あっても、この取引先は納入先なし（取引先あて）で承認してよい。
 */
export function skipsDestinationGate(channelIdentifiers: unknown): boolean {
  if (!channelIdentifiers || typeof channelIdentifiers !== 'object') return false
  return (channelIdentifiers as Record<string, unknown>).skip_destination_gate === true
}

/**
 * 取引先の支払条件（締め日・支払日）。channel_identifiers.payment_schedule に保存。
 * 未設定・不正値は「月末締め・翌月末払い」（lib/customers/payment-terms.ts）。
 */
export function paymentScheduleOf(channelIdentifiers: unknown): PaymentSchedule {
  if (!channelIdentifiers || typeof channelIdentifiers !== 'object') return parsePaymentSchedule(null)
  return parsePaymentSchedule((channelIdentifiers as Record<string, unknown>).payment_schedule)
}

/** 支払条件が保存済みか（未設定なら既定で判定していることを画面で示すため） */
export function hasPaymentSchedule(channelIdentifiers: unknown): boolean {
  if (!channelIdentifiers || typeof channelIdentifiers !== 'object') return false
  const v = (channelIdentifiers as Record<string, unknown>).payment_schedule
  return !!v && typeof v === 'object' && !Array.isArray(v)
}
