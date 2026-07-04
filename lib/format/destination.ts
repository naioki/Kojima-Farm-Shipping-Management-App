/**
 * 帳票（出荷表・出荷ラベル・出荷一覧表）向けの供給先表示名。
 *
 * ドメインルール「表示は常に『取引先 ＞ 納入先』」の紙面表記版。
 * 画面のバッジ表示（＞区切り）と違い、紙では離れた場所から一目で読める
 * 「ヨーク 東道野辺」形式（スペース区切り）にする。納入先が無い取引先
 * （例: 寺崎）は取引先名のみ。v4 の destination.py と同一の意味論であり、
 * 統合（フェーズ2）後も帳票の供給先は必ずこの関数で解決する。
 */
export function formatSupplyDestination(
  customerName: string | null | undefined,
  destinationName?: string | null,
): string {
  const customer = (customerName ?? '').trim()
  const destination = (destinationName ?? '').trim()
  if (!customer) return destination
  if (!destination || destination === customer) return customer
  return `${customer} ${destination}`
}
