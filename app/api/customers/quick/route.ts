import { NextResponse } from 'next/server'
import { getAuthedUser } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isStaffUser } from '@/lib/auth/is-staff-user'
import { customerCreateSchema } from '@/types/database'
import { normalizeOrgName } from '@/lib/normalize/org-name'

export const runtime = 'nodejs'

/**
 * 現場スタッフが「スマート追加」からその場で取引先を最小登録する（Issue#20）。
 *
 * RLS は厳格なまま（customers への staff INSERT ポリシーは付与しない）。社内ユーザーだけを
 * サーバー側で判定し、検証済み経路を admin client（service_role）で通す。抜け道を作らないため
 * 社内ユーザー以外は 403。
 *
 * 重複防止（migrations/0022 と同じ正規化名）: 既存があれば新規作成せず既存を返す
 * （existed:true）。色・締め・規格は未設定のまま作られ、admin が後から補完する運用。
 */
export async function POST(req: Request) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!(await isStaffUser(user.id))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  const parsed = customerCreateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid', detail: parsed.error.flatten() }, { status: 400 })
  }
  const admin = createAdminClient()

  // 正規化名（法人格・全半角・空白ゆれ吸収）で既存照合。DB の UNIQUE INDEX(uq_customers_norm_name)
  // が最終防波堤だが、ここで既存を返して「既存に紐付けました」を UI に伝える。
  const norm = normalizeOrgName(parsed.data.name)
  const { data: allCustomers, error: listErr } = await admin.from('customers').select('id, name')
  if (listErr) return NextResponse.json({ error: listErr.message }, { status: 500 })
  const existing = (allCustomers ?? []).find((c) => normalizeOrgName(c.name) === norm)
  if (existing) {
    return NextResponse.json({ id: existing.id, name: existing.name, existed: true }, { status: 200 })
  }

  const { data, error } = await admin
    .from('customers')
    .insert({
      name: parsed.data.name,
      name_kana: parsed.data.name_kana ?? null,
      payment_terms: parsed.data.payment_terms ?? null,
      is_active: true,
    })
    .select('id, name')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ id: data.id, name: data.name, existed: false }, { status: 201 })
}
