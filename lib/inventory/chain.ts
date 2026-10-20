import type { SupabaseClient } from '@supabase/supabase-js'

export interface ChainInventoryResult {
  /** 基準日の有効開始在庫（手動設定値があればそれ、なければ過去からの累積自動繰越） */
  effectiveStock: number
  /** 前日終了時点からの引き継ぎ在庫数（連鎖キャリーオーバー） */
  inheritedCarryover: number
  /** 当日の手動設定値が存在するか */
  hasManualStock: boolean
  /** 当日の手動指定値（設定されている場合） */
  manualStock: number | null
}

function toISODateString(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/**
 * 過去の日付（デフォルト14日間）の在庫手動設定と注文出荷実績から、日跨ぎの連鎖キャリーオーバー在庫を算出する。
 * - 週末・祝日や出荷のない日を挟んでも、未消化分が翌日・翌々日以降へ連続して自動波及する。
 * - 途中の日付で手動設定（実在庫カウント）があれば、そこをアンカー（起点）として以降の日程へ引き継ぐ。
 * - `基準日の開始在庫 ＝ 直前終了時点の残在庫（手動設定値または注文消化後の残存在庫）`
 */
export async function calculateChainInventory(
  supabase: SupabaseClient,
  productId: string,
  targetDate: string,
  daysLookback = 14,
): Promise<ChainInventoryResult> {
  const target = new Date(targetDate)
  const start = new Date(target)
  start.setDate(start.getDate() - daysLookback)
  const startDateStr = toISODateString(start)

  // 1. 過去14日間の在庫レコード（手動在庫・持ち越し）を取得
  const { data: invRows } = await supabase
    .from('daily_container_inventory')
    .select('target_date, stock_containers, carryover_to_next_day')
    .eq('product_id', productId)
    .gte('target_date', startDateStr)
    .lte('target_date', targetDate)
    .order('target_date', { ascending: true })

  const invByDate = new Map<
    string,
    { stock_containers: number | null; carryover_to_next_day: number | null }
  >()
  for (const r of invRows ?? []) {
    invByDate.set(r.target_date, {
      stock_containers: r.stock_containers,
      carryover_to_next_day: r.carryover_to_next_day,
    })
  }

  // 2. 過去14日間の注文・明細データを取得（日ごとの必要箱数を集計）
  const { data: pastOrders } = await supabase
    .from('orders')
    .select('id, delivery_date')
    .gte('delivery_date', startDateStr)
    .lt('delivery_date', targetDate) // targetDate より前の過去日
    .neq('status', 'cancelled')

  const orderIds = (pastOrders ?? []).map((o) => o.id)
  const orderDateMap = new Map((pastOrders ?? []).map((o) => [o.id, o.delivery_date]))

  const dailyBoxesMap = new Map<string, number>()

  if (orderIds.length > 0) {
    const [{ data: pastItems }, { data: prod }] = await Promise.all([
      supabase
        .from('order_items')
        .select('order_id, quantity, product_id, pack_config_id')
        .eq('product_id', productId)
        .in('order_id', orderIds),
      supabase
        .from('products')
        .select('container_capacity')
        .eq('id', productId)
        .maybeSingle(),
    ])

    const defaultCapacity = prod?.container_capacity ?? 20

    for (const it of pastItems ?? []) {
      const d = orderDateMap.get(it.order_id)
      if (!d) continue
      const perCase = defaultCapacity > 0 ? defaultCapacity : 20
      const boxes = Math.ceil(it.quantity / perCase)
      dailyBoxesMap.set(d, (dailyBoxesMap.get(d) ?? 0) + boxes)
    }
  }

  // 3. startDate から targetDate まで日跨ぎで連鎖推移シミュレーション
  let runningStock = 0
  let prevCarryover = 0

  const cur = new Date(startDateStr)
  while (toISODateString(cur) <= targetDate) {
    const dStr = toISODateString(cur)
    const inv = invByDate.get(dStr)

    // 手動入力値があれば最優先でアンカー設定
    if (inv?.stock_containers != null) {
      runningStock = Math.max(0, inv.stock_containers)
    }

    // targetDate に到達したら、直前の日の残りが inheritedCarryover となる
    if (dStr === targetDate) {
      prevCarryover = runningStock
      break
    }

    // 明示的な翌朝持ち越しがある場合はそれを使用、なければ注文引き当て後の残り
    if (inv?.carryover_to_next_day != null) {
      runningStock = Math.max(0, inv.carryover_to_next_day)
    } else {
      const orderedToday = dailyBoxesMap.get(dStr) ?? 0
      runningStock = Math.max(0, runningStock - orderedToday)
    }

    // 翌日へ進める
    cur.setDate(cur.getDate() + 1)
  }

  const currentDayInv = invByDate.get(targetDate)
  const hasManual = currentDayInv?.stock_containers != null
  const effectiveStock = hasManual ? currentDayInv.stock_containers! : prevCarryover

  return {
    effectiveStock,
    inheritedCarryover: prevCarryover,
    hasManualStock: hasManual,
    manualStock: hasManual ? currentDayInv.stock_containers! : null,
  }
}
