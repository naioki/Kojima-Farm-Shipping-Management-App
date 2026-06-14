import { NextResponse } from 'next/server'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { customerUpdateSchema } from '@/types/database'

export const runtime = 'nodejs'

/** 取引先の更新（情報編集・有効/無効）。admin のみ（RLS）。 */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const parsed = customerUpdateSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid', detail: parsed.error.flatten() }, { status: 400 })
  }

  const updates: Record<string, unknown> = {}
  const d = parsed.data
  if (d.name !== undefined) updates.name = d.name
  if (d.name_kana !== undefined) updates.name_kana = d.name_kana
  if (d.payment_terms !== undefined) updates.payment_terms = d.payment_terms
  if (d.is_active !== undefined) updates.is_active = d.is_active
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'no_fields' }, { status: 400 })
  }

  const supabase = createClient()
  const { data, error } = await supabase
    .from('customers')
    .update(updates)
    .eq('id', params.id)
    .select('id, name, name_kana, payment_terms, is_active')
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  return NextResponse.json({ customer: data })
}

/**
 * 取引先の物理削除（admin のみ）。
 * 注文・請求・取引ルール・納品書から参照されている取引先は履歴/税務保護のため削除不可（409）。
 * その場合は「有効」をオフ（ソフト削除）で対応する。未使用の取引先のみ物理削除を許可。
 */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const id = params.id
  const supabase = createClient()

  // 参照の有無を確認（分かりやすいメッセージ用）。DBの外部キーも最終防壁になる。
  const [ord, inv, cpr, dn] = await Promise.all([
    supabase.from('orders').select('id', { count: 'exact', head: true }).eq('customer_id', id),
    supabase.from('invoices').select('id', { count: 'exact', head: true }).eq('customer_id', id),
    supabase.from('customer_product_rules').select('id', { count: 'exact', head: true }).eq('customer_id', id),
    supabase.from('delivery_notes').select('id', { count: 'exact', head: true }).eq('customer_id', id),
  ])
  const reasons: string[] = []
  if ((ord.count ?? 0) > 0) reasons.push('注文')
  if ((inv.count ?? 0) > 0) reasons.push('請求書')
  if ((cpr.count ?? 0) > 0) reasons.push('取引ルール')
  if ((dn.count ?? 0) > 0) reasons.push('納品書')
  if (reasons.length > 0) {
    return NextResponse.json(
      {
        error: 'in_use',
        reasons,
        message: `使用中のため削除できません（${reasons.join('・')}）。代わりに「有効」をオフにすると一覧・選択肢から非表示にできます。`,
      },
      { status: 409 },
    )
  }

  const { data, error } = await supabase.from('customers').delete().eq('id', id).select('id').maybeSingle()
  if (error) {
    if (error.code === '23503') {
      return NextResponse.json(
        { error: 'in_use', message: '使用中のため削除できません。代わりに「有効」をオフにしてください。' },
        { status: 409 },
      )
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  return NextResponse.json({ deleted: true })
}
