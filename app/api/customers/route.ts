import { NextResponse } from 'next/server'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { customerCreateSchema } from '@/types/database'
import { normalizeOrgName } from '@/lib/normalize/org-name'

export const runtime = 'nodejs'

/** 取引先の新規作成（Laravel版 画面5）。admin のみ（RLS）。 */
export async function POST(req: Request) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const parsed = customerCreateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid', detail: parsed.error.flatten() }, { status: 400 })
  }
  const supabase = createClient()

  // 重複登録防止（Issue#6-(5)）: 正規化名（法人格・全半角・空白ゆれ吸収）が一致する既存を先に探す。
  // DB の UNIQUE INDEX(uq_customers_norm_name) が最終防波堤だが、ここで 409＋既存候補を返すことで
  // UI が「既存の◯◯を使いますか？」を提示できる（DB エラーの生メッセージを見せない）。
  const norm = normalizeOrgName(parsed.data.name)
  const { data: allCustomers, error: listErr } = await supabase.from('customers').select('id, name')
  if (listErr) return NextResponse.json({ error: listErr.message }, { status: 500 })
  const existing = (allCustomers ?? []).find((c) => normalizeOrgName(c.name) === norm)
  if (existing) {
    return NextResponse.json({ error: 'duplicate', existing }, { status: 409 })
  }

  const { data, error } = await supabase
    .from('customers')
    .insert({
      name: parsed.data.name,
      name_kana: parsed.data.name_kana ?? null,
      payment_terms: parsed.data.payment_terms ?? null,
    })
    .select('id, name')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ customer: data }, { status: 201 })
}
