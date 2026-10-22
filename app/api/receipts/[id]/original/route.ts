import { NextRequest, NextResponse } from 'next/server'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { toGoogleDrivePreviewUrl, toGoogleDriveViewUrl } from '@/lib/pipeline/schemas'

export const runtime = 'nodejs'

/**
 * 受信原本（Kojima-FAX が Google Drive に保存した PDF 等）の閲覧・プレビューURLへリダイレクト（社内ユーザー専用）。
 * Cloudflare R2 や Supabase Storage を使わず、Kojima-FAX から渡された Google Drive 原本URL (`source_file_url`) を直接参照する。
 * `?mode=preview` の場合は iframe 埋め込み用の `/preview` URL へリダイレクトする。
 * また未解析（ai_failed / pending_ai）で raw_payload.file_base64 がある場合はインラインでバイナリを返却する。
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const supabase = createClient()
  const { data: profile, error: profileErr } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()
  if (profileErr) console.error('[app/api/receipts/[id]/original/route.ts] ロールの取得に失敗:', profileErr.message)
  if (profile?.role !== 'admin' && profile?.role !== 'staff') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  // RLS環境でもスタッフが原本を安全に参照できるよう createAdminClient を使用
  const admin = createAdminClient()
  const { data: receipt, error } = await admin
    .from('order_receipts')
    .select('r2_key, raw_payload, parent_id')
    .eq('id', params.id)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const payload = (receipt?.raw_payload ?? {}) as Record<string, unknown>
  const slip = (payload['slip_data'] ?? {}) as Record<string, unknown>

  let rawUrl =
    (typeof payload['source_file_url'] === 'string' && payload['source_file_url'].trim()) ||
    (typeof payload['drive_url'] === 'string' && payload['drive_url'].trim()) ||
    (typeof payload['drive_backup_url'] === 'string' && payload['drive_backup_url'].trim()) ||
    (typeof payload['file_url'] === 'string' && payload['file_url'].trim()) ||
    (typeof payload['url'] === 'string' && payload['url'].trim()) ||
    (typeof slip['source_file_url'] === 'string' && slip['source_file_url'].trim()) ||
    (typeof receipt?.r2_key === 'string' && receipt.r2_key.trim()) ||
    null

  // 親受信（再送元）の原本URLフォールバック
  if (!rawUrl && receipt?.parent_id) {
    const { data: parent } = await admin
      .from('order_receipts')
      .select('r2_key, raw_payload')
      .eq('id', receipt.parent_id)
      .maybeSingle()
    if (parent) {
      const pp = (parent.raw_payload ?? {}) as Record<string, unknown>
      rawUrl =
        (typeof pp['source_file_url'] === 'string' && pp['source_file_url'].trim()) ||
        (typeof pp['drive_url'] === 'string' && pp['drive_url'].trim()) ||
        (typeof parent.r2_key === 'string' && parent.r2_key.trim()) ||
        null
    }
  }

  const isPreview = req.nextUrl.searchParams.get('mode') === 'preview'

  if (rawUrl) {
    const targetUrl = isPreview ? toGoogleDrivePreviewUrl(rawUrl) : toGoogleDriveViewUrl(rawUrl)
    if (targetUrl) {
      return NextResponse.redirect(targetUrl)
    }
  }

  // Google Drive URL が無い場合でも一時保持された file_base64 があればインライン返却
  if (typeof payload['file_base64'] === 'string' && payload['file_base64']) {
    const base64Data = payload['file_base64']
    const contentType =
      (typeof payload['content_type'] === 'string' && payload['content_type']) || 'application/pdf'

    // プレビュー表示（iframe埋め込み）かつ PDF の場合:
    // iPhone Safari 等でも「original Open」にならず他のFAXと同様にプレビュー表示できるよう、
    // 自前の HTML プレビューページ（PDF.jsレンダラー）を返す
    if (isPreview && contentType === 'application/pdf') {
      const html = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=3.0, user-scalable=yes">
  <title>FAX原本プレビュー</title>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 12px;
      background: #090d16;
      color: #f1f5f9;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      min-height: 100vh;
    }
    #controls {
      width: 100%;
      max-width: 900px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 12px;
      padding: 8px 14px;
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 10px;
      font-size: 13px;
      font-weight: bold;
    }
    #viewer {
      width: 100%;
      max-width: 900px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 16px;
    }
    canvas {
      width: 100% !important;
      max-width: 900px;
      height: auto !important;
      box-shadow: 0 10px 25px rgba(0,0,0,0.6);
      border-radius: 8px;
      background: white;
    }
    .status-msg {
      margin-top: 30px;
      font-size: 14px;
      font-weight: bold;
      color: #94a3b8;
      text-align: center;
    }
    .open-btn {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      background: #0284c7;
      color: white;
      text-decoration: none;
      padding: 6px 12px;
      border-radius: 8px;
      font-size: 12px;
      font-weight: bold;
      transition: background 0.15s;
    }
    .open-btn:hover { background: #0369a1; }
  </style>
</head>
<body>
  <div id="controls">
    <span>📄 受注FAX原本プレビュー</span>
    <a href="/api/receipts/${params.id}/original" target="_blank" rel="noopener noreferrer" class="open-btn">
      全画面で開く ↗
    </a>
  </div>
  <div id="viewer">
    <div id="loading" class="status-msg">FAX原本を描画中...</div>
  </div>
  <script>
    (async function() {
      const loading = document.getElementById('loading');
      try {
        if (typeof pdfjsLib === 'undefined') {
          throw new Error('PDF.js not loaded');
        }
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        const raw = atob(${JSON.stringify(base64Data)});
        const rawLength = raw.length;
        const array = new Uint8Array(new ArrayBuffer(rawLength));
        for (let i = 0; i < rawLength; i++) {
          array[i] = raw.charCodeAt(i);
        }
        const loadingTask = pdfjsLib.getDocument({ data: array });
        const pdf = await loadingTask.promise;
        if (loading) loading.remove();
        const viewer = document.getElementById('viewer');

        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
          const page = await pdf.getPage(pageNum);
          const viewport = page.getViewport({ scale: 2.0 });
          const canvas = document.createElement('canvas');
          const context = canvas.getContext('2d');
          canvas.height = viewport.height;
          canvas.width = viewport.width;
          viewer.appendChild(canvas);
          await page.render({ canvasContext: context, viewport: viewport }).promise;
        }
      } catch (err) {
        console.error('PDF render error:', err);
        if (loading) {
          loading.innerHTML = '<div style="background:#1e293b;border:1px solid #334155;border-radius:12px;padding:24px;max-width:380px;margin:20px auto;text-align:center;"><p style="margin:0 0 14px;color:#f8fafc;font-size:14px;font-weight:bold;">原本PDFが準備できています</p><a href="/api/receipts/${params.id}/original" target="_blank" class="open-btn" style="padding:10px 18px;font-size:14px;">全画面でPDFを開く ↗</a></div>';
        }
      }
    })();
  </script>
</body>
</html>`
      return new NextResponse(html, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
    }

    // プレビュー表示（iframe埋め込み）かつ 画像の場合:
    if (isPreview && contentType.startsWith('image/')) {
      const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=3.0, user-scalable=yes">
  <style>
    body { margin: 0; padding: 12px; background: #090d16; display: flex; justify-content: center; align-items: flex-start; min-height: 100vh; }
    img { max-width: 100%; height: auto; border-radius: 8px; box-shadow: 0 10px 25px rgba(0,0,0,0.6); }
  </style>
</head>
<body>
  <img src="data:${contentType};base64,${base64Data}" alt="FAX原本" />
</body>
</html>`
      return new NextResponse(html, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
    }

    // 別タブ直接表示の場合（生バイナリ）
    const buf = Buffer.from(base64Data, 'base64')
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': 'inline; filename="fax_original.pdf"; filename*=UTF-8\'\'%E5%8F%97%E6%B3%A8FAX%E5%8E%9F%E6%9C%AC.pdf',
      },
    })
  }

  // プレビューまたはブラウザ直接アクセス時の未登録案内（生JSONエラーを表示させない）
  const acceptsHtml = req.headers.get('accept')?.includes('text/html') ?? true
  if (isPreview || acceptsHtml) {
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>原本ファイル未登録</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; }
    .card { background: #1e293b; border: 1px solid #334155; border-radius: 20px; padding: 36px 24px; max-width: 440px; text-align: center; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5); }
    .icon { font-size: 52px; margin-bottom: 16px; }
    h2 { font-size: 20px; font-weight: 800; margin: 0 0 12px; color: #f1f5f9; }
    p { font-size: 14px; color: #94a3b8; line-height: 1.6; margin: 0 0 24px; }
    .btn { display: inline-block; background: #166534; color: white; text-decoration: none; padding: 12px 24px; border-radius: 12px; font-weight: 700; font-size: 14px; transition: background 0.15s; }
    .btn:hover { background: #15803d; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">📄</div>
    <h2>原本ファイルが登録されていません</h2>
    <p>この注文はテキストのみで取り込まれたか、原本PDFの連携前に処理されたデータです。注文内容の詳細は一覧画面からご確認ください。</p>
    <a href="javascript:window.close();" class="btn">ウィンドウを閉じる</a>
  </div>
</body>
</html>`
    return new NextResponse(html, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  }

  return NextResponse.json({ error: 'Google Drive 原本URLが登録されていません', hasFile: false }, { status: 404 })
}
