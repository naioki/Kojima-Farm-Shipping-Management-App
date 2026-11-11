import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { aiRuleUpdateSchema } from '@/types/database'
import { invalidateAiRulesCache } from '@/lib/gemini/analyze'
import { requireAdminApi } from '@/lib/auth/api-guard'

export const runtime = 'nodejs'

async function verifyAdmin() {
  const guard = await requireAdminApi('管理者権限が必要です')
  if (!guard.ok) return guard
  return { ok: true as const, userId: guard.user.id }
}

/**
 * PATCH /api/ai-rules/[id]
 * AIルールの有効/無効トグル切り替え、または文面・取引先・優先度の編集。
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await verifyAdmin()
  if (!auth.ok) return auth.response

  const body = await req.json().catch(() => null)
  const parsed = aiRuleUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? '入力値が不正です', details: parsed.error.flatten() },
      { status: 422 },
    )
  }

  const updates: Record<string, unknown> = {
    ...parsed.data,
    updated_at: new Date().toISOString(),
  }

  const admin = createAdminClient()
  const { data: before } = await admin
    .from('ai_rules')
    .select('id, client_name, rule_text, is_active, priority, category')
    .eq('id', params.id)
    .maybeSingle()

  if (!before) {
    return NextResponse.json({ error: '対象のAIルールが見つかりません' }, { status: 404 })
  }

  const { data: updated, error: updErr } = await admin
    .from('ai_rules')
    .update(updates)
    .eq('id', params.id)
    .select('id, client_name, rule_text, is_active, priority, category, source, created_at, updated_at')
    .single()

  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })
  invalidateAiRulesCache()

  const { error: auditUpdErr } = await admin.from('audit_log').insert({
    entity_type: 'ai_rules',
    entity_id: params.id,
    action: 'UPDATE',
    changed_fields: Object.keys(parsed.data),
    old_values: before as unknown as Record<string, unknown>,
    new_values: updated as unknown as Record<string, unknown>,
    user_id: auth.userId,
  })
  if (auditUpdErr) console.error('[PATCH /api/ai-rules/[id]] audit_log 記録失敗:', auditUpdErr.message)

  return NextResponse.json({ rule: updated })
}

/**
 * DELETE /api/ai-rules/[id]
 * AIルールの削除。
 */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await verifyAdmin()
  if (!auth.ok) return auth.response

  const admin = createAdminClient()
  const { data: before } = await admin
    .from('ai_rules')
    .select('id, client_name, rule_text, is_active, priority, category, source')
    .eq('id', params.id)
    .maybeSingle()

  if (!before) {
    return NextResponse.json({ error: '対象のAIルールが見つかりません' }, { status: 404 })
  }

  const { error: delErr } = await admin.from('ai_rules').delete().eq('id', params.id)
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })
  invalidateAiRulesCache()

  const { error: auditDelErr } = await admin.from('audit_log').insert({
    entity_type: 'ai_rules',
    entity_id: params.id,
    action: 'DELETE',
    changed_fields: null,
    old_values: before as unknown as Record<string, unknown>,
    new_values: null,
    user_id: auth.userId,
  })
  if (auditDelErr) console.error('[DELETE /api/ai-rules/[id]] audit_log 記録失敗:', auditDelErr.message)

  return NextResponse.json({ ok: true })
}
