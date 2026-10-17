import 'server-only'
import { NextResponse } from 'next/server'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { packConfigUpsertSchema } from '@/types/database'

export const runtime = 'nodejs'

/** 荷姿の作成（管理者）。base_per_selling が基準単位換算の真実。 */
export async function POST(req: Request) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 })
  const supabase = createClient()
  const { data: profile, error: profileErr } = await supabase.from('users').select('role').eq('id', user.id).maybeSingle()
  // ロール解決の失敗は admin として扱わない（fail closed）。無言にせずログに残す。
  if (profileErr) console.error('[app/api/pack-configs/route.ts] ロールの取得に失敗:', profileErr.message)
  if (profile?.role !== 'admin') return NextResponse.json({ error: '管理者のみ操作できます' }, { status: 403 })

  const parsed = packConfigUpsertSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? '入力値が不正です' }, { status: 400 })
  }
  const d = parsed.data
  const { data, error } = await supabase
    .from('pack_configs')
    .insert({
      product_id: d.product_id,
      customer_id: d.customer_id ?? null,
      label: d.label,
      inner_unit_label: d.inner_unit_label ?? null,
      inner_per: d.inner_per ?? null,
      outer_unit_label: d.outer_unit_label ?? null,
      outer_per: d.outer_per ?? null,
      selling_unit_label: d.selling_unit_label,
      base_per_selling: d.base_per_selling,
      needs_manual_confirm: d.needs_manual_confirm ?? false,
      // 作業指示（詳細）— migrations/0021。未入力は null。
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
    })
    .select('id')
    .single()
  if (error || !data) return NextResponse.json({ error: error?.message ?? '登録に失敗しました' }, { status: 500 })
  return NextResponse.json({ id: data.id })
}
