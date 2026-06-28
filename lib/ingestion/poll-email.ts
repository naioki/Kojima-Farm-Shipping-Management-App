import 'server-only'
import crypto from 'node:crypto'
import { ImapFlow } from 'imapflow'
import { simpleParser, type ParsedMail, type Attachment } from 'mailparser'
import { createAdminClient } from '@/lib/supabase/admin'
import { looksLikeOrder, parseFaxFilename } from '@/lib/config/ingestion'
import { getSetting } from '@/lib/settings'
import { buildSenderDateKey, decideReceiptDisposition } from '@/lib/receipts/dedupe'
import { canRunGeminiNow } from '@/lib/gemini/quota'
import { putReceiptOriginal } from '@/lib/r2'
import { processReceipt } from '@/lib/ingestion/process-receipt'

/** 1回の取込で解析まで行う最大件数。タイムアウト対策。 */
const MAX_PROCESS_PER_POLL = 3

/** FAX原本として扱う添付の MIME。これ以外（テキスト等）の添付は無視する。 */
const FAX_MIME = /^(application\/pdf|image\/(jpeg|jpg|png|tiff))$/i

export interface PollEmailResult {
  processed: number
  analyzed: number
  analyzeResults: Array<{ receiptId: string; status: string }>
  error?: string
}

/**
 * 専用メールボックスを1回スキャンして取り込む（features.md §2-2 / FAX→メール独立運用）。
 * Cloud Scheduler(cron) と 管理画面の手動ボタン の両方から呼ばれる共通処理。
 *
 * 自作FAXソフトは「受信したPDFをこのメールボックスへ送る」だけ（出荷アプリを一切知らない＝疎結合）。
 * メールボックス自体が緩衝材になるので、アプリが落ちていてもメールは溜まって待つ。
 *
 *  - 添付（PDF/画像）あり → FAXチャネルとして処理（exact_hash重複・R2保存・再送判定 → OCR）
 *  - 添付なし（本文のみ）  → 従来のメール注文として処理（テキスト解析）
 *  - 重複判定: Message-ID（取り込み済み判定）＋ exact_hash（同一ファイル）＋ sender_date_key（同日再送）
 *  - 処理済みは \Flagged を付け、次回は未フラグのみ取得＝再ダウンロードしない
 */
