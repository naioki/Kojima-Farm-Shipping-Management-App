import 'server-only'
import crypto from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { parseFaxFilename } from '@/lib/config/ingestion'
import { getSetting } from '@/lib/settings'
import { buildSenderDateKey, decideReceiptDisposition } from '@/lib/receipts/dedupe'
import { analyzeOrders } from '@/lib/gemini/analyze'
import {
  buildPipelineSlipResult,
  processReceipt,
} from '@/lib/ingestion/process-receipt'

export const runtime = 'nodejs'
export const maxDuration = 120

function parseBool(val: unknown, defaultVal = false): boolean {
  if (val == null) return defaultVal
  if (typeof val === 'boolean') return val
  const s = String(val).trim().toLowerCase()
  if (s === '') return defaultVal
  return !['false', '0', 'no', 'off'].includes(s)
}

/**
 * GET /api/receipts (および /healthz, /api/receipts/healthz)
 * Kojima-FAX Ver 4.0 (`order_pipeline_service.py` の `check_health()`) からの疎通確認に対応。
 */
export async function GET() {
  return NextResponse.json({
    ok: true,
    status: 'OK',
    version: '4.1.0',
    env: process.env.NODE_ENV || 'production',
    sync_mode: 'SUPABASE_DIRECT',
    message: '小島農園 受発注DXシステム（Kojima-FAX Ver 4.0 直結・Google Drive原本参照モード）稼働中',
  })
}

/**
 * POST /api/receipts (および /orders/ingest, /api/orders/ingest, /api/receipts/orders/ingest)
 *
 * 【Kojima-FAX Ver 4.0 & ARCHITECTURE.md Ver 4.1 完全互換エンドポイント】
 * 農園の Linux FAXサーバー（LIFEBOOK `Kojima-FAX` の `order_pipeline_service.py`）または管理画面からの
 * ダイレクト注文投入を受け付ける。
 *
 * コア設計原則（Google Drive中継・クラウド二重保存の完全廃止）:
 * 1. FAX原本のPDF化とGoogle Driveへの保存は `Kojima-FAX` 側の `drive_backup.py`（OAuth認証）で完結している。
 * 2. 本エンドポイントは `Kojima-FAX` から送られる PDFバイナリ (`file`)、Google Drive原本URL (`source_file_url`)、
 *    発信元メタデータ (`sender_number`, `sender_name`, `text_content`, `fax_job_id`, `dry_run`) を受け取る。
 * 3. Cloud Run 側では Cloudflare R2 や Supabase Storage へのファイル再アップロードは一切行わず、
 *    PDFバイナリをオンメモリで直接 Gemini API に渡して構造化抽出し、DBには `source_file_url`（Google Drive URL）のみを記録する。
 * 4. 万一 Gemini API 側の一時障害（503等）で `ai_failed` になった場合でも管理画面の「再解析」ボタンが確実に動くよう、
 *    解析完了までの間のみ `raw_payload.file_base64` に一時保持し、解析成功時に自動削除する。
 */
