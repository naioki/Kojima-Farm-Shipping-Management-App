import { NextResponse } from 'next/server'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { customerProductRuleUpsertSchema } from '@/types/database'

export const runtime = 'nodejs'

/**
 * 取引先×商品の取引ルール upsert（Laravel版 画面5）。
 * (customer_id, product_id) 一意。P/C・荷姿・端数ポリシー・「いつものセット」を1行で保存。
 * これがスマートパース（c記法換算）と出荷指示書の基準になる。admin のみ（RLS）。
 */
export async function PUT(req: Request) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const parsed = customerProductRuleUpsertSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid', detail: parsed.error.flatten() }, { status: 400 })
  }
  const supabase = createClient()

  const { data, error } = await supabase
    .from('customer_product_rules')
    .upsert(parsed.data, { onConflict: 'customer_id,product_id' })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ rule: data })
}
