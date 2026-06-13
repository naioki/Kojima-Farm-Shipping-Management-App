import { NextResponse } from 'next/server'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { customerParseHintSchema } from '@/types/database'

export const runtime = 'nodejs'

/**
 * 取引先の表記学習を1件保存（承認画面で修正したとき）。admin のみ（RLS）。
 * (customer_id, raw_name) で一意。既存なら hit_count を増やして上書き（学習の信頼度）。
 * これが Gemini プロンプトの few-shot（lib/ingestion/learning）の素になる。
 */
export async function POST(req: Request) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const parsed = customerParseHintSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid', detail: parsed.error.flatten() }, { status: 400 })
  }
  const { customer_id, raw_name, product_id, corrected_name, note } = parsed.data
  const supabase = createClient()

  const { data: existing } = await supabase
    .from('customer_parse_hints')
    .select('id, hit_count')
    .eq('customer_id', customer_id)
    .eq('raw_name', raw_name)
    .maybeSingle()

  if (existing) {
    const { data, error } = await supabase
      .from('customer_parse_hints')
      .update({
        product_id: product_id ?? null,
        corrected_name: corrected_name ?? null,
        note: note ?? null,
        hit_count: existing.hit_count + 1,
      })
      .eq('id', existing.id)
      .select('id, hit_count')
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ hint: data, learned: true })
  }

  const { data, error } = await supabase
    .from('customer_parse_hints')
    .insert({
      customer_id,
      raw_name,
      product_id: product_id ?? null,
      corrected_name: corrected_name ?? null,
      note: note ?? null,
      created_by: user.id,
    })
    .select('id, hit_count')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ hint: data, learned: true }, { status: 201 })
}
