import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getStaffFeatures, canStaffUse } from '@/lib/field/features'
import { renderShippingDocPdf } from '@/lib/shipping-docs/render'

export const runtime = 'nodejs'

/**
 * 印刷キュー投入（統合2D）。出荷帳票PDFを生成して Storage に置き、print_jobs に登録する。
 * 事務所の常駐エージェント（v4 print_agent.py 無改修）が pending を拾って自動印刷する。
 * 権限は現場印刷ページと同じ（STAFF_CAN_PRINT_DOCS。admin は常に可）。
 */

const bodySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  docType: z.enum(['sheet', 'labels']),
  productId: z.string().uuid().nullish(),
})

export async function POST(req: Request) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const supabase = createClient()
  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).maybeSingle()
  const role = (profile?.role as 'admin' | 'staff') ?? 'staff'
  const features = await getStaffFeatures()
  if (!canStaffUse('printDocs', role, features)) {
    return NextResponse.json({ error: '帳票印刷は解放されていません' }, { status: 403 })
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  const { date, docType, productId } = parsed.data

  const rendered = await renderShippingDocPdf({ docType, date, productId })
  if (!rendered.ok) return NextResponse.json({ error: rendered.error }, { status: rendered.status })

  // Storage へ保存（非公開バケット）→ エージェント用の署名付きURL（1年）
  const admin = createAdminClient()
  const ts = Date.now()
  const path = `${date}/${docType}${productId ? `_${productId.slice(0, 8)}` : ''}_${ts}.pdf`
  const { error: uploadErr } = await admin.storage
    .from('print-jobs')
    .upload(path, rendered.buffer, { contentType: 'application/pdf', upsert: true })
  if (uploadErr) return NextResponse.json({ error: `PDF保存失敗: ${uploadErr.message}` }, { status: 500 })

  const { data: signed, error: signErr } = await admin.storage
    .from('print-jobs')
    .createSignedUrl(path, 365 * 24 * 3600)
  if (signErr || !signed?.signedUrl) {
    return NextResponse.json({ error: `署名URL発行失敗: ${signErr?.message ?? 'unknown'}` }, { status: 500 })
  }

  // キュー登録は利用者コンテキストで（RLS staff_insert が適用される）
  const { data: job, error: insertErr } = await supabase
    .from('print_jobs')
    .insert({
      doc_type: docType,
      target_date: date,
      product_id: productId ?? null,
      pdf_url: signed.signedUrl,
      requested_by: user.id,
    })
    .select('id')
    .maybeSingle()
  if (insertErr || !job) {
    return NextResponse.json({ error: `キュー登録失敗: ${insertErr?.message ?? 'unknown'}` }, { status: 500 })
  }

  return NextResponse.json({ id: job.id })
}
