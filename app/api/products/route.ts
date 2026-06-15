import { NextResponse } from 'next/server'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { productCreateSchema } from '@/types/database'

export const runtime = 'nodejs'

/**
 * 商品（品目）の新規作成（設定から追加）。admin のみ（RLS）。
 * 週間マトリックスの品目タブ・スマート追加の選択肢になる。
 * default_tax_rate はマスタ既定であり、計算には order_items.tax_rate を使う（tax.md）。
 */
export async function POST(req: Request) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const parsed = productCreateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid', detail: parsed.error.flatten() }, { status: 400 })
  }
  const supabase = createClient()

  // 基準単位（base_unit）を正とし、旧 unit も同値で揃える（二重単位を解消）。
  const baseUnit = parsed.data.base_unit
  const { data, error } = await supabase
    .from('products')
    .insert({
      name: parsed.data.name,
      name_kana: parsed.data.name_kana ?? null,
      base_unit: baseUnit,
      unit: parsed.data.unit ?? baseUnit,
      default_tax_rate: parsed.data.default_tax_rate,
      container_capacity: parsed.data.container_capacity ?? null,
      default_unit_price: parsed.data.default_unit_price ?? null,
    })
    .select('id, name')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ product: data }, { status: 201 })
}
