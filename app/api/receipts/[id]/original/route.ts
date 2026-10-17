import { NextRequest, NextResponse } from 'next/server'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
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

  const { data: receipt, error } = await supabase
    .from('order_receipts')
    .select('r2_key, raw_payload')
    .eq('id', params.id)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const payload = (receipt?.raw_payload ?? {}) as Record<string, unknown>
  const rawUrl =
    (typeof payload['source_file_url'] === 'string' && payload['source_file_url']) ||
    receipt?.r2_key ||
    null

  if (rawUrl) {
    const isPreview = req.nextUrl.searchParams.get('mode') === 'preview'
    const targetUrl = isPreview ? toGoogleDrivePreviewUrl(rawUrl) : toGoogleDriveViewUrl(rawUrl)
    if (targetUrl) {
      return NextResponse.redirect(targetUrl)
    }
  }

  // Google Drive URL が無い場合でも一時保持された file_base64 があればインライン返却
  if (typeof payload['file_base64'] === 'string' && payload['file_base64']) {
    const buf = Buffer.from(payload['file_base64'], 'base64')
    const contentType =
      (typeof payload['content_type'] === 'string' && payload['content_type']) || 'application/pdf'
    return new NextResponse(buf, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': 'inline',
      },
    })
  }

  return NextResponse.json({ error: 'Google Drive 原本URLが登録されていません' }, { status: 404 })
}
