import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { calculateChainInventory, sumDailyBoxes, type ChainBoxItem } from './chain'

describe('calculateChainInventory', () => {
  it('連鎖的キャリーオーバー：金曜の残在庫が土日（注文0件）を跨いで月曜日に引き継がれる', async () => {
    // 2026-10-16 (金): 手動で在庫10箱設定、注文6箱 -> 残4箱
    // 2026-10-17 (土): 注文0箱 -> 残4箱
    // 2026-10-18 (日): 注文0箱 -> 残4箱
    // 2026-10-19 (月): 4箱が引き継がれているべき
    const mockSupabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            gte: () => ({
              lte: () => ({
                order: () => Promise.resolve({
                  data: [
                    { target_date: '2026-10-16', stock_containers: 10, carryover_to_next_day: null },
                  ],
                }),
              }),
            }),
            in: () => Promise.resolve({
              data: [
                { order_id: 'ord-1', quantity: 120, product_id: 'p-1' }, // 120 / 20 = 6箱
              ],
            }),
            maybeSingle: () => Promise.resolve({ data: { container_capacity: 20 } }),
          }),
          gte: () => ({
            lt: () => ({
              in: () => Promise.resolve({
                data: [
                  { id: 'ord-1', delivery_date: '2026-10-16' },
                ],
              }),
              neq: () => Promise.resolve({
                data: [
                  { id: 'ord-1', delivery_date: '2026-10-16' },
                ],
              }),
            }),
          }),
        }),
      }),
    } as unknown as SupabaseClient

    const res = await calculateChainInventory(mockSupabase, 'p-1', '2026-10-19', 7)

    expect(res.inheritedCarryover).toBe(4) // 10 - 6 = 4箱
    expect(res.effectiveStock).toBe(4)
    expect(res.hasManualStock).toBe(false)
  })

  it('手動補正アンカー：途中の日付で手動修正があった場合、そこから再計算されて以降に波及する', async () => {
    // 2026-10-16 (金): 手動10箱
    // 2026-10-17 (土): 現場で傷み発見、手動で5箱に修正
    // 2026-10-18 (日): 注文0
    // 2026-10-19 (月): 土曜の5箱が引き継がれる
    const mockSupabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            gte: () => ({
              lte: () => ({
                order: () => Promise.resolve({
                  data: [
                    { target_date: '2026-10-16', stock_containers: 10, carryover_to_next_day: null },
                    { target_date: '2026-10-17', stock_containers: 5, carryover_to_next_day: null },
                  ],
                }),
              }),
            }),
            in: () => Promise.resolve({ data: [] }),
            maybeSingle: () => Promise.resolve({ data: { container_capacity: 20 } }),
          }),
          gte: () => ({
            lt: () => ({
              in: () => Promise.resolve({ data: [] }),
              neq: () => Promise.resolve({ data: [] }),
            }),
          }),
        }),
      }),
    } as unknown as SupabaseClient

    const res = await calculateChainInventory(mockSupabase, 'p-1', '2026-10-19', 7)

    expect(res.inheritedCarryover).toBe(5)
    expect(res.effectiveStock).toBe(5)
  })
})

describe('sumDailyBoxes（収穫・パックボードと同じ入数で箱数を数える）', () => {
  const base = { order_id: 'o', delivery_date: '2026-10-16', product_id: 'p-1' }
  const item = (over: Partial<ChainBoxItem>): ChainBoxItem => ({ ...base, customer_id: 'c-1', quantity: 48, ...over })

  it('取引先別の設定があればそれを使う（荷姿・品目の標準より優先）', () => {
    const r = sumDailyBoxes([item({ pack_config_id: 'pk-30' })], {
      productId: 'p-1',
      product: { container_capacity: 50 },
      rules: [{ id: 'r-1', customer_id: 'c-1', product_id: 'p-1', packs_per_case: 24 }],
      packs: [{ id: 'pk-30', product_id: 'p-1', customer_id: 'c-1', base_per_selling: 30 }],
    })
    expect(r.get('2026-10-16')).toBe(2) // 48 / 24
  })

  it('明細の荷姿 → 取引先専用 → 取引先共通 → 品目の標準 → 20 の順', () => {
    const packs = [
      { id: 'pk-line', product_id: 'p-1', customer_id: null, base_per_selling: 16 },
      { id: 'pk-cust', product_id: 'p-1', customer_id: 'c-1', base_per_selling: 12 },
    ]
    const ctx = { productId: 'p-1', product: { container_capacity: 40 }, rules: [], packs }
    // 明細の荷姿 16 → 48/16 = 3
    expect(sumDailyBoxes([item({ pack_config_id: 'pk-line' })], ctx).get('2026-10-16')).toBe(3)
    // 荷姿なし → 取引先専用 12 → 4
    expect(sumDailyBoxes([item({})], ctx).get('2026-10-16')).toBe(4)
    // 別の取引先 → 取引先共通 16 → 3
    expect(sumDailyBoxes([item({ customer_id: 'c-2' })], ctx).get('2026-10-16')).toBe(3)
    // 荷姿なし → 品目の標準 40 → ceil(48/40) = 2
    expect(sumDailyBoxes([item({})], { ...ctx, packs: [] }).get('2026-10-16')).toBe(2)
    // 何も無ければ 20 → ceil(48/20) = 3
    expect(sumDailyBoxes([item({})], { ...ctx, packs: [], product: null }).get('2026-10-16')).toBe(3)
  })

  it('取引先名や規格の文字列からは推測しない（NSK・「入数24」でも 20）', () => {
    const r = sumDailyBoxes([item({ customer_id: 'nsk', quantity: 48 })], {
      productId: 'p-1',
      product: null,
      rules: [],
      packs: [],
    })
    expect(r.get('2026-10-16')).toBe(3)
  })

  it('明細の rule_id が指すルールを取引先のルールより先に使う', () => {
    const r = sumDailyBoxes([item({ rule_id: 'r-2' })], {
      productId: 'p-1',
      product: null,
      rules: [
        { id: 'r-1', customer_id: 'c-1', product_id: 'p-1', packs_per_case: 12 },
        { id: 'r-2', customer_id: 'c-9', product_id: 'p-1', packs_per_case: 24 },
      ],
      packs: [],
    })
    expect(r.get('2026-10-16')).toBe(2)
  })

  it('明細ごとに切り上げて日ごとに合計する', () => {
    const r = sumDailyBoxes(
      [item({ quantity: 25 }), item({ quantity: 5 }), item({ quantity: 20, delivery_date: '2026-10-17' })],
      { productId: 'p-1', product: null, rules: [], packs: [] },
    )
    expect(r.get('2026-10-16')).toBe(3) // 2 + 1
    expect(r.get('2026-10-17')).toBe(1)
  })
})
