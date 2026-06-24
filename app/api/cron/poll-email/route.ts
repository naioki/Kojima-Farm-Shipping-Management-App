import { NextResponse } from 'next/server'
import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyCronRequest, looksLikeOrder } from '@/lib/config/ingestion'
import { getSetting } from '@/lib/settings'
import { buildSenderDateKey } from '@/lib/receipts/dedupe'
import { canRunGeminiNow } from '@/lib/gemini/quota'
import { processReceipt } from '@/lib/ingestion/process-receipt'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * メール 5分毎ポーリング（features.md §2-2）。
 *  - 重複判定は Message-ID のみ（既読フラグに依存しない＝取り込み漏れ防止・失敗#2）
 *  - 本文 text/plain 優先。注文語を含むものを優先、それ以外は status='unmatched'
 *  - 処理後 "processed" ラベル付与（ダブルチェック）
 */
export async function GET(req: Request) {
  if (!(await verifyCronRequest(req.headers))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const [host, user, pass] = await Promise.all([
    getSetting('IMAP_HOST'),
    getSetting('IMAP_USER'),
    getSetting('IMAP_PASSWORD'),
  ])
  if (!host || !user || !pass) {
    return NextResponse.json({ error: 'IMAP 認証情報未設定' }, { status: 500 })
  }

  const supabase = createAdminClient()
  const imap = new ImapFlow({ host, port: 993, secure: true, auth: { user, pass }, logger: false })
  await imap.connect()
  let processed = 0
  const pendingReceiptIds: (string | null)[] = []

  try {
    const lock = await imap.getMailboxLock('INBOX')
    try {
      // 未処理（"processed" ラベルが無い）メールを走査。既読/未読は条件に使わない。
      for await (const msg of imap.fetch({ all: true }, { source: true, envelope: true })) {
        const messageId = msg.envelope?.messageId
        if (!messageId) continue

        // Message-ID で処理済み判定（DB一意制約 uq_receipt_msgid がバックストップ）
        const { data: seen } = await supabase
          .from('order_receipts')
          .select('id')
          .eq('message_id', messageId)
          .maybeSingle()
        if (seen) continue

        const parsedMail = await simpleParser(msg.source as Buffer)
        const text = parsedMail.text ?? parsedMail.html?.toString() ?? ''
        const from = parsedMail.from?.value?.[0]?.address ?? null
        const isOrder = await looksLikeOrder(`${parsedMail.subject ?? ''}\n${text}`)
        const senderDateKey = buildSenderDateKey('email', from, parsedMail.date ?? new Date())

        const { data: newReceipt } = await supabase
          .from('order_receipts')
          .insert({
            channel: 'email',
            message_id: messageId,
            sender_date_key: senderDateKey,
            received_at: (parsedMail.date ?? new Date()).toISOString(),
            raw_payload: { subject: parsedMail.subject, from, text },
            status: isOrder ? 'pending_ai' : 'unmatched',
          })
          .select('id')
          .maybeSingle()

        // 処理済みラベル付与（ダブルチェック）
        try {
          await imap.messageFlagsAdd(msg.seq, ['\\Flagged'])
        } catch {
          // ラベル付与失敗は致命的ではない（Message-ID 判定が主）
        }
        processed++
        pendingReceiptIds.push(newReceipt?.id ?? null)
      }
    } finally {
      lock.release()
    }
  } finally {
    await imap.logout()
  }

  // pending_ai のテキストメールを quota ゲート経由で解析（最大3件）
  const { allowed } = await canRunGeminiNow('P2')
  const analyzeResults: Array<{ receiptId: string; status: string }> = []

  if (allowed) {
    const ids = pendingReceiptIds.filter(Boolean).slice(0, 3) as string[]
    for (const rid of ids) {
      const res = await processReceipt(rid).catch(() => ({
        receiptId: rid,
        status: 'ai_failed',
        orderCount: 0,
      }))
      analyzeResults.push({ receiptId: rid, status: res.status })
    }
  }

  return NextResponse.json({ processed, analyzed: analyzeResults.length, analyzeResults })
}
