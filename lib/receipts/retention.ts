import type { SupabaseClient } from '@supabase/supabase-js'

export interface PurgeResult {
  checkedCount: number
  purgedCount: number
  thresholdDate: string
}

/**
 * 7日（1週間）以上経過した order_receipts の raw_payload.file_base64 を一括削除し、
 * Supabase DB容量を自動解放する（塵も積もれば山となるのを自律防止）。
 *
 * ※ テキスト本文、伝票番号、AI解析明細、注文履歴は100%温存し、容量の大きいPDFバイナリ（file_base64）のみを安全に消去する。
 */
export async function purgeOldReceiptBase64(
  admin: SupabaseClient,
  retentionDays = 7,
): Promise<PurgeResult> {
  const thresholdMs = Date.now() - retentionDays * 24 * 3600_000
  const thresholdDate = new Date(thresholdMs).toISOString()

  try {
    // 7日以上前のデータで、file_base64 が存在するレコードを検索
    const { data: oldReceipts, error } = await admin
      .from('order_receipts')
      .select('id, raw_payload')
      .or(`received_at.lt.${thresholdDate},and(received_at.is.null,created_at.lt.${thresholdDate})`)
      .not('raw_payload->file_base64', 'is', null)
      .limit(100)

    if (error || !oldReceipts || oldReceipts.length === 0) {
      return { checkedCount: 0, purgedCount: 0, thresholdDate }
    }

    let purgedCount = 0
    for (const r of oldReceipts) {
      const p = (r.raw_payload ?? {}) as Record<string, unknown>
      if (p['file_base64'] !== undefined) {
        delete p['file_base64']
        const { error: upErr } = await admin
          .from('order_receipts')
          .update({ raw_payload: p })
          .eq('id', r.id)
        if (!upErr) {
          purgedCount++
        }
      }
    }

    return {
      checkedCount: oldReceipts.length,
      purgedCount,
      thresholdDate,
    }
  } catch (err) {
    console.error('[purgeOldReceiptBase64] エラー:', err)
    return { checkedCount: 0, purgedCount: 0, thresholdDate }
  }
}
