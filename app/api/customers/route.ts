import { NextResponse } from 'next/server'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { customerCreateSchema } from '@/types/database'

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
