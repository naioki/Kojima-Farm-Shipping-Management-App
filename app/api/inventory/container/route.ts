import { NextRequest, NextResponse } from 'next/server'
import { createClient, getAuthedUser } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * 冷蔵庫コンテナ在庫＆翌日持ち越し保存 API
 * GET: 指定日・品目の在庫と前日からの持ち越しを取得
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

  const supabase = createClient()

  // 当日分
  const { data: current } = await supabase
    .from('daily_container_inventory')
    .select('*')
    .eq('target_date', date)
    .eq('product_id', productId)
    .maybeSingle()

  // 前日分（持ち越し取得用）
  const prevDate = new Date(date)
  prevDate.setDate(prevDate.getDate() - 1)
  const prevDateStr = prevDate.toISOString().split('T')[0]

  const { data: prev } = await supabase
    .from('daily_container_inventory')
    .select('carryover_to_next_day')
    .eq('target_date', prevDateStr)
    .eq('product_id', productId)
    .maybeSingle()

  const defaultStock = current?.stock_containers ?? prev?.carryover_to_next_day ?? 0

  return NextResponse.json({
    ok: true,
    current,
    prevCarryover: prev?.carryover_to_next_day ?? 0,
    effectiveStock: defaultStock,
  })
}

export async function POST(req: NextRequest) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json()
  const { date, productId, stockContainers, carryoverToNextDay } = body
  if (!date || !productId) {
    return NextResponse.json({ error: 'date and productId required' }, { status: 400 })
  }

  const supabase = createClient()

  const payload: Record<string, unknown> = {
    target_date: date,
    product_id: productId,
    updated_at: new Date().toISOString(),
  }
  if (stockContainers !== undefined) payload.stock_containers = Number(stockContainers) || 0
  if (carryoverToNextDay !== undefined) payload.carryover_to_next_day = Number(carryoverToNextDay) || 0

  const { data, error } = await supabase
    .from('daily_container_inventory')
    .upsert(payload, { onConflict: 'target_date,product_id' })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, data })
}
