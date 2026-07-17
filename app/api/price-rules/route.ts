import 'server-only'
import { NextResponse } from 'next/server'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { priceRuleCreateSchema } from '@/types/database'

export const runtime = 'nodejs'

async function requireAdmin() {
  const user = await getAuthedUser()
  if (!user) return { error: '認証が必要です', status: 401 as const }
  const supabase = createClient()
  const { data: profile, error: profileErr } = await supabase.from('users').select('role').eq('id', user.id).maybeSingle()
  // ロール解決の失敗は admin として扱わない（fail closed）。無言にせずログに残す。
  if (profileErr) console.error('[app/api/price-rules/route.ts] ロールの取得に失敗:', profileErr.message)
  if (profile?.role !== 'admin') return { error: '管理者のみ操作できます', status: 403 as const }
  return { user, supabase }
}

/** 価格ルールの作成（管理者）。期間×取引先×荷姿×チャネル。 */
export async function POST(req: Request) {
  const auth = await requireAdmin()
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

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
