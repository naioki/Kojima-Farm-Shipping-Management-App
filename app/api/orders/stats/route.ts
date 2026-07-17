import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * GET /api/orders/stats?customer_id=xxx
 * 取引先の過去90日の商品別数量統計（最大・最小・平均・最終注文日）。
 * 注文入力フォームのインライン異常値検知に使用。
 */
export async function GET(req: NextRequest) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 })

  const customerId = req.nextUrl.searchParams.get('customer_id')
  if (!customerId) return NextResponse.json({ error: 'customer_id は必須です' }, { status: 400 })

  const supabase = createClient()
  const { data: profile, error: profileErr } = await supabase.from('users').select('role').eq('id', user.id).maybeSingle()
  // ロール解決の失敗は admin として扱わない（fail closed）。無言にせずログに残す。
  if (profileErr) console.error('[app/api/orders/stats/route.ts] ロールの取得に失敗:', profileErr.message)
  if (profile?.role !== 'admin') {
    return NextResponse.json({ error: '管理者権限が必要です' }, { status: 403 })
  }

  const admin = createAdminClient()
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  const { data: orders, error: ordersErr } = await admin
    .from('orders')
    .select('id, delivery_date')
    .eq('customer_id', customerId)
    .gte('delivery_date', since)
    .in('status', ['approved', 'shipped', 'invoiced'])
  // DBエラーを「統計なし」に化けさせない。
  if (ordersErr) return NextResponse.json({ error: ordersErr.message }, { status: 500 })

  if (!orders || orders.length === 0) {
    return NextResponse.json({ stats: {} })
  }

  const orderIds = orders.map((o) => o.id)
  const dateByOrderId = new Map(orders.map((o) => [o.id, o.delivery_date]))

  const { data: items, error: itemsErr } = await admin
    .from('order_items')
    .select('product_id, product_name, quantity, order_id')
    .in('order_id', orderIds)
  if (itemsErr) return NextResponse.json({ error: itemsErr.message }, { status: 500 })

  const byProduct: Record<
    string,
    { name: string; qtys: number[]; lastDate: string }
  > = {}

  for (const it of items ?? []) {
    const pid = it.product_id
    if (!byProduct[pid]) {
      byProduct[pid] = { name: it.product_name, qtys: [], lastDate: '' }
    }
    byProduct[pid].qtys.push(Number(it.quantity))
    const d = dateByOrderId.get(it.order_id) ?? ''
    if (d > byProduct[pid].lastDate) byProduct[pid].lastDate = d
  }

  const stats: Record<
    string,
    { productName: string; max: number; min: number; avg: number; count: number; lastDate: string }
  > = {}
  for (const [pid, { name, qtys, lastDate }] of Object.entries(byProduct)) {
    const max = Math.max(...qtys)
    const min = Math.min(...qtys)
    const avg = qtys.reduce((a, b) => a + b, 0) / qtys.length
    stats[pid] = { productName: name, max, min, avg: Math.round(avg * 10) / 10, count: qtys.length, lastDate }
  }

  return NextResponse.json({ stats })
}
