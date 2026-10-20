import { NextResponse } from 'next/server'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { sumInvoiceTotals, type TaxRate } from '@/lib/calculations/tax'

export const runtime = 'nodejs'

/**
 * GET /api/invoices/candidates?from=YYYY-MM-DD&to=YYYY-MM-DD
 * 指定期間内に承認・出荷済みの明細がある取引先のみを抽出して返す。
 * 請求書作成時の「取引先選びの迷い・空振りエラー」を撲滅する。
 */
export async function GET(req: Request) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const from = searchParams.get('from')
  const to = searchParams.get('to')

  if (!from || !to || from > to) {
    return NextResponse.json({ error: '開始日・終了日を正しく指定してください' }, { status: 400 })
  }

  const supabase = createClient()

  // 1. 期間内の承認/出荷済み明細を取得
  const { data: rows, error } = await supabase
    .from('order_items')
    .select('id, quantity, shipped_qty, billable_qty, unit_price, tax_rate, price_status, orders!inner(customer_id, status, delivery_date)')
    .in('orders.status', ['approved', 'shipped'])
    .gte('orders.delivery_date', from)
    .lte('orders.delivery_date', to)

  if (error) {
    console.error('[invoices/candidates] query failed:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // 2. 取引先ごとにグループ化
  const grouped = new Map<
    string,
    {
      itemCount: number
      items: { quantity: number; shipped_qty: number | null; billable_qty: number | null; unit_price: number; tax_rate: number }[]
    }
  >()

  for (const r of rows ?? []) {
    const custId = (r.orders as unknown as { customer_id: string })?.customer_id
    if (!custId) continue
    const cur = grouped.get(custId) ?? { itemCount: 0, items: [] }
    cur.itemCount++
    cur.items.push({
      quantity: r.quantity,
      shipped_qty: r.shipped_qty,
      billable_qty: r.billable_qty,
      unit_price: Number(r.unit_price) || 0,
      tax_rate: Number(r.tax_rate) || 8,
    })
    grouped.set(custId, cur)
  }

  const customerIds = Array.from(grouped.keys())
  if (customerIds.length === 0) {
    return NextResponse.json({ candidates: [] })
  }

  // 3. 取引先名・表示順を取得
  const { data: customers } = await supabase
    .from('customers')
    .select('id, name')
    .in('id', customerIds)
    .order('name')

  const billableQty = (item: { quantity: number; shipped_qty: number | null; billable_qty: number | null }) =>
    item.billable_qty ?? item.shipped_qty ?? item.quantity

  const candidates = (customers ?? []).map((c) => {
    const g = grouped.get(c.id)!
    const totals = sumInvoiceTotals(
      g.items.map((i) => ({
        quantity: billableQty(i),
        unitPrice: i.unit_price,
        taxRate: (i.tax_rate === 10 ? 10 : 8) as TaxRate,
      })),
    )
    return {
      customerId: c.id,
      customerName: c.name,
      itemCount: g.itemCount,
      estimatedTotal: totals.total,
    }
  })

  return NextResponse.json({ candidates })
}
