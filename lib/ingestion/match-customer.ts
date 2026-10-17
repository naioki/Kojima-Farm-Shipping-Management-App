/**
 * メール受信の取引先マッチング（汎用・マスタ駆動）。
 *
 * customers.channel_identifiers（JSONB）だけで判定し、特定の取引先名・アドレスを
 * コードに直書きしない。新しい取引先はマスタ登録だけで自動マッチする。
 *   { "email": ["order@x.co.jp"], "subject_keywords": ["ヨーク"] }
 *
 * 優先順位:
 *   1. 送信元アドレス完全一致（最も確実）
 *   2. 件名キーワード（転送メール運用: 社長が "7/3ヨーク" 等の件名で転送してくるケース。
 *      送信元が自社アドレスになるため件名でしか判別できない）
 * 複数の取引先に一致した場合は誤紐付けを避けて null（未紐付け→人間確認）。
 */

export interface CustomerIdentifiers {
  id: string
  channelIdentifiers: {
    email?: string[]
    subject_keywords?: string[]
  } | null
}

export function matchEmailCustomer(
  from: string | null | undefined,
  subject: string | null | undefined,
  customers: CustomerIdentifiers[],
): string | null {
  const fromLower = (from ?? '').trim().toLowerCase()

  if (fromLower) {
    const byEmail = customers.filter((c) =>
      (c.channelIdentifiers?.email ?? []).some((e) => e.trim().toLowerCase() === fromLower),
    )
    if (byEmail.length === 1) return byEmail[0]!.id
    if (byEmail.length > 1) return null // 同一アドレスが複数取引先に登録=設定ミス。誤紐付けしない
  }

  const subj = (subject ?? '').trim()
  if (subj) {
    const byKeyword = customers.filter((c) =>
      (c.channelIdentifiers?.subject_keywords ?? []).some((k) => k.trim() && subj.includes(k.trim())),
    )
    if (byKeyword.length === 1) return byKeyword[0]!.id
  }

  return null
}
