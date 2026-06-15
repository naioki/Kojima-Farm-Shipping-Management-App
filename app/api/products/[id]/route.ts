import { NextResponse } from 'next/server'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { productUpdateSchema } from '@/types/database'

export const runtime = 'nodejs'

/**
 * 商品の更新（編集・在庫調整）。admin のみ（RLS）。
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
  if (d.default_tax_rate !== undefined) updates.default_tax_rate = d.default_tax_rate
  if (d.container_capacity !== undefined) updates.container_capacity = d.container_capacity
  if (d.default_unit_price !== undefined) updates.default_unit_price = d.default_unit_price
  if (d.stock_qty !== undefined) updates.stock_qty = d.stock_qty
  if (d.is_active !== undefined) updates.is_active = d.is_active
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'no_fields' }, { status: 400 })
  }

  const supabase = createClient()
  const { data, error } = await supabase
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
 * 商品の物理削除（admin のみ）。
 * 注文履歴・取引ルール・収穫見込み等から参照されている品目は履歴/税務保護のため削除不可（409）。
 * その場合は「有効」をオフ（ソフト削除＝一覧・選択肢から非表示）で対応する。
 * 未使用（打ち間違い等）の品目のみ物理削除を許可する。
 */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const id = params.id
  const supabase = createClient()

  // 参照の有無を確認（分かりやすいメッセージ用）。DBの外部キーも最終防壁になる。
  const [oi, cpr, he] = await Promise.all([
    supabase.from('order_items').select('id', { count: 'exact', head: true }).eq('product_id', id),
    supabase.from('customer_product_rules').select('id', { count: 'exact', head: true }).eq('product_id', id),
    supabase.from('harvest_estimates').select('id', { count: 'exact', head: true }).eq('product_id', id),
  ])
  const reasons: string[] = []
  if ((oi.count ?? 0) > 0) reasons.push('注文・出荷の履歴')
  if ((cpr.count ?? 0) > 0) reasons.push('取引先の取引ルール')
  if ((he.count ?? 0) > 0) reasons.push('収穫見込み')
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

  const { data, error } = await supabase.from('products').delete().eq('id', id).select('id').maybeSingle()
  if (error) {
    // 外部キー違反（他テーブルからの参照）も使用中として扱う
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
