import 'server-only'
import { NextResponse } from 'next/server'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { specReportCreateSchema } from '@/types/database'
import { getStaffFeatures } from '@/lib/field/features'
import { putReceiptOriginal } from '@/lib/r2'

export const runtime = 'nodejs'
export const maxDuration = 30

/**
 * 規格の現場報告を作成（社内のみ）。
 * 管理者は常時可。スタッフは設定「STAFF_CAN_REPORT_SPEC」がONのときのみ（既定OFF）。
 * これは規格マスタの直接編集ではない（報告→管理者が確認して反映）。
 * 写真は任意。R2 未設定でもメモのみで報告できる（写真は保存できない旨を warning で返す）。
 */
export async function POST(req: Request) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 })

  const supabase = createClient()
  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).maybeSingle()
  const role = profile?.role
  if (role !== 'admin') {
    const features = await getStaffFeatures()
    if (role !== 'staff' || !features.reportSpec) {
      return NextResponse.json({ error: '規格報告の利用が許可されていません' }, { status: 403 })
    }
  }

  const parsed = specReportCreateSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? '入力値が不正です' },
      { status: 400 },
    )
  }
  const { customer_id, product_id, note, photoBase64, photoMimeType } = parsed.data

  // 写真があれば R2 に保存（失敗してもメモは保存する）。
  let photoKey: string | null = null
  let warning: string | undefined
  if (photoBase64) {
    try {
      const ext = (photoMimeType ?? 'image/jpeg').split('/')[1] ?? 'jpg'
      const key = `spec-reports/${crypto.randomUUID()}.${ext}`
      const bytes = Buffer.from(photoBase64, 'base64')
      photoKey = await putReceiptOriginal(key, bytes, photoMimeType ?? 'image/jpeg')
    } catch {
      warning = '写真の保存に失敗しました（R2未設定の可能性）。メモのみ登録しました。'
    }
  }

  // reported_by は本人（RLS の staff_insert_own と整合）。
  const { data, error } = await supabase
    .from('spec_reports')
    .insert({
      customer_id: customer_id ?? null,
      product_id: product_id ?? null,
      note,
      photo_url: photoKey,
      reported_by: user.id,
    })
    .select('id')
    .single()

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? '報告の登録に失敗しました' }, { status: 500 })
  }
  return NextResponse.json({ id: data.id, warning })
}
