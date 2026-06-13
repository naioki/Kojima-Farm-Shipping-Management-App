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
  if (d.unit !== undefined) updates.unit = d.unit
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
