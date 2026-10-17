import 'server-only'
import crypto from 'node:crypto'
import { google } from 'googleapis'
import { createAdminClient } from '@/lib/supabase/admin'
import { putReceiptOriginal } from '@/lib/r2'
import { parseFaxFilename, getDriveFolderId } from '@/lib/config/ingestion'
import { getSetting } from '@/lib/settings'
import { buildSenderDateKey, decideReceiptDisposition } from '@/lib/receipts/dedupe'
import { canRunGeminiNow } from '@/lib/gemini/quota'
import { processReceipt } from '@/lib/ingestion/process-receipt'

/** 1回の取込で解析まで行う最大ファイル数。タイムアウト対策。 */
const MAX_PROCESS_PER_POLL = 3

export interface PollDriveResult {
  processed: number
  results: Array<{ file: string; disposition: string; receiptId: string | null }>
  analyzed: number
  analyzeResults: Array<{ receiptId: string; status: string; error?: string }>
  error?: string
}

/**
 * Drive フォルダを1回スキャンして取り込む（features.md §2-1）。
 * Cloud Scheduler(cron) と 管理画面の手動ボタン の両方から呼ばれる共通処理。
 *  1. 指定フォルダの新着ファイル取得
 *  2. 原本を R2 保存（7年・tax.md）
 *  3. exact_hash で重複判定 → order_receipts INSERT
 *  4. ファイル名から sender_date_key 抽出（失敗→ status='unmatched'）
 *  5. 重複・再送判定（§3）。再送は差分モードのフラグを立てる
 *  6. pending_ai を quota ゲート経由で最大 MAX_PROCESS_PER_POLL 件まで解析
 *
 * exact_hash 重複判定により、同じファイルが残っていても二重取込みしない＝何度押しても安全。
 */
export async function pollDriveOnce(): Promise<PollDriveResult> {
  const folderId = await getDriveFolderId()
  if (!folderId) {
    return { processed: 0, results: [], analyzed: 0, analyzeResults: [], error: 'DRIVE_FOLDER_ID 未設定' }
  }

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

  const results: Array<{ file: string; disposition: string; receiptId: string | null }> = []

  for (const f of list.data.files ?? []) {
    if (!f.id || !f.name) continue

    // 原本ダウンロード
    const dl = await drive.files.get({ fileId: f.id, alt: 'media' }, { responseType: 'arraybuffer' })
    const bytes = Buffer.from(dl.data as ArrayBuffer)
    const exactHash = crypto.createHash('md5').update(bytes).digest('hex')

    // 重複の事前チェック（DB一意制約 uq_receipt_exact がバックストップ）
    const { data: existingExact, error: existingExactErr } = await supabase
      .from('order_receipts')
      .select('id')
      .eq('exact_hash', exactHash)
      .maybeSingle()
    // 事前チェック失敗はDB一意制約(uq_receipt_exact)がバックストップ。無言にはしない。
    if (existingExactErr) console.error('[poll-drive] 完全重複の事前チェックに失敗:', existingExactErr.message)

    const parsed = await parseFaxFilename(f.name)
    const senderDateKey = parsed
      ? buildSenderDateKey('fax', parsed.faxNumber, new Date(f.createdTime ?? Date.now()))
      : null

    const { data: existingRevision, error: existingRevisionErr } = senderDateKey
      ? await supabase
          .from('order_receipts')
          .select('id')
          .eq('sender_date_key', senderDateKey)
          .limit(1)
          .maybeSingle()
      : { data: null, error: null }
    // 再送判定の失敗は新規扱いにフォールバック（重複はDB制約で弾く）。無言にはしない。
    if (existingRevisionErr) console.error('[poll-drive] 再送判定に失敗:', existingRevisionErr.message)

    const disposition = decideReceiptDisposition({
      exactHashMatch: Boolean(existingExact),
      senderDateKeyMatch: Boolean(existingRevision),
    })

    // R2 へ原本保存（重複でも証跡として残す）
    const r2Key = `receipts/fax/${exactHash}-${f.name}`
    await putReceiptOriginal(r2Key, bytes, f.mimeType ?? 'application/octet-stream')

    const status = disposition === 'duplicate' ? 'duplicate' : parsed ? 'pending_ai' : 'unmatched'

    const { data: newReceipt, error: newReceiptErr } = await supabase
      .from('order_receipts')
      .insert({
        channel: 'fax',
        received_at: f.createdTime ?? new Date().toISOString(),
        exact_hash: exactHash,
        sender_date_key: senderDateKey,
        r2_key: r2Key,
        is_revision: disposition === 'revision',
        status,
      })
      .select('id')
      .maybeSingle()
    // 受信レコードのINSERT失敗は取り込み漏れに直結する。無言にはしない（uq制約による重複弾きは想定内）。
    if (newReceiptErr) console.error(`[poll-drive] 受信レコードのINSERTに失敗（${f.name}）:`, newReceiptErr.message)

    results.push({
      file: f.name,
      disposition,
      receiptId: status === 'pending_ai' ? (newReceipt?.id ?? null) : null,
    })
  }

  // pending_ai のレシートを quota ゲート経由で解析（最大 MAX_PROCESS_PER_POLL 件）
  const { allowed } = await canRunGeminiNow('P2')
  const analyzeResults: Array<{ receiptId: string; status: string; error?: string }> = []

  if (allowed) {
    // 今回の新着
    const newIds = results.filter((r) => r.receiptId).map((r) => r.receiptId!)

    // G10: next_retry_at が到来した ai_failed を追加で拾う
    const { data: retryRows, error: retryRowsErr } = await supabase
      .from('order_receipts')
      .select('id')
      .eq('status', 'ai_failed')
      .lte('next_retry_at', new Date().toISOString())
      .lt('retry_count', 3)
      .limit(MAX_PROCESS_PER_POLL)
    // 再試行対象の取得失敗は今回分のみで続行。無言にはしない。
    if (retryRowsErr) console.error('[poll-drive] 再試行対象の取得に失敗:', retryRowsErr.message)

    // 再試行前に status を pending_ai に戻す（processReceipt が pending_ai しか処理しない）
    const retryIds = (retryRows ?? []).map((r) => r.id as string)
    if (retryIds.length > 0) {
      await supabase.from('order_receipts').update({ status: 'pending_ai' }).in('id', retryIds)
    }

    const allIds = [...newIds, ...retryIds].slice(0, MAX_PROCESS_PER_POLL)

    for (const rid of allIds) {
      const res = await processReceipt(rid).catch((e: unknown) => ({
        receiptId: rid,
        status: 'ai_failed' as const,
        orderCount: 0,
        error: String(e),
      }))
      analyzeResults.push({ receiptId: rid, status: res.status, error: res.error })
    }
  }

  return { processed: results.length, results, analyzed: analyzeResults.length, analyzeResults }
}

/**
 * Drive 認証。設定（GOOGLE_SERVICE_ACCOUNT_JSON）があればそれを使い、
 * 無ければ Cloud Run のサービスアカウント（ADC）にフォールバックする。
 * GoogleAuth インスタンスをそのまま google.drive({auth}) に渡す（googleapis 推奨の型）。
 */
async function driveAuth() {
  const scopes = ['https://www.googleapis.com/auth/drive.readonly']
  const saJson = await getSetting('GOOGLE_SERVICE_ACCOUNT_JSON')
  if (saJson) {
    try {
      return new google.auth.GoogleAuth({ credentials: JSON.parse(saJson), scopes })
    } catch {
      // 不正な JSON は ADC にフォールバック
    }
  }
  return new google.auth.GoogleAuth({ scopes })
}
