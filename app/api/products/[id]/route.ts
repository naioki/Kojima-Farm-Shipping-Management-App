import { NextResponse } from 'next/server'
import { getAuthedUser } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { productUpdateSchema } from '@/types/database'

export const runtime = 'nodejs'

/**
 * 商品の更新（編集・在庫調整）。
 * default_tax_rate はマスタ既定。請求計算には order_items.tax_rate を使う（tax.md）。
 */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const parsed = productUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid', detail: parsed.error.flatten() }, { status: 400 })
  }

  const updates: Record<string, unknown> = {}
  const d = parsed.data
  if (d.name !== undefined) updates.name = d.name
  if (d.name_kana !== undefined) updates.name_kana = d.name_kana
  // 基準単位を正とし、旧 unit も同値で揃える（二重単位の解消）
  if (d.base_unit !== undefined) {
    updates.base_unit = d.base_unit
    updates.unit = d.base_unit
  } else if (d.unit !== undefined) {
    updates.unit = d.unit
  }
  if (d.category !== undefined) updates.category = d.category ?? null
  if (d.default_tax_rate !== undefined) updates.default_tax_rate = d.default_tax_rate
  if (d.container_capacity !== undefined) updates.container_capacity = d.container_capacity
  if (d.default_unit_price !== undefined) updates.default_unit_price = d.default_unit_price
  if (d.stock_qty !== undefined) updates.stock_qty = d.stock_qty
  if (d.is_active !== undefined) updates.is_active = d.is_active
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'no_fields' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('products')
    .update(updates)
    .eq('id', params.id)
    .select()
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  return NextResponse.json({ product: data })
}

/**
 * 商品の削除。
 * - 注文明細（order_items）の履歴が0件の品目は、紐づく取引ルール・荷姿・価格設定等を自動クリーンアップして物理削除する。
 * - 過去の注文明細が存在する品目は、請求・出荷履歴を壊さないよう自動で is_active = false（アーカイブ削除）にし、一覧・選択肢から即座に除外する。
 */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const id = params.id
  const admin = createAdminClient()

  // 注文明細（実取引データ）の参照有無を確認
  const { count: orderItemCount } = await admin
    .from('order_items')
    .select('id', { count: 'exact', head: true })
    .eq('product_id', id)

  if ((orderItemCount ?? 0) === 0) {
    // 注文履歴が無い場合は、付随するマスタ・設定テーブルの参照をクリーンアップして完全物理削除を試みる
    await Promise.allSettled([
      admin.from('price_rules').delete().eq('product_id', id),
      admin.from('pack_configs').delete().eq('product_id', id),
      admin.from('customer_product_rules').delete().eq('product_id', id),
      admin.from('harvest_tasks').delete().eq('product_id', id),
      admin.from('harvest_estimates').delete().eq('product_id', id),
      admin.from('ai_learning_examples').update({ product_id: null }).eq('product_id', id),
      admin.from('spec_reports').update({ product_id: null }).eq('product_id', id),
      admin.from('print_jobs').update({ product_id: null }).eq('product_id', id),
      admin.from('app_settings').delete().eq('key', `v5_container_inv:${id}`),
    ])

    const { data, error } = await admin
      .from('products')
      .delete()
      .eq('id', id)
      .select('id')
      .maybeSingle()

    if (!error && data) {
      return NextResponse.json({ deleted: true, mode: 'physical' })
    }

    // 万が一他テーブルの外部キー制約（23503）が残っていた場合はエラーにせずアーカイブ削除へフォールバック
    if (error && error.code !== '23503') {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
  }

  // 過去の注文履歴がある場合（またはFK保護が働いた場合）は is_active = false に更新して一覧から削除（アーカイブ）
  const { data: archived, error: archErr } = await admin
    .from('products')
    .update({ is_active: false })
    .eq('id', id)
    .select('id')
    .maybeSingle()

  if (archErr) {
    return NextResponse.json({ error: archErr.message }, { status: 500 })
  }
  if (!archived) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  return NextResponse.json({
    deleted: true,
    mode: 'archived',
    message: '過去の注文履歴を保護しつつ、品目一覧から削除しました。',
  })
}
