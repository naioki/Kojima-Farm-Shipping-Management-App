import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { shiftDateStr } from '@/lib/dates'

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

export type FallbackInventoryRecord = Record<
  string,
  { stock_containers?: number | null; carryover_to_next_day?: number | null; updated_at?: string }
>

/**
 * 0026未適用環境（daily_container_inventory不在）用の在庫フォールバック読み込み
 */
export async function readFallbackInventory(
  admin: SupabaseClient,
  productId: string,
): Promise<FallbackInventoryRecord> {
  try {
    const res = await admin
      .from('app_settings')
      .select('value')
      .eq('key', `v5_container_inv:${productId}`)
      .maybeSingle()
    if (!res?.data?.value) return {}
    return JSON.parse(res.data.value) as FallbackInventoryRecord
  } catch {
    return {}
  }
}

/**
 * 0026未適用環境（daily_container_inventory不在）用の在庫フォールバック書き込み
 */
export async function writeFallbackInventory(
  admin: SupabaseClient,
  productId: string,
  date: string,
  patch: { stock_containers?: number | null; carryover_to_next_day?: number | null },
): Promise<void> {
  const existing = await readFallbackInventory(admin, productId)
  const current = existing[date] ?? {}
  existing[date] = {
    ...current,
    ...(patch.stock_containers !== undefined ? { stock_containers: patch.stock_containers } : {}),
    ...(patch.carryover_to_next_day !== undefined ? { carryover_to_next_day: patch.carryover_to_next_day } : {}),
    updated_at: new Date().toISOString(),
  }
  await admin
    .from('app_settings')
    .upsert(
      {
        key: `v5_container_inv:${productId}`,
        value: JSON.stringify(existing),
        is_secret: false,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'key' },
    )
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
  const startDateStr = shiftDateStr(targetDate, -daysLookback)

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

  // 0026未適用環境（daily_container_inventory不在）または空の場合、app_settingsのフォールバックをマージ
  // ※ app_settings は admin_all RLSのため service_role (createAdminClient) を優先して読み込む
  try {
    let adminClient = supabase
    try {
      adminClient = createAdminClient()
    } catch {}
    const fallback = await readFallbackInventory(adminClient, productId)
    for (const [d, rec] of Object.entries(fallback)) {
      if (d >= startDateStr && d <= targetDate) {
        const existing = invByDate.get(d)
        invByDate.set(d, {
          stock_containers: existing?.stock_containers ?? rec.stock_containers ?? null,
          carryover_to_next_day: existing?.carryover_to_next_day ?? rec.carryover_to_next_day ?? null,
        })
      }
    }
  } catch {
    // 単体テスト等でのモック不在時は安全に無視
  }

  // 2. 過去14日間の注文・明細データを取得（日ごとの必要箱数を集計）
  const { data: pastOrders } = await supabase
    .from('orders')
    .select('id, delivery_date, customer_id')
    .gte('delivery_date', startDateStr)
    .lt('delivery_date', targetDate) // targetDate より前の過去日
    .neq('status', 'cancelled')

  const orderIds = (pastOrders ?? []).map((o) => o.id)
  const orderDateMap = new Map((pastOrders ?? []).map((o) => [o.id, o.delivery_date]))
  const orderCustMap = new Map((pastOrders ?? []).map((o) => [o.id, o.customer_id]))

  const dailyBoxesMap = new Map<string, number>()

  if (orderIds.length > 0) {
    type PastOrderItem = { order_id: string; quantity: number; product_id: string; pack_config_id: string | null; spec: string | null }
    type RuleItem = { customer_id: string; product_id: string; packs_per_case: number | null }
    type PackConfigItem = { id: string; base_per_selling: number }

    const pastItemsPromise = supabase
      .from('order_items')
      .select('order_id, quantity, product_id, pack_config_id, spec')
      .eq('product_id', productId)
      .in('order_id', orderIds)

    const prodPromise = supabase
      .from('products')
      .select('container_capacity')
      .eq('id', productId)
      .maybeSingle()

    // 顧客別ルール・荷姿マスタを安全に取得
    const rulesPromise = Promise.resolve(
      supabase.from('customer_product_rules').select('customer_id, product_id, packs_per_case').eq('product_id', productId)
    ).catch(() => ({ data: [] }))

    const packConfigsPromise = Promise.resolve(
      supabase.from('pack_configs').select('id, base_per_selling')
    ).catch(() => ({ data: [] }))

    const [{ data: pastItems }, { data: prod }, rulesRes, packRes] = await Promise.all([
      pastItemsPromise,
      prodPromise,
      rulesPromise,
      packConfigsPromise,
    ])

    const defaultCapacity = prod?.container_capacity ?? 20
    const ruleByCust = new Map(((rulesRes?.data ?? []) as RuleItem[]).map((r) => [r.customer_id, r.packs_per_case]))
    const packMap = new Map(((packRes?.data ?? []) as PackConfigItem[]).map((p) => [p.id, Number(p.base_per_selling)]))

    for (const it of ((pastItems ?? []) as PastOrderItem[])) {
      const d = orderDateMap.get(it.order_id)
      if (!d) continue
      const custId = orderCustMap.get(it.order_id)

      const packBase = it.pack_config_id ? packMap.get(it.pack_config_id) : null
      const rulePacks = custId ? ruleByCust.get(custId) : null

      let perCase = packBase || rulePacks || defaultCapacity || 20
      if ((it.spec ?? '').includes('24')) {
        perCase = 24
      }

      const boxes = Math.ceil(it.quantity / (perCase > 0 ? perCase : 20))
      dailyBoxesMap.set(d, (dailyBoxesMap.get(d) ?? 0) + boxes)
    }
  }

  // 3. startDateStr から targetDate まで日跨ぎで連鎖推移シミュレーション
  let runningStock = 0
  let prevCarryover = 0
  let curDateStr = startDateStr

  while (curDateStr <= targetDate) {
    const inv = invByDate.get(curDateStr)

    // 手動入力値があれば最優先でアンカー設定
    if (inv?.stock_containers != null) {
      runningStock = Math.max(0, inv.stock_containers)
    }

    // targetDate に到達したら、直前の日の残りが inheritedCarryover となる
    if (curDateStr === targetDate) {
      prevCarryover = runningStock
      break
    }

    // 明示的な翌朝持ち越しがある場合はそれを使用、なければ注文引き当て後の残り
    if (inv?.carryover_to_next_day != null) {
      runningStock = Math.max(0, inv.carryover_to_next_day)
    } else {
      const orderedToday = dailyBoxesMap.get(curDateStr) ?? 0
      runningStock = Math.max(0, runningStock - orderedToday)
    }

    // 翌日へ進める
    curDateStr = shiftDateStr(curDateStr, 1)
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
