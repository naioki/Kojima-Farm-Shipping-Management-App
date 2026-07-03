import { NextResponse } from 'next/server'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { lotCreateSchema } from '@/types/database'
import { writeAudit } from '@/lib/audit/log'

export const runtime = 'nodejs'

/**
 * ロット作成（J-GAPトレサ・配送 Phase 2）。粒度は「圃場×収穫日×品目」。
 * lot_no は「収穫日-圃場-品目名」で自動生成（重複時は -2, -3 を付与）。
 * assign_delivery_date 指定時は、その出荷日の同品目の未紐付け明細に一括紐付けする。
 */
export async function POST(req: Request) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const parsed = lotCreateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid', detail: parsed.error.flatten() }, { status: 400 })
  }
  const { product_id, harvest_date, field_name, gap_record_ref, note, assign_delivery_date } = parsed.data
  const supabase = createClient()

  const { data: product, error: prodErr } = await supabase
    .from('products')
    .select('name')
    .eq('id', product_id)
    .maybeSingle()
  if (prodErr) return NextResponse.json({ error: prodErr.message }, { status: 500 })
  if (!product) return NextResponse.json({ error: 'unknown_product' }, { status: 400 })

  // lot_no 自動生成（UNIQUE制約に当たったら連番を付けて再試行）
  const base = [harvest_date, field_name?.trim(), product.name].filter(Boolean).join('-')
  let lot: { id: string; lot_no: string } | null = null
  for (let i = 0; i < 5 && !lot; i++) {
    const lotNo = i === 0 ? base : `${base}-${i + 1}`
    const { data, error } = await supabase
      .from('lots')
      .insert({
        lot_no: lotNo,
        product_id,
        harvest_date,
        field_name: field_name?.trim() || null,
        gap_record_ref: gap_record_ref?.trim() || null,
        note: note?.trim() || null,
      })
      .select('id, lot_no')
      .maybeSingle()
    if (error) {
      if (error.code === '23505') continue // 重複 → 連番付与で再試行
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    lot = data
  }
  if (!lot) return NextResponse.json({ error: 'lot_no_conflict' }, { status: 409 })

  await writeAudit(supabase, {
    entityType: 'lots',
    entityId: lot.id,
    action: 'INSERT',
    oldValues: null,
    newValues: { ...parsed.data, lot_no: lot.lot_no },
    userId: user.id,
  })

  // 一括紐付け：指定出荷日の同品目・未紐付け明細に lot_id を付与
  let assigned = 0
  if (assign_delivery_date) {
    const { data: orders } = await supabase
      .from('orders')
      .select('id')
      .eq('delivery_date', assign_delivery_date)
      .neq('status', 'cancelled')
    const orderIds = (orders ?? []).map((o) => o.id)
    if (orderIds.length) {
      const { data: updated, error: updErr } = await supabase
        .from('order_items')
        .update({ lot_id: lot.id })
        .eq('product_id', product_id)
        .is('lot_id', null)
        .in('order_id', orderIds)
        .select('id')
      if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })
      assigned = (updated ?? []).length
    }
  }

  return NextResponse.json({ lot, assigned }, { status: 201 })
}