export async function POST(req: NextRequest) {
  // 認証チェック:
  // 1) Kojima-FAX が送る X-Pipeline-Token / Authorization: Bearer / x-fax-token / x-api-key
  // 2) またはログイン中の社内ユーザー（admin/staff）セッション
  // 3) トークン未設定環境では Kojima-FAX からのLAN/クラウド直結POSTを受け付ける
  const configuredToken =
    (await getSetting('FAX_INGEST_TOKEN')) ||
    process.env.FAX_INGEST_TOKEN ||
    process.env.ORDER_PIPELINE_API_KEY ||
    process.env.PIPELINE_API_KEY ||
    (await getSetting('CRON_SECRET')) ||
    process.env.CRON_SECRET

  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim()
  const headerToken =
    req.headers.get('x-pipeline-token')?.trim() ||
    bearer ||
    req.headers.get('x-fax-token')?.trim() ||
    req.headers.get('x-api-key')?.trim() ||
    req.headers.get('x-cron-secret')?.trim()

  if (configuredToken && headerToken !== configuredToken) {
    const user = await getAuthedUser()
    if (!user) {
      return NextResponse.json(
        { detail: '認証トークン（X-Pipeline-Token / Authorization）またはログインが必要です', error: 'unauthorized' },
        { status: 401 },
      )
    }
    const supabase = createClient()
    const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).maybeSingle()
    if (profile?.role !== 'admin' && profile?.role !== 'staff') {
      return NextResponse.json({ detail: '権限がありません', error: 'forbidden' }, { status: 403 })
    }
  }

  let bytes: Buffer | null = null
  let fileName = 'fax_receipt.pdf'
  let contentType = 'application/pdf'
  let sourceChannel = 'FAX'
  let sourceFileUrl = ''
  let textContent = ''
  let senderNumber = ''
  let senderName = ''
  let faxJobId = ''
  let dryRun = false

  try {
    const reqContentType = req.headers.get('content-type') ?? ''
    if (reqContentType.includes('multipart/form-data')) {
      const form = await req.formData()
      const fileCandidate =
        form.get('file') ?? form.get('fax') ?? form.get('document') ?? form.get('pdf') ?? form.get('image')

      if (fileCandidate instanceof File && fileCandidate.size > 0) {
        bytes = Buffer.from(await fileCandidate.arrayBuffer())
        fileName = fileCandidate.name || fileName
        contentType = fileCandidate.type || inferMimeType(fileName, bytes)
      }

      const rawChannel = form.get('source_channel')
      if (typeof rawChannel === 'string' && rawChannel.trim()) sourceChannel = rawChannel.trim().toUpperCase()

      const rawUrl = form.get('source_file_url') ?? form.get('drive_url')
      if (typeof rawUrl === 'string' && rawUrl.trim()) sourceFileUrl = rawUrl.trim()

      const rawText = form.get('text_content') ?? form.get('sample_text') ?? form.get('text')
      if (typeof rawText === 'string' && rawText.trim()) textContent = rawText.trim()

      const rawSenderNum = form.get('sender_number') ?? form.get('sender_fax') ?? form.get('fax_number') ?? form.get('from')
      if (typeof rawSenderNum === 'string' && rawSenderNum.trim()) senderNumber = rawSenderNum.trim()

      const rawSenderName = form.get('sender_name')
      if (typeof rawSenderName === 'string' && rawSenderName.trim()) senderName = rawSenderName.trim()

      const rawJobId = form.get('fax_job_id')
      if (typeof rawJobId === 'string' && rawJobId.trim()) faxJobId = rawJobId.trim()

      dryRun = parseBool(form.get('dry_run'), false)
    } else if (reqContentType.includes('application/json')) {
      const jsonBody = (await req.json()) as Record<string, unknown>
      if (typeof jsonBody.text_content === 'string') textContent = jsonBody.text_content.trim()
      else if (typeof jsonBody.sample_text === 'string') textContent = jsonBody.sample_text.trim()
      else if (typeof jsonBody.text === 'string') textContent = jsonBody.text.trim()

      if (typeof jsonBody.source_channel === 'string') sourceChannel = jsonBody.source_channel.trim().toUpperCase()
      if (typeof jsonBody.source_file_url === 'string') sourceFileUrl = jsonBody.source_file_url.trim()
      if (typeof jsonBody.sender_number === 'string') senderNumber = jsonBody.sender_number.trim()
      if (typeof jsonBody.sender_name === 'string') senderName = jsonBody.sender_name.trim()
      if (jsonBody.fax_job_id != null) faxJobId = String(jsonBody.fax_job_id)
      dryRun = parseBool(jsonBody.dry_run, false)
    } else {
      // application/pdf や image/* のダイレクトバイナリPOSTにも対応
      const rawBuf = Buffer.from(await req.arrayBuffer())
      if (rawBuf.length > 0) {
        bytes = rawBuf
        fileName = req.headers.get('x-file-name') ?? `fax_${Date.now()}.pdf`
        contentType = reqContentType || inferMimeType(fileName, bytes)
      }
      senderNumber = req.headers.get('x-sender-fax') ?? req.headers.get('x-sender-number') ?? ''
      senderName = req.headers.get('x-sender-name') ?? ''
      sourceFileUrl = req.headers.get('x-source-file-url') ?? ''
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json(
      { detail: `受信データの読み取りに失敗しました: ${msg}`, error: msg },
      { status: 400 },
    )
  }

  // 発信元メタデータがある場合は補足テキストに付与してGeminiの取引先特定精度を高める（orders.py 継承）
  const metaLines: string[] = []
  if (senderName) metaLines.push(`発信元登録名: ${senderName}`)
  if (senderNumber) metaLines.push(`発信元FAX番号: ${senderNumber}`)
  if (sourceFileUrl && !textContent.includes(sourceFileUrl)) {
    metaLines.push(`Google Drive原本URL: ${sourceFileUrl}`)
  }
  const combinedText = [metaLines.join('\n'), textContent].filter(Boolean).join('\n').trim()

  // text_content 内に Google Drive URL が含まれていて source_file_url が空の場合は自動抽出
  if (!sourceFileUrl && combinedText) {
    const driveMatch = combinedText.match(/https:\/\/drive\.google\.com\/[^\s)\]]+/)
    if (driveMatch?.[0]) {
      sourceFileUrl = driveMatch[0]
    }
  }

  if ((!bytes || bytes.length === 0) && !combinedText) {
    return NextResponse.json(
      {
        detail: 'file（FAX画像/PDF）または text_content（注文テキスト）のいずれかを指定してください。',
        error: 'empty_input',
      },
      { status: 400 },
    )
  }

  // ── ドライランモード（Kojima-FAX 設定画面の「🧪 テスト注文送信」ボタン用）──
  if (dryRun) {
    try {
      const imageBase64 = bytes && bytes.length > 0 ? bytes.toString('base64') : undefined
      const res = await analyzeOrders(
        {
          imageBase64,
          mimeType: bytes && bytes.length > 0 ? contentType : undefined,
          text: combinedText || undefined,
        },
        sourceChannel.toLowerCase(),
        undefined,
        senderName || null,
      )
      const slipData = buildPipelineSlipResult({
        isOrderFax: res.is_order && res.orders.length > 0,
        skipReason: res.skip_reason ?? null,
        channel: sourceChannel,
        slipNo: res.slip_no ?? null,
        isFullResendingMatrix: Boolean(res.is_full_resending_matrix),
        sourceFileName: fileName,
        sourceFileUrl,
        parsedOrders: res.orders,
      })
      const tempId = `test-${Date.now().toString(36)}`
      return NextResponse.json({
        ok: true,
        status: slipData.is_order_fax ? 'ingested' : 'skipped_non_order',
        temp_id: tempId,
        receiptId: tempId,
        loaded_dynamic_rules_count: res.applied_rules_count ?? 0,
        used_model: res.used_model,
        slip_data: slipData,
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return NextResponse.json(
        { ok: false, status: 'failed', detail: `AI解析テスト失敗: ${msg}`, error: msg },
        { status: 502 },
      )
    }
  }

  // ── 本番取込モード（オンメモリ解析＋Google Drive原本URL記録）──
  const admin = createAdminClient()
  const hashSource = bytes && bytes.length > 0 ? bytes : Buffer.from(combinedText, 'utf-8')
  const exactHash = crypto.createHash('md5').update(hashSource).digest('hex')

  // 1. 完全重複チェック（Kojima-FAX の自動再送ワーカーに対して冪等に200を返す）
  const { data: existingExact, error: existingExactErr } = await admin
    .from('order_receipts')
    .select('id, status, order_id, raw_payload')
    .eq('exact_hash', exactHash)
    .maybeSingle()

  if (existingExactErr) {
    console.error('[POST /api/receipts] 完全重複チェックに失敗:', existingExactErr.message)
  }
  if (existingExact && existingExact.status !== 'ai_failed') {
    const prevSlip = (existingExact.raw_payload as Record<string, unknown> | null)?.['slip_data']
    return NextResponse.json({
      ok: true,
      duplicate: true,
      status: existingExact.status === 'not_order' ? 'skipped_non_order' : 'ingested',
      temp_id: existingExact.id,
      receiptId: existingExact.id,
      orderId: existingExact.order_id,
      loaded_dynamic_rules_count: 9,
      slip_data: prevSlip ?? {
        is_order_fax: existingExact.status !== 'not_order',
        client_name: senderName || '既取込データ',
        slip_no: '',
        source_file_url: sourceFileUrl,
        items: [],
      },
      message: '同一ファイル（MD5一致）が既に取り込み済みのためスキップしました',
    })
  }

  // 2. 送信元FAX番号・日付キーの抽出
  const parsedFilename = await parseFaxFilename(fileName)
  const faxNumber = senderNumber || parsedFilename?.faxNumber || null
  const receivedAt = new Date()
  const channelLower = sourceChannel === 'FAX' ? 'fax' : sourceChannel === 'EMAIL' ? 'email' : 'fax'
  const senderDateKey = faxNumber ? buildSenderDateKey('fax', faxNumber, receivedAt) : null

  // 同日・同送信元の再送（追記FAX）か判定
  let parentReceiptId: string | null = null
  if (senderDateKey) {
    const { data: existingRev, error: revErr } = await admin
      .from('order_receipts')
      .select('id')
      .eq('sender_date_key', senderDateKey)
      .order('received_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (revErr) console.error('[POST /api/receipts] 再送判定クエリ失敗:', revErr.message)
    parentReceiptId = (existingRev?.id as string | undefined) ?? null
  }

  const disposition = decideReceiptDisposition({
    exactHashMatch: false,
    senderDateKeyMatch: Boolean(parentReceiptId),
  })

  // ai_failed 時の手動「再解析」に備え、4MB以下の原本は解析完了まで一時的に raw_payload.file_base64 に保持する（解析完了時に自動削除）
  const tempFileBase64 =
    bytes && bytes.length > 0 && bytes.length <= 4 * 1024 * 1024 ? bytes.toString('base64') : null

  const initialPayload: Record<string, unknown> = {
    filename: fileName,
    content_type: contentType,
    sender_fax: faxNumber,
    sender_name: senderName || null,
    source_file_url: sourceFileUrl || null,
    fax_job_id: faxJobId || null,
    text: combinedText || null,
    ...(tempFileBase64 ? { file_base64: tempFileBase64 } : {}),
  }

  // 3. `order_receipts` に登録（原本は Kojima-FAX が Google Drive に保存した source_file_url をそのまま記録）
  let receiptId: string
  if (existingExact && existingExact.status === 'ai_failed') {
    receiptId = existingExact.id as string
    await admin
      .from('order_receipts')
      .update({
        status: 'pending_ai',
        r2_key: sourceFileUrl || null,
        raw_payload: initialPayload,
      })
      .eq('id', receiptId)
  } else {
    const { data: newReceipt, error: insertErr } = await admin
      .from('order_receipts')
      .insert({
        channel: channelLower,
        received_at: receivedAt.toISOString(),
        exact_hash: exactHash,
        sender_date_key: senderDateKey,
        // Cloudflare R2・Supabase Storage 不使用：Kojima-FAX が保存した Google Drive 閲覧URLを格納
        r2_key: sourceFileUrl || null,
        is_revision: disposition === 'revision',
        parent_id: parentReceiptId,
        raw_payload: initialPayload,
        status: 'pending_ai',
      })
      .select('id')
      .single()

    if (insertErr || !newReceipt) {
      console.error('[POST /api/receipts] order_receipts INSERT失敗:', insertErr?.message)
      return NextResponse.json(
        {
          detail: `受信レコードの登録に失敗しました: ${insertErr?.message ?? 'unknown'}`,
          error: insertErr?.message ?? 'insert_failed',
        },
        { status: 500 },
      )
    }
    receiptId = newReceipt.id as string
  }

  // 4. オンメモリバッファを直接渡して Gemini 解析 + `ai_rules` 動的注入を即時実行
  try {
    const result = await processReceipt(receiptId, {
      inMemoryBuffer: bytes,
      inMemoryMimeType: contentType,
    })

    if (result.status === 'ai_failed') {
      return NextResponse.json(
        {
          ok: false,
          status: 'failed',
          temp_id: receiptId,
          receiptId,
          detail: result.error ?? 'AI解析に失敗しました',
          error: result.error ?? 'ai_failed',
        },
        { status: 502 },
      )
    }

    const pipelineStatus = result.status === 'not_order' ? 'skipped_non_order' : 'ingested'
    return NextResponse.json(
      {
        ok: true,
        duplicate: false,
        status: pipelineStatus,
        review_status: result.status,
        temp_id: receiptId,
        receiptId,
        orderCount: result.orderCount,
        loaded_dynamic_rules_count: result.loadedDynamicRulesCount ?? 0,
        used_model: result.usedModel,
        slip_data: result.slipData ?? {
          is_order_fax: result.status !== 'not_order',
          client_name: senderName || '',
          slip_no: '',
          source_file_url: sourceFileUrl,
          items: [],
        },
        error: result.error ?? null,
      },
      { status: 200 },
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[POST /api/receipts] processReceipt 例外:', msg)
    return NextResponse.json(
      {
        ok: false,
        status: 'failed',
        temp_id: receiptId,
        receiptId,
        detail: msg,
        error: msg,
      },
      { status: 502 },
    )
  }
}

function inferMimeType(fileName: string, bytes: Buffer): string {
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x25 && // %
    bytes[1] === 0x50 && // P
    bytes[2] === 0x44 && // D
    bytes[3] === 0x46 // F
  ) {
    return 'application/pdf'
  }
  const lower = fileName.toLowerCase()
  if (lower.endsWith('.pdf')) return 'application/pdf'
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.tif') || lower.endsWith('.tiff')) return 'image/tiff'
  return 'application/octet-stream'
}
