import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireStaffApi } from '@/lib/auth/api-guard'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'

const querySchema = z.object({
  customer_id: z.string().uuid(),
  destination_id: z.string().uuid().optional(),
})

/**
 * GET /api/orders/last?customer_id=&destination_id=
 * 取引先（＞納入先）の直近の確定注文（承認済み・出荷済み・請求済み）と明細を返す。
 * 電話で「いつもの」「前回と同じ」と言われたときに、1タップで入力欄へ写すための材料。
 * 納入先を指定した場合はその納入先の注文、無ければ取引先全体の直近を返す。
 */
export async function GET(req: NextRequest) {
  const guard = await requireStaffApi()
  if (!guard.ok) return guard.response

  const parsed = querySchema.safeParse({
    customer_id: req.nextUrl.searchParams.get('customer_id') ?? undefined,
    destination_id: req.nextUrl.searchParams.get('destination_id') || undefined,
  })
  if (!parsed.success) return NextResponse.json({ error: 'invalid', detail: parsed.error.flatten() }, { status: 400 })
  const { customer_id, destination_id } = parsed.data

  const admin = createAdminClient()
  let q = admin
    .from('orders')
    .select('id, delivery_date, destination_id, shipping_time')
    .eq('customer_id', customer_id)
    .in('status', ['approved', 'shipped', 'invoiced'])
  if (destination_id) q = q.eq('destination_id', destination_id)
  const { data: order, error } = await q
    .order('delivery_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!order) return NextResponse.json({ order: null, items: [] })

  const { data: items, error: itemsErr } = await admin
    .from('order_items')
    .select('product_id, product_name, quantity, spec, container_type, has_card')
    .eq('order_id', order.id)
    .order('created_at')
  if (itemsErr) return NextResponse.json({ error: itemsErr.message }, { status: 500 })

  return NextResponse.json({
    order,
    // 数量0（取り消し済みの行）は写さない
    items: (items ?? []).filter((it) => it.product_id && Number(it.quantity) > 0),
  })
}
