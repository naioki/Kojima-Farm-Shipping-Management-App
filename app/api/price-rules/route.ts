import 'server-only'
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { priceRuleCreateSchema } from '@/types/database'
import { requireAdminApi } from '@/lib/auth/api-guard'

export const runtime = 'nodejs'

async function requireAdmin() {
  const guard = await requireAdminApi('管理者のみ操作できます')
  if (!guard.ok) return { response: guard.response }
  return { user: guard.user, supabase: createAdminClient() }
}

/** 価格ルールの作成（管理者）。期間×取引先×荷姿×チャネル。 */
export async function POST(req: Request) {
  const auth = await requireAdmin()
  if ('response' in auth) return auth.response

  const parsed = priceRuleCreateSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? '入力値が不正です' }, { status: 400 })
  }
  const d = parsed.data
  const { data, error } = await auth.supabase
    .from('price_rules')
    .insert({
      product_id: d.product_id,
      customer_id: d.customer_id ?? null,
      pack_config_id: d.pack_config_id ?? null,
      channel: d.channel ?? null,
      price_unit: d.price_unit,
      unit_price: d.unit_price,
      tax_rate: d.tax_rate,
      effective_from: d.effective_from,
      effective_to: d.effective_to ?? null,
      note: d.note ?? null,
      created_by: auth.user.id,
    })
    .select('id')
    .single()
  if (error || !data) return NextResponse.json({ error: error?.message ?? '登録に失敗しました' }, { status: 500 })
  return NextResponse.json({ id: data.id })
}
