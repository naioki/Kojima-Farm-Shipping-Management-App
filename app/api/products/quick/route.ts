import { NextResponse } from 'next/server'
import { getAuthedUser } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isStaffUser } from '@/lib/auth/is-staff-user'
import { productCreateSchema } from '@/types/database'

export const runtime = 'nodejs'

/**
 * 現場スタッフが「スマート追加」からその場で品目を最小登録する（Issue#20）。
 *
 * RLS は厳格なまま（products への staff INSERT ポリシーは付与しない）。社内ユーザーだけを
 * サーバー側で判定し、検証済み経路を admin client（service_role）で通す。社内ユーザー以外は 403。
 *
 * products には正規化 UNIQUE INDEX が無いため、name（trim）一致で既存照合してから作成する
 * （同名品目の二重登録を防ぐ）。既存があれば existed:true で返し新規作成しない。
 * default_tax_rate はマスタ既定であり計算には order_items.tax_rate を使う（tax.md）。
 */
export async function POST(req: Request) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!(await isStaffUser(user.id))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  const parsed = productCreateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid', detail: parsed.error.flatten() }, { status: 400 })
  }
  const admin = createAdminClient()

  // name（trim）一致で既存照合（正規化 INDEX が無いため TS 側で防ぐ）。
  const wanted = parsed.data.name.trim()
  const { data: allProducts, error: listErr } = await admin.from('products').select('id, name')
  if (listErr) return NextResponse.json({ error: listErr.message }, { status: 500 })
  const existing = (allProducts ?? []).find((p) => (p.name ?? '').trim() === wanted)
  if (existing) {
    return NextResponse.json({ id: existing.id, name: existing.name, existed: true }, { status: 200 })
  }

  // 基準単位（base_unit）を正とし、旧 unit も同値で揃える（二重単位を解消・products/route.ts と同じ）。
  const baseUnit = parsed.data.base_unit
  const { data, error } = await admin
    .from('products')
    .insert({
      name: parsed.data.name,
      base_unit: baseUnit,
      unit: parsed.data.unit ?? baseUnit,
      category: parsed.data.category ?? null,
      default_tax_rate: parsed.data.default_tax_rate,
      is_active: true,
    })
    .select('id, name, unit')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ id: data.id, name: data.name, unit: data.unit, existed: false }, { status: 201 })
}
