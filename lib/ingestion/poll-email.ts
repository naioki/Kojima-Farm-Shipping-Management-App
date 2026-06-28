import 'server-only'
import crypto from 'node:crypto'
import tls from 'node:tls'
import readline from 'node:readline'
import { simpleParser, type ParsedMail, type Attachment } from 'mailparser'
import { createAdminClient } from '@/lib/supabase/admin'
import { looksLikeOrder, parseFaxFilename } from '@/lib/config/ingestion'
import { getSetting } from '@/lib/settings'
import { buildSenderDateKey, decideReceiptDisposition } from '@/lib/receipts/dedupe'
import { canRunGeminiNow } from '@/lib/gemini/quota'
import { putReceiptOriginal } from '@/lib/r2'
import { processReceipt } from '@/lib/ingestion/process-receipt'

const MAX_PROCESS_PER_POLL = 3
const FAX_MIME = /^(application\/pdf|image\/(jpeg|jpg|png|tiff))$/i

export interface PollEmailResult {
  processed: number
  analyzed: number
  analyzeResults: Array<{ receiptId: string; status: string }>
  error?: string
}

// ---------------------------------------------------------------------------
// 最小 POP3 クライアント（Node.js 組み込み tls + readline のみ使用）
// ---------------------------------------------------------------------------

interface Pop3Conn {
  readLine: () => Promise<string>
  write: (cmd: string) => void
  destroy: () => void
}

function pop3Connect(host: string, port: number, timeoutMs: number): Promise<Pop3Conn> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { sock.destroy(); reject(new Error('POP3 接続タイムアウト')) }, timeoutMs)
    const sock = tls.connect({ host, port, rejectUnauthorized: true })
    sock.on('error', (e) => { clearTimeout(timer); reject(e) })
    sock.on('secureConnect', () => {
      const lines: string[] = []
      const waiters: Array<(s: string) => void> = []
      const rl = readline.createInterface({ input: sock, crlfDelay: Infinity })
      rl.on('line', (line) => {
        if (waiters.length > 0) waiters.shift()!(line)
        else lines.push(line)
      })
      const readLine = (): Promise<string> =>
        lines.length > 0 ? Promise.resolve(lines.shift()!) : new Promise((r) => waiters.push(r))
      clearTimeout(timer)
      resolve({ readLine, write: (cmd) => sock.write(cmd + '\r\n'), destroy: () => sock.destroy() })
    })
  })
}

async function pop3Cmd(conn: Pop3Conn, cmd: string): Promise<string> {
  conn.write(cmd)
  const line = await conn.readLine()
  if (!line.startsWith('+OK')) throw new Error(`POP3 エラー: ${line}`)
  return line
}

async function pop3MultiLine(conn: Pop3Conn): Promise<string[]> {
  const lines: string[] = []
  while (true) {
    const line = await conn.readLine()
    if (line === '.') break
    lines.push(line.startsWith('..') ? line.slice(1) : line)
  }
  return lines
}

async function pop3Retrieve(conn: Pop3Conn, num: number): Promise<Buffer> {
  await pop3Cmd(conn, `RETR ${num}`)
  const lines = await pop3MultiLine(conn)
  return Buffer.from(lines.join('\r\n'))
}

// ---------------------------------------------------------------------------
// メイン取込ロジック
// ---------------------------------------------------------------------------

export async function pollEmailOnce(): Promise<PollEmailResult> {
  // IMAP_HOST → POP3ホストを自動導出（imap.xxx → pop.xxx）
  const [imapHost, user, pass] = await Promise.all([
    getSetting('IMAP_HOST'),
    getSetting('IMAP_USER'),
    getSetting('IMAP_PASSWORD'),
  ])
  if (!imapHost || !user || !pass) {
    return { processed: 0, analyzed: 0, analyzeResults: [], error: 'メール認証情報未設定（IMAP_HOST/USER/PASSWORD）' }
  }
  const popHost = imapHost.replace(/^imap\./, 'pop.')

  const supabase = createAdminClient()

  let conn: Pop3Conn | null = null
  let processed = 0
  const pendingReceiptIds: string[] = []
  const toDelete: number[] = []

  try {
    conn = await pop3Connect(popHost, 995, 20000)
    await pop3Cmd(conn, `USER ${user}`)
    await pop3Cmd(conn, `PASS ${pass}`)

    const stat = await pop3Cmd(conn, 'STAT')
    const total = parseInt(stat.split(' ')[1] ?? '0', 10)

    for (let num = 1; num <= total; num++) {
      const raw = await pop3Retrieve(conn, num)
      const parsed = await simpleParser(raw)
      const messageId = (parsed.messageId ?? `pop3-${num}-${Date.now()}`)
      const date = parsed.date ?? new Date()
      const faxAttachments = (parsed.attachments ?? []).filter((a) => FAX_MIME.test(a.contentType))

      let allOk = true

      if (faxAttachments.length > 0) {
        for (let i = 0; i < faxAttachments.length; i++) {
          const r = await ingestFaxAttachment(supabase, faxAttachments[i]!, parsed, messageId, i, date)
          if (r.ok) processed++
          else allOk = false
          if (r.receiptId) pendingReceiptIds.push(r.receiptId)
        }
      } else {
        const r = await ingestTextEmail(supabase, parsed, messageId, date)
        if (r.ok) processed++
        else allOk = false
        if (r.receiptId) pendingReceiptIds.push(r.receiptId)
      }

      // 全パート正常時のみ削除マーク（POP3ではDELEがIMAPの\Flaggedに相当）
      if (allOk) toDelete.push(num)
    }

    // DELE は QUIT 前にまとめて送る
    for (const num of toDelete) {
      try { await pop3Cmd(conn, `DELE ${num}`) } catch { /* 失敗しても続行 */ }
    }
    await pop3Cmd(conn, 'QUIT')
  } catch (e) {
    conn?.destroy()
    const msg = e instanceof Error ? e.message : String(e)
    return { processed, analyzed: 0, analyzeResults: [], error: msg }
  }

  // Gemini 解析
  const { allowed } = await canRunGeminiNow('P2')
  const analyzeResults: Array<{ receiptId: string; status: string }> = []

  if (allowed) {
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

type IngestOutcome = { ok: boolean; receiptId: string | null }

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

  const storageKey = `receipts/fax/${exactHash}-${att.filename ?? 'fax'}`
  await putReceiptOriginal(storageKey, bytes, att.contentType || 'application/octet-stream')

  const status = disposition === 'duplicate' ? 'duplicate' : 'pending_ai'

  const { data: newReceipt, error } = await supabase
    .from('order_receipts')
    .insert({
      channel: 'fax',
      message_id: `${messageId}#${index}`,
      received_at: date.toISOString(),
      exact_hash: exactHash,
      sender_date_key: senderDateKey,
      r2_key: storageKey,
      is_revision: disposition === 'revision',
      status,
    })
    .select('id')
    .maybeSingle()

  if (error) {
    if (error.code === '23505') return { ok: true, receiptId: null }
    return { ok: false, receiptId: null }
  }

  return { ok: true, receiptId: status === 'pending_ai' ? (newReceipt?.id ?? null) : null }
}

async function ingestTextEmail(
  supabase: AdminClient,
  parsed: ParsedMail,
  messageId: string,
  date: Date,
): Promise<IngestOutcome> {
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
    if (error.code === '23505') return { ok: true, receiptId: null }
    return { ok: false, receiptId: null }
  }

  return { ok: true, receiptId: isOrder ? (newReceipt?.id ?? null) : null }
}
