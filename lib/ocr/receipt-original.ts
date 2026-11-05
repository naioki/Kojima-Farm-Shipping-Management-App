import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { getReceiptOriginal } from '@/lib/r2'

export interface ReceiptAttachment {
  base64: string
  mimeType: string
  fileName: string
}

/**
 * 受信（order_receipts）の原本を取り出す（受信ボックスの「読み取る」→ 注文の受付で AI 読み取り）。
 * raw_payload.file_base64（解析完了までの一時保持）を優先し、無ければ保存先（r2_key）から取得する。
 * 取得できなければ attachment は null（画面で手動添付してもらう）。失敗は握りつぶさずログに残す。
 */
export async function loadReceiptAttachment(
  receiptId: string,
): Promise<{ attachment: ReceiptAttachment | null; channel: 'fax' | 'email' | null }> {
  const admin = createAdminClient()
  const { data: receipt, error } = await admin
    .from('order_receipts')
    .select('r2_key, raw_payload, channel')
    .eq('id', receiptId)
    .maybeSingle()
  if (error) console.error('[receipt-original] 受信の取得に失敗:', error.message)
  if (!receipt) return { attachment: null, channel: null }

  const channel = receipt.channel === 'fax' || receipt.channel === 'email' ? receipt.channel : null
  const payload = (receipt.raw_payload ?? {}) as Record<string, unknown>
  const fileName =
    (typeof payload['filename'] === 'string' && payload['filename']) || receipt.r2_key?.split('/').pop() || 'receipt.pdf'
  const mimeType =
    (typeof payload['content_type'] === 'string' && payload['content_type']) ||
    (fileName.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg')

  if (typeof payload['file_base64'] === 'string' && payload['file_base64']) {
    return { attachment: { base64: payload['file_base64'], mimeType, fileName }, channel }
  }
  if (receipt.r2_key) {
    try {
      const buf = await getReceiptOriginal(receipt.r2_key)
      return { attachment: { base64: buf.toString('base64'), mimeType, fileName }, channel }
    } catch (e) {
      console.error('[receipt-original] 原本の取得に失敗:', e instanceof Error ? e.message : e)
    }
  }
  return { attachment: null, channel }
}
