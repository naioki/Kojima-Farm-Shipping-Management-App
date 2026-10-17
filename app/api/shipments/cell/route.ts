import { NextResponse } from 'next/server'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { matrixCellSchema } from '@/types/database'
import { parseQuantity } from '@/lib/calculations/parse-quantity'
import { writeAudit } from '@/lib/audit/log'

export const runtime = 'nodejs'

/**
 * 週間マトリックスの1セル更新（Laravel版 画面3）。
 * (取引先 × 品目 × 出荷日) を1セルとして upsert / 削除する。
 *   - 空欄保存 → その日のその明細を削除（features.md §5）。空になった注文は片付ける。
 *   - 値あり → スマートパースで総数確定（c記法は P/C 換算）。既存はUPDATE、無ければINSERT。
 *   - 税率・単価・名称は商品マスタから確定し冗長保持（tax.md。計算は order_items.tax_rate）。
 */
export async function PUT(req: Request) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const parsed = matrixCellSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid', detail: parsed.error.flatten() }, { status: 400 })
  }
  const { customer_id, product_id, delivery_date, quantity_raw } = parsed.data
  const supabase = createClient()

  // 商品マスタ
  const { data: product, error: prodErr } = await supabase
    .from('products')
    .select('id, name, unit, default_unit_price, default_tax_rate')
    .eq('id', product_id)
    .maybeSingle()
  if (prodErr) return NextResponse.json({ error: prodErr.message }, { status: 500 })
  if (!product) return NextResponse.json({ error: 'unknown_product' }, { status: 400 })

  // P/C ルール
  const { data: rule, error: ruleErr } = await supabase
    .from('customer_product_rules')
    .select('id, packs_per_case, spec, container_type, has_card')
    .eq('customer_id', customer_id)
    .eq('product_id', product_id)
    .maybeSingle()
  // P/C は換算の補助（未設定でも動く）。取得失敗しても続行するが無言にはしない。
  if (ruleErr) console.error('[api/shipments/cell] P/Cルールの取得に失敗:', ruleErr.message)

  // 既存の注文（取引先×出荷日×manual）と当該明細
  const { data: order, error: orderErr } = await supabase
    .from('orders')
    .select('id')
    .eq('customer_id', customer_id)
    .eq('delivery_date', delivery_date)
    .eq('source', 'manual')
    .limit(1)
    .maybeSingle()
  // 既存注文判定のDBエラーを「既存なし」に化けさせない（重複注文の作成を防ぐ）。
  if (orderErr) return NextResponse.json({ error: orderErr.message }, { status: 500 })

  const existingItem = order
    ? (
        await supabase
          .from('order_items')
          .select('*')
          .eq('order_id', order.id)
          .eq('product_id', product_id)
          .limit(1)
          .maybeSingle()
      ).data
    : null

  const result = parseQuantity(quantity_raw, { packsPerCase: rule?.packs_per_case ?? null })

  // 空欄＝削除
  if (result.type === 'delete') {
    if (existingItem) {
      const { error: delErr } = await supabase.from('order_items').delete().eq('id', existingItem.id)
      if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })
      await writeAudit(supabase, {
        entityType: 'order_items',
        entityId: existingItem.id,
        action: 'DELETE',
        oldValues: existingItem,
        newValues: null,
        userId: user.id,
      })
      // 注文が空になったら片付ける
      if (order) {
        const { count } = await supabase
          .from('order_items')
          .select('id', { count: 'exact', head: true })
          .eq('order_id', order.id)
        if ((count ?? 0) === 0) await supabase.from('orders').delete().eq('id', order.id)
      }
    }
    return NextResponse.json({ deleted: true })
  }

  if (result.type === 'error') {
    return NextResponse.json({ error: result.reason, input: result.input }, { status: 400 })
  }

  const quantity = result.total.toNumber()

  // 既存はUPDATE
  if (existingItem) {
    const { data: updated, error: updErr } = await supabase
      .from('order_items')
      .update({ quantity, version: existingItem.version + 1 })
      .eq('id', existingItem.id)
      .select()
      .single()
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })
    await writeAudit(supabase, {
      entityType: 'order_items',
      entityId: existingItem.id,
      action: 'UPDATE',
      oldValues: existingItem,
      newValues: updated,
      userId: user.id,
    })
    return NextResponse.json({ item: updated })
  }

  // 注文が無ければ作成
  let orderId = order?.id
  if (!orderId) {
    const { data: newOrder, error: orderErr } = await supabase
      .from('orders')
      .insert({
        customer_id,
        source: 'manual',
        status: 'approved',
        delivery_date,
        delivery_date_source: 'manual',
        created_by: user.id,
      })
      .select('id')
      .single()
    if (orderErr) return NextResponse.json({ error: orderErr.message }, { status: 500 })
    orderId = newOrder.id
  }

  const { data: item, error: itemErr } = await supabase
    .from('order_items')
    .insert({
      order_id: orderId,
      product_id,
      product_name: product.name,
      quantity,
      unit: product.unit,
      unit_price: product.default_unit_price ?? 0,
      tax_rate: product.default_tax_rate,
      rule_id: rule?.id ?? null,
      confidence: 1.0,
      field_status: 'not_started',
      spec: rule?.spec ?? null,
      container_type: rule?.container_type ?? null,
      has_card: rule?.has_card ?? null,
    })
    .select()
    .single()
  if (itemErr) return NextResponse.json({ error: itemErr.message }, { status: 500 })

  await writeAudit(supabase, {
    entityType: 'order_items',
    entityId: item.id,
    action: 'INSERT',
    oldValues: null,
    newValues: item,
    userId: user.id,
  })

  return NextResponse.json({ item }, { status: 201 })
}
