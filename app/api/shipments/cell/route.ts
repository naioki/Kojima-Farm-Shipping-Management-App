import { NextResponse } from 'next/server'
import { getAuthedUser } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isStaffUser } from '@/lib/auth/is-staff-user'
import { matrixCellSchema } from '@/types/database'
import { parseQuantity } from '@/lib/calculations/parse-quantity'
import { writeAudit } from '@/lib/audit/log'
import { jstTodayStr, shiftDateStr } from '@/lib/dates'

export const runtime = 'nodejs'

/**
 * 週間マトリックスの1セル更新（#25 destination_id 対応）。
 * (取引先 × 納入先(任意) × 品目 × 出荷日) を1セルとして upsert / 削除する。
 */
export async function PUT(req: Request) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!(await isStaffUser(user.id))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  const parsed = matrixCellSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid', detail: parsed.error.flatten() }, { status: 400 })
  }
  const { customer_id, destination_id, product_id, delivery_date, quantity_raw } = parsed.data
  const supabase = createAdminClient()

  // 商品マスタ ＆ 取引先名
  const [{ data: product, error: prodErr }, { data: cust }] = await Promise.all([
    supabase
      .from('products')
      .select('id, name, unit, default_unit_price, default_tax_rate, container_capacity')
      .eq('id', product_id)
      .maybeSingle(),
    supabase.from('customers').select('name').eq('id', customer_id).maybeSingle(),
  ])
  if (prodErr) return NextResponse.json({ error: prodErr.message }, { status: 500 })
  if (!product) return NextResponse.json({ error: 'unknown_product' }, { status: 400 })

  // P/C ルール
  const { data: rule, error: ruleErr } = await supabase
    .from('customer_product_rules')
    .select('id, packs_per_case, spec, container_type, has_card')
    .eq('customer_id', customer_id)
    .eq('product_id', product_id)
    .maybeSingle()
  if (ruleErr) console.error('[api/shipments/cell] P/Cルールの取得に失敗:', ruleErr.message)

  const custName = cust?.name ?? ''
  const defaultPpc =
    rule?.packs_per_case ??
    (custName.includes('農業総合研究所') || custName.toUpperCase().includes('NSK')
      ? 24
      : product.container_capacity ?? 20)

  // #25 destination_id が指定されている場合はその納入先の注文に正確に絞り込む
  let orderQuery = supabase
    .from('orders')
    .select('id')
    .eq('customer_id', customer_id)
    .eq('delivery_date', delivery_date)
    .neq('status', 'cancelled')

  if (destination_id) {
    orderQuery = orderQuery.eq('destination_id', destination_id)
  }

  const { data: order, error: orderErr } = await orderQuery
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
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

  const result = parseQuantity(quantity_raw, { packsPerCase: defaultPpc })

  // 空欄＝削除
  if (result.type === 'delete') {
    if (existingItem) {
      await supabase.from('harvest_tasks').delete().eq('order_item_id', existingItem.id)
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

  if (existingItem) {
    const oldQty = Number(existingItem.quantity) || 0
    const qtyChanged = quantity !== oldQty
    const wasPackedAndIncreased =
      qtyChanged &&
      quantity > oldQty &&
      (existingItem.field_status === 'packed' || existingItem.field_status === 'shipped')
    const preservedPartialQty = wasPackedAndIncreased
      ? oldQty
      : existingItem.shipped_qty && existingItem.shipped_qty > 0 && existingItem.shipped_qty < quantity
      ? existingItem.shipped_qty
      : null

    const { data: updated, error: updErr } = await supabase
      .from('order_items')
      .update({
        quantity,
        quantity_raw: quantity_raw.trim() || String(quantity),
        version: (Number(existingItem.version) || 1) + 1,
        ...(qtyChanged
          ? {
              field_status: 'not_started',
              shipped_qty: preservedPartialQty,
            }
          : {}),
      })
      .eq('id', existingItem.id)
      .select()
      .single()
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

    try {
      await supabase
        .from('harvest_tasks')
        .update({ required_qty: quantity })
        .eq('order_item_id', existingItem.id)
    } catch {}

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

  let orderId = order?.id
  if (!orderId) {
    const { data: newOrder, error: createOrderErr } = await supabase
      .from('orders')
      .insert({
        customer_id,
        destination_id: destination_id ?? null,
        source: 'manual',
        status: 'approved',
        order_date: jstTodayStr(),
        delivery_date,
        delivery_date_source: 'manual',
      })
      .select('id')
      .single()
    if (createOrderErr) return NextResponse.json({ error: createOrderErr.message }, { status: 500 })
    orderId = newOrder.id
  }

  const { data: item, error: itemErr } = await supabase
    .from('order_items')
    .insert({
      order_id: orderId,
      product_id,
      product_name: product.name,
      quantity,
      quantity_raw: quantity_raw.trim() || String(quantity),
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

  try {
    const harvestDate = shiftDateStr(delivery_date, -1)
    await supabase.from('harvest_tasks').insert({
      product_id,
      order_item_id: item.id,
      required_qty: quantity,
      task_date: harvestDate,
      status: 'not_started',
    })
  } catch (htErr) {
    console.warn('[api/shipments/cell] harvest_tasks 生成警告:', htErr)
  }

  return NextResponse.json({ item }, { status: 201 })
}
