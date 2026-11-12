import 'server-only'
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { specReportUpdateSchema } from '@/types/database'
import { requireAdminApi } from '@/lib/auth/api-guard'

export const runtime = 'nodejs'

/**
 * 規格報告の処理（管理者のみ）。対応済み / 却下にする。
 * RLS（admin_all）で管理者のみ UPDATE 可能だが、API でも role を確認する（二重）。
 */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdminApi('管理者のみ処理できます')
  if (!guard.ok) return guard.response
  const user = guard.user
  const supabase = createAdminClient()

  const parsed = specReportUpdateSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: '入力値が不正です' }, { status: 400 })
  }

  const { error } = await supabase
    .from('spec_reports')
    .update({ status: parsed.data.status, handled_by: user.id, handled_at: new Date().toISOString() })
    .eq('id', params.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
