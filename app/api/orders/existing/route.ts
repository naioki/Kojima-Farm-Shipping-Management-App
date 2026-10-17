import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'

const querySchema = z.object({
  customer_id: z.string().uuid(),
  delivery_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  destination_id: z.string().uuid().nullish(),
})

/**
 * GET /api/orders/existing
 * 同一キー（取引先 × 納入先 × 納品日）の既存注文の「商品別 数量合計」を返す。
 * OCR保存フォームで「前回X → 今回Y」の差分を見せ、再送FAXの数量変更を見落とさないため。
 * 既存が無ければ items は空。キャンセル済みは除外。
 */
export async function GET(req: NextRequest) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 })
  const sb = createClient()
  const { data: profile, error: profileErr } = await sb.from('users').select('role').eq('id', user.id).maybeSingle()
  // ロール解決の失敗は admin として扱わない（fail closed）。無言にせずログに残す。
  if (profileErr) console.error('[app/api/orders/existing/route.ts] ロールの取得に失敗:', profileErr.message)
  if (profile?.role !== 'admin') return NextResponse.json({ error: '管理者権限が必要です' }, { status: 403 })

  const sp = req.nextUrl.searchParams
  const parsed = querySchema.safeParse({
    customer_id: sp.get('customer_id'),
    delivery_date: sp.get('delivery_date'),
    destination_id: sp.get('destination_id') || undefined,
  })
  if (!parsed.success) return NextResponse.json({ items: [] })

  const { customer_id, delivery_date, destination_id } = parsed.data
  const admin = createAdminClient()

  let q = admin
    .from('orders')
    .select('id')
    .eq('customer_id', customer_id)
    .eq('delivery_date', delivery_date)
    .neq('status', 'cancelled')
  q = destination_id ? q.eq('destination_id', destination_id) : q.is('destination_id', null)
  const { data: orders, error: ordersErr } = await q
  // DBエラーを「既存注文なし」に化けさせない。
  if (ordersErr) return NextResponse.json({ error: ordersErr.message }, { status: 500 })
  const orderIds = (orders ?? []).map((o) => o.id as string)
  if (orderIds.length === 0) return NextResponse.json({ items: [] })

  const { data: items, error: itemsErr } = await admin
    .from('order_items')
    .select('product_id, quantity')
    .in('order_id', orderIds)
  if (itemsErr) return NextResponse.json({ error: itemsErr.message }, { status: 500 })

  // 商品別に数量を合計（同キーに複数注文があっても合算して「現在の記録値」とする）
  const byProduct = new Map<string, number>()
  for (const it of items ?? []) {
    const pid = it.product_id as string
    byProduct.set(pid, (byProduct.get(pid) ?? 0) + Number(it.quantity))
  }

  return NextResponse.json({
    items: [...byProduct.entries()].map(([product_id, quantity]) => ({ product_id, quantity })),
  })
}
