import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { calculateChainInventory } from './chain'

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
