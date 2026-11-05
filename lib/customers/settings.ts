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