export async function pollEmailOnce(): Promise<PollEmailResult> {
  const [host, user, pass] = await Promise.all([
    getSetting('IMAP_HOST'),
    getSetting('IMAP_USER'),
    getSetting('IMAP_PASSWORD'),
  ])
  if (!host || !user || !pass) {
    return { processed: 0, analyzed: 0, analyzeResults: [], error: 'IMAP 認証情報未設定' }
  }

  const supabase = createAdminClient()
  const imap = new ImapFlow({ host, port: 993, secure: true, auth: { user, pass }, logger: false })
  await imap.connect()

  let processed = 0
  const pendingReceiptIds: string[] = []

  try {
    const lock = await imap.getMailboxLock('INBOX')
    try {
      // 未フラグ（未処理）のみ取得。処理済みは \Flagged 済みなので再ダウンロードしない＝軽い。
      for await (const msg of imap.fetch({ flagged: false }, { source: true, envelope: true })) {
        const messageId = msg.envelope?.messageId
        if (!messageId) continue

        const parsed = await simpleParser(msg.source as Buffer)
        const date = parsed.date ?? new Date()
        const faxAttachments = (parsed.attachments ?? []).filter((a) => FAX_MIME.test(a.contentType))

        // このメールの全パートが正常に処理できたか。1つでも一時障害なら旗を付けず次回リトライ。
        let allOk = true

        if (faxAttachments.length > 0) {
          // FAX 経路：添付の各PDF/画像を独立した receipt として取り込む
          for (let i = 0; i < faxAttachments.length; i++) {
            const r = await ingestFaxAttachment(
              supabase,
              faxAttachments[i]!,
              parsed,
              messageId,
              i,
              date,
            )
            if (r.ok) processed++
            else allOk = false
            if (r.receiptId) pendingReceiptIds.push(r.receiptId)
          }
        } else {
          // テキスト経路：本文のみのメール注文（従来挙動）
          const r = await ingestTextEmail(supabase, parsed, messageId, date)
          if (r.ok) processed++
          else allOk = false
          if (r.receiptId) pendingReceiptIds.push(r.receiptId)
        }

        // 全パート正常時のみ処理済みフラグ。insert が一時障害で失敗したメールは
        // 旗を付けずに残し、次回の取込で再取得＝注文の取りこぼしを防ぐ。
        if (allOk) {
          try {
            await imap.messageFlagsAdd(msg.seq, ['\\Flagged'])
          } catch {
            // フラグ失敗は致命的ではない（重複判定が主防御）
          }
        }
      }
    } finally {
      lock.release()
    }
  } finally {
    await imap.logout()
  }

  // pending_ai を quota ゲート経由で解析（最大 MAX_PROCESS_PER_POLL 件）
  const { allowed } = await canRunGeminiNow('P2')
  const analyzeResults: Array<{ receiptId: string; status: string }> = []

  if (allowed) {
    // G10: next_retry_at が到来した ai_failed を追加で拾う
    const { data: retryRows } = await supabase
      .from('order_receipts')
      .select('id')
      .eq('status', 'ai_failed')
      .lte('next_retry_at', new Date().toISOString())
      .lt('retry_count', 3)
      .limit(MAX_PROCESS_PER_POLL)

    const retryIds = (retryRows ?? []).map((r) => r.id as string)
    if (retryIds.length > 0) {
      await supabase.from('order_receipts').update({ status: 'pending_ai' }).in('id', retryIds)
    }

    const ids = [...pendingReceiptIds, ...retryIds].slice(0, MAX_PROCESS_PER_POLL)
    for (const rid of ids) {
      const res = await processReceipt(rid).catch(() => ({
        receiptId: rid,
        status: 'ai_failed' as const,
        orderCount: 0,
      }))
      analyzeResults.push({ receiptId: rid, status: res.status })
    }
  }

  return { processed, analyzed: analyzeResults.length, analyzeResults }
}

type AdminClient = ReturnType<typeof createAdminClient>

/**
 * メールに含まれる FAX 番号を取り出す。
 * 優先順: X-Fax-Number ヘッダ → 件名中の数字列 → 添付ファイル名（番号_YYYYMMDD）。
 * 自作FAXソフトが番号をどこに入れても拾えるよう多段で探す。無ければ null。
 */
async function extractFaxNumber(parsed: ParsedMail, att: Attachment): Promise<string | null> {
  const header = parsed.headers.get('x-fax-number')
  if (typeof header === 'string' && header.trim()) return header.trim()

  const subj = parsed.subject ?? ''
  const subjMatch = subj.match(/(\d{6,11})/)
  if (subjMatch) return subjMatch[1]!

  if (att.filename) {
    const fromName = await parseFaxFilename(att.filename)
    if (fromName) return fromName.faxNumber
  }
  return null
}

/**
 * 取り込み結果。
 * - ok=true  : 正常に処理できた（新規・重複・注文以外いずれも）。\Flagged を付けてよい。
 * - ok=false : 一時障害（DB insert 失敗など）。旗を付けず次回の取込でリトライさせる。
 * - receiptId: 解析対象（pending_ai）の receipt id。なければ null。
 */
type IngestOutcome = { ok: boolean; receiptId: string | null }

