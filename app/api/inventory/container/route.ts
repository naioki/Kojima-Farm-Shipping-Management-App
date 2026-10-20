import { NextRequest, NextResponse } from 'next/server'
import { getAuthedUser } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { calculateChainInventory } from '@/lib/inventory/chain'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * コンテナ在庫＆翌日持ち越し保存 API
 * GET: 指定日・品目の連鎖キャリーオーバー在庫と手動設定値を取得
 * POST: 在庫コンテナ数 (stock_containers) や翌日持ち越し (carryover_to_next_day) を更新
 */
export async function GET(req: NextRequest) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const date = req.nextUrl.searchParams.get('date')
  const productId = req.nextUrl.searchParams.get('productId')
  if (!date || !productId) {
    return NextResponse.json({ error: 'date and productId required' }, { status: 400 })
  }

  const admin = createAdminClient()

  // 14日間の連鎖在庫計算
  const chain = await calculateChainInventory(admin, productId, date, 14)

  // 当日レコード
  const { data: current } = await admin
    .from('daily_container_inventory')
    .select('*')
    .eq('target_date', date)
    .eq('product_id', productId)
    .maybeSingle()

  return NextResponse.json({
    ok: true,
    current,
    prevCarryover: chain.inheritedCarryover,
    effectiveStock: chain.effectiveStock,
    hasManualStock: chain.hasManualStock,
    manualStock: chain.manualStock,
  })
}

export async function POST(req: NextRequest) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const { date, productId, stockContainers, carryoverToNextDay } = body
  if (!date || !productId) {
    return NextResponse.json({ error: 'date and productId required' }, { status: 400 })
  }

  const admin = createAdminClient()

  const payload: Record<string, unknown> = {
    target_date: date,
    product_id: productId,
    updated_at: new Date().toISOString(),
  }
  if (stockContainers !== undefined) payload.stock_containers = Math.max(0, Number(stockContainers) || 0)
  if (carryoverToNextDay !== undefined) payload.carryover_to_next_day = Math.max(0, Number(carryoverToNextDay) || 0)

  const { data, error } = await admin
    .from('daily_container_inventory')
    .upsert(payload, { onConflict: 'target_date,product_id' })
    .select()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, data: data?.[0] })
}