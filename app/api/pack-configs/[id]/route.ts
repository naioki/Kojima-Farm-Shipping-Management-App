import 'server-only'
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { packConfigInstructionsSchema } from '@/types/database'
import { requireAdminApi } from '@/lib/auth/api-guard'

export const runtime = 'nodejs'

const uuidRe = /^[0-9a-f-]{36}$/i

async function requireAdmin() {
  const guard = await requireAdminApi('管理者のみ操作できます')
  if (!guard.ok) return { error: guard.response }
  return { supabase: createAdminClient() }
}

/** 荷姿の作業指示（詳細）を更新（管理者）。基本項目（換算等）は含めず作業指示のみを対象にする。 */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  if (!uuidRe.test(params.id)) return NextResponse.json({ error: '入力値が不正です' }, { status: 400 })
  const auth = await requireAdmin()
  if (auth.error) return auth.error
  const { supabase } = auth

  const parsed = packConfigInstructionsSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? '入力値が不正です' }, { status: 400 })
  }
  const d = parsed.data
  const { error } = await supabase
    .from('pack_configs')
    .update({
      spec_note: d.spec_note ?? null,
      has_card: d.has_card ?? null,
      has_seal: d.has_seal ?? null,
      tape_color: d.tape_color ?? null,
      label_spec: d.label_spec ?? null,
      price_tag_required: d.price_tag_required ?? null,
      returnable_container: d.returnable_container ?? null,
      quality_note: d.quality_note ?? null,
      standing_notes: d.standing_notes ?? null,
      field_memo: d.field_memo ?? null,
      ...(d.needs_manual_confirm != null ? { needs_manual_confirm: d.needs_manual_confirm } : {}),
    })
    .eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

/** 荷姿を無効化（管理者）。参照される可能性があるため delete でなく is_active=false。 */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error
  const { supabase } = auth

  const { error } = await supabase.from('pack_configs').update({ is_active: false }).eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
