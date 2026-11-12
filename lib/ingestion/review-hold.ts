/**
 * 取り込み（lib/ingestion/process-receipt.ts）が「人の確認が要る」として要確認に残した受信票の印。
 *
 * 受信箱（lib/orders/inbox.ts）は、注文が承認済みなら受信票を自動で approved に片付ける。取り込みで一部の
 * 保存に失敗した受信票まで片付けると、要確認が開いただけで消えて誰も気づけない。そのため取り込み側が
 * raw_payload にこの印を立て、受信箱の自動同期は印のある受信票を対象から外す。
 * 印のある受信票は、人が受信箱の「却下」（/api/receipts/[id]/dismiss）で片付ける。
 *
 * 文言の部分一致ではなく、この明示の印で判定する。
 */
export const INGEST_REVIEW_HOLD_KEY = 'ingest_review_hold'

export function hasIngestReviewHold(rawPayload: unknown): boolean {
  if (!rawPayload || typeof rawPayload !== 'object' || Array.isArray(rawPayload)) return false
  return (rawPayload as Record<string, unknown>)[INGEST_REVIEW_HOLD_KEY] === true
}
