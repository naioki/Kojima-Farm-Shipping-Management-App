import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { aiRuleCreateSchema } from '@/types/database'
import { invalidateAiRulesCache } from '@/lib/gemini/analyze'
import { requireStaffApi } from '@/lib/auth/api-guard'

export const runtime = 'nodejs'

async function verifyStaffOrAdmin() {
  const guard = await requireStaffApi('スタッフまたは管理者権限が必要です')
  if (!guard.ok) return guard
  return { ok: true as const, userId: guard.user.id }
}

/**
 * GET /api/ai-rules
 * 取引先別のAI読取ルール一覧を取得（優先度順 → 作成日時順）。
 */
export async function GET(req: NextRequest) {
  const auth = await verifyStaffOrAdmin()
  if (!auth.ok) return auth.response

  const clientName = req.nextUrl.searchParams.get('client_name')?.trim()
  const activeOnly = req.nextUrl.searchParams.get('active_only') === '1'

  const admin = createAdminClient()
  let query = admin
    .from('ai_rules')
    .select('id, client_name, rule_text, is_active, priority, category, source, created_at, updated_at')
    .order('priority', { ascending: true })
    .order('created_at', { ascending: true })

  if (clientName) query = query.eq('client_name', clientName)
  if (activeOnly) query = query.eq('is_active', true)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ rules: data ?? [] })
}

/**
 * POST /api/ai-rules
 * 新しい取引先別AI読取ルールを追加（管理画面 `/admin/rules`・承認画面・現場スマート読取のワンタップ学習から呼ばれる）。
 */
export async function POST(req: NextRequest) {
  const auth = await verifyStaffOrAdmin()
  if (!auth.ok) return auth.response

  const body = await req.json().catch(() => null)
  const parsed = aiRuleCreateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? '入力値が不正です', details: parsed.error.flatten() },
      { status: 422 },
    )
  }

  const { client_name, rule_text, is_active, priority, category, source } = parsed.data
  const admin = createAdminClient()

  // 同一 client_name + rule_text の重複登録を防止（既存があれば有効化して返す）
  const { data: existing, error: existingErr } = await admin
    .from('ai_rules')
    .select('id, client_name, rule_text, is_active, priority, category, source, created_at, updated_at')
    .eq('client_name', client_name)
    .eq('rule_text', rule_text)
    .maybeSingle()

  if (existingErr) return NextResponse.json({ error: existingErr.message }, { status: 500 })

  if (existing) {
    const { data: updated, error: updErr } = await admin
      .from('ai_rules')
      .update({
        is_active: true,
        priority,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
      .select('id, client_name, rule_text, is_active, priority, category, source, created_at, updated_at')
      .single()

    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })
    invalidateAiRulesCache()
    return NextResponse.json({ rule: updated, deduplicated: true })
  }

  const { data: created, error: insertErr } = await admin
    .from('ai_rules')
    .insert({
      client_name,
      rule_text,
      is_active,
      priority,
      category,
      source,
    })
    .select('id, client_name, rule_text, is_active, priority, category, source, created_at, updated_at')
    .single()

  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 })
  invalidateAiRulesCache()

  const { error: auditErr } = await admin.from('audit_log').insert({
    entity_type: 'ai_rules',
    entity_id: created.id,
    action: 'INSERT',
    changed_fields: ['client_name', 'rule_text', 'is_active', 'priority', 'category', 'source'],
    old_values: null,
    new_values: created as unknown as Record<string, unknown>,
    user_id: auth.userId,
  })
  if (auditErr) console.error('[POST /api/ai-rules] audit_log 記録失敗:', auditErr.message)

  return NextResponse.json({ rule: created }, { status: 201 })
}
