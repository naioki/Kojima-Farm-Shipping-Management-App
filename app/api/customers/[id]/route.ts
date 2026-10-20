import { NextResponse } from 'next/server'
import { getAuthedUser } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { customerUpdateSchema } from '@/types/database'

export const runtime = 'nodejs'

/** 取引先の更新（情報編集・有効/無効）。 */
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
  if ('display_color' in d) updates.display_color = d.display_color ?? null
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'no_fields' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data, error } = await admin
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
 * 取引先の削除。
 * - 注文・請求書が0件の取引先は、紐づく取引ルール・納入先等を自動クリーンアップして物理削除する。
 * - 注文・請求履歴がある取引先は、履歴・税務証跡を保護しつつ自動で is_active = false（非表示・アーカイブ）にする。
 */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const id = params.id
  const admin = createAdminClient()

  const [ord, inv] = await Promise.all([
    admin.from('orders').select('id', { count: 'exact', head: true }).eq('customer_id', id),
    admin.from('invoices').select('id', { count: 'exact', head: true }).eq('customer_id', id),
  ])

  if ((ord.count ?? 0) === 0 && (inv.count ?? 0) === 0) {
    await Promise.allSettled([
      admin.from('customer_product_rules').delete().eq('customer_id', id),
      admin.from('customer_parse_hints').delete().eq('customer_id', id),
      admin.from('price_rules').delete().eq('customer_id', id),
      admin.from('pack_configs').delete().eq('customer_id', id),
      admin.from('deliveries').delete().eq('customer_id', id),
      admin.from('delivery_destinations').delete().eq('customer_id', id),
      admin.from('ai_learning_examples').update({ customer_id: null }).eq('customer_id', id),
      admin.from('order_receipts').update({ matched_customer_id: null }).eq('matched_customer_id', id),
    ])

    const { data, error } = await admin.from('customers').delete().eq('id', id).select('id').maybeSingle()
    if (!error && data) {
      return NextResponse.json({ deleted: true, mode: 'physical' })
    }
    if (error && error.code !== '23503') {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
  }

  // 注文・請求履歴がある場合は is_active = false（アーカイブ削除）に自動切り替え
  const { data: archived, error: archErr } = await admin
    .from('customers')
    .update({ is_active: false })
    .eq('id', id)
    .select('id')
    .maybeSingle()

  if (archErr) return NextResponse.json({ error: archErr.message }, { status: 500 })
  if (!archived) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  return NextResponse.json({
    deleted: true,
    mode: 'archived',
    message: '過去の注文・請求履歴を保護しつつ、取引先一覧から削除（非表示化）しました。',
  })
}