/** 添付（PDF/画像）を FAX チャネルの receipt として取り込む。 */
async function ingestFaxAttachment(
  supabase: AdminClient,
  att: Attachment,
  parsed: ParsedMail,
  messageId: string,
  index: number,
  date: Date,
): Promise<IngestOutcome> {
  const bytes = att.content as Buffer
  const exactHash = crypto.createHash('md5').update(bytes).digest('hex')

  // 同一ファイルの取り込み済み判定（DB一意制約 uq_receipt_exact がバックストップ）
  const { data: existingExact } = await supabase
    .from('order_receipts')
    .select('id')
    .eq('exact_hash', exactHash)
    .maybeSingle()

  const faxNumber = await extractFaxNumber(parsed, att)
  const senderDateKey = buildSenderDateKey('fax', faxNumber, date)

  const { data: existingRevision } = senderDateKey
    ? await supabase
        .from('order_receipts')
        .select('id')
        .eq('sender_date_key', senderDateKey)
        .limit(1)
        .maybeSingle()
    : { data: null }

  const disposition = decideReceiptDisposition({
    exactHashMatch: Boolean(existingExact),
    senderDateKeyMatch: Boolean(existingRevision),
  })

  // R2 へ原本保存（重複でも証跡として残す・7年保存 tax.md）
  const r2Key = `receipts/fax/${exactHash}-${att.filename ?? 'fax'}`
  await putReceiptOriginal(r2Key, bytes, att.contentType || 'application/octet-stream')

  const status = disposition === 'duplicate' ? 'duplicate' : 'pending_ai'

  // 1メールに複数添付があっても Message-ID 一意制約に当たらないよう連番を付ける
  const { data: newReceipt, error } = await supabase
    .from('order_receipts')
    .insert({
      channel: 'fax',
      message_id: `${messageId}#${index}`,
      received_at: date.toISOString(),
      exact_hash: exactHash,
      sender_date_key: senderDateKey,
      r2_key: r2Key,
      is_revision: disposition === 'revision',
      status,
    })
    .select('id')
    .maybeSingle()

  if (error) {
    // 一意制約違反（23505）＝すでに同じ受信が登録済み＝重複。処理済み扱いでよい（旗OK）。
    if (error.code === '23505') return { ok: true, receiptId: null }
    // それ以外は一時障害の可能性 → 旗を付けず次回リトライ（注文の取りこぼし防止）。
    return { ok: false, receiptId: null }
  }

  return { ok: true, receiptId: status === 'pending_ai' ? (newReceipt?.id ?? null) : null }
}

/** 本文のみのメール（添付なし）を従来どおりメール注文として取り込む。 */
async function ingestTextEmail(
  supabase: AdminClient,
  parsed: ParsedMail,
  messageId: string,
  date: Date,
): Promise<IngestOutcome> {
  // 既に取り込み済みなら何もしない（再フェッチ時の二重登録防止）。処理済み扱い（旗OK）。
  const { data: seen } = await supabase
    .from('order_receipts')
    .select('id')
    .eq('message_id', messageId)
    .maybeSingle()
  if (seen) return { ok: true, receiptId: null }

  const text = parsed.text ?? parsed.html?.toString() ?? ''
  const from = parsed.from?.value?.[0]?.address ?? null
  const isOrder = await looksLikeOrder(`${parsed.subject ?? ''}\n${text}`)
  const senderDateKey = buildSenderDateKey('email', from, date)

  const { data: newReceipt, error } = await supabase
    .from('order_receipts')
    .insert({
      channel: 'email',
      message_id: messageId,
      sender_date_key: senderDateKey,
      received_at: date.toISOString(),
      raw_payload: { subject: parsed.subject, from, text },
      status: isOrder ? 'pending_ai' : 'unmatched',
    })
    .select('id')
    .maybeSingle()

  if (error) {
    // 一意制約違反（23505）＝同じメールが既に登録済み（並行取込のレース）。処理済み扱い（旗OK）。
    if (error.code === '23505') return { ok: true, receiptId: null }
    // それ以外は一時障害 → 旗を付けず次回リトライ。
    return { ok: false, receiptId: null }
  }

  return { ok: true, receiptId: isOrder ? (newReceipt?.id ?? null) : null }
}
