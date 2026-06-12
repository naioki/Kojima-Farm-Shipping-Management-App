import { NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { google } from 'googleapis'
import { createAdminClient } from '@/lib/supabase/admin'
import { putReceiptOriginal } from '@/lib/r2'
import { parseFaxFilename, verifyCronRequest } from '@/lib/config/ingestion'
import { buildSenderDateKey, decideReceiptDisposition } from '@/lib/receipts/dedupe'

// Cloud Run 上で重い処理も可（stack.md）。Node ランタイムを明示。
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Drive 5分毎ポーリング（features.md §2-1）。Cloud Scheduler(OIDC) が叩く。
 *  1. 指定フォルダの新着ファイル取得
 *  2. 原本を R2 保存（7年・tax.md）
 *  3. exact_hash で重複判定 → order_receipts INSERT
 *  4. ファイル名から sender_date_key 抽出（失敗→ status='unmatched'）
 *  5. 重複・再送判定（§3）。再送は差分モードのフラグを立てる
 */
export async function GET(req: Request) {
  if (!verifyCronRequest(req.headers)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const folderId = process.env.DRIVE_FOLDER_ID
  if (!folderId) return NextResponse.json({ error: 'DRIVE_FOLDER_ID 未設定' }, { status: 500 })

  const supabase = createAdminClient()
  const drive = google.drive({ version: 'v3', auth: await driveAuth() })

  // 前回ポーリング時刻（簡易にメタ保存。実運用は専用テーブル/設定に置く）
  const since = process.env.DRIVE_POLL_SINCE // ISO。未設定なら全件（初回）
  const q = [`'${folderId}' in parents`, 'trashed = false', since && `createdTime > '${since}'`]
    .filter(Boolean)
    .join(' and ')

  const list = await drive.files.list({
    q,
    fields: 'files(id, name, mimeType, createdTime)',
    orderBy: 'createdTime',
  })

  const results: Array<{ file: string; disposition: string }> = []

  for (const f of list.data.files ?? []) {
    if (!f.id || !f.name) continue

    // 原本ダウンロード
    const dl = await drive.files.get({ fileId: f.id, alt: 'media' }, { responseType: 'arraybuffer' })
    const bytes = Buffer.from(dl.data as ArrayBuffer)
    const exactHash = crypto.createHash('md5').update(bytes).digest('hex')

    // 重複の事前チェック（DB一意制約 uq_receipt_exact がバックストップ）
    const { data: existingExact } = await supabase
      .from('order_receipts')
      .select('id')
      .eq('exact_hash', exactHash)
      .maybeSingle()

    const parsed = parseFaxFilename(f.name)
    const senderDateKey = parsed
      ? buildSenderDateKey('fax', parsed.faxNumber, new Date(f.createdTime ?? Date.now()))
      : null

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

    // R2 へ原本保存（重複でも証跡として残す）
    const r2Key = `receipts/fax/${exactHash}-${f.name}`
    await putReceiptOriginal(r2Key, bytes, f.mimeType ?? 'application/octet-stream')

    const status =
      disposition === 'duplicate' ? 'duplicate' : parsed ? 'pending_ai' : 'unmatched'

    await supabase.from('order_receipts').insert({
      channel: 'fax',
      received_at: f.createdTime ?? new Date().toISOString(),
      exact_hash: exactHash,
      sender_date_key: senderDateKey,
      r2_key: r2Key,
      is_revision: disposition === 'revision',
      status,
    })

    results.push({ file: f.name, disposition })
    // TODO(Phase B): pending_ai のものを quota ゲート(canRunGemini)を見て解析キューへ。
  }

  return NextResponse.json({ processed: results.length, results })
}

/** Drive 認証。Cloud Run のサービスアカウント（ADC）またはサービスアカウントJSONを使用。 */
async function driveAuth() {
  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  })
  return auth.getClient()
}
