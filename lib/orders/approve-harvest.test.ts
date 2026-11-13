import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { approveOrder } from './approve'
import { createFakeSupabase, filterValue, type FakeCall, type FakeResult } from '@/tests/support/fake-supabase'
import { harvestTable, type HarvestRow } from '@/tests/support/harvest-table'

/**
 * 承認で作る収穫タスクは「1明細1件」（lib/harvest/upsert-tasks.ts）。
 * 取り込み（process-receipt）で承認済みの注文が「要確認」の追加FAXで承認待ちに戻り、
 * 既存の収穫タスクが残ったまま再承認されても、タスクを増やさず数量・日付だけ更新し、進捗は残す。
 */
const ORDER = 'order-1'

function setup(opts: { tasks?: HarvestRow[]; existingOrder?: { id: string; note: string | null }; existingItems?: Record<string, unknown>[] } = {}) {
  const order: Record<string, unknown> = {
    id: ORDER, customer_id: 'cust-1', status: 'pending_review', delivery_date: '2026-11-10', destination_id: null, note: null, source: 'fax', intake_channel: null,
  }
  const items: Record<string, unknown>[] = [
    { id: 'i1', product_id: 'p1', product_name: 'チンゲン菜', quantity: 30, confidence: 1, pack_config_id: null, spec: null, container_type: null, has_card: null, line_note: null },
  ]
  const table = harvestTable(opts.tasks ?? [])
  const resolver = (c: FakeCall): FakeResult | undefined => {
    const h = table.resolve(c)
    if (h) return h
    if (c.table === 'orders') {
      if (c.op === 'select' && c.terminal === 'maybeSingle') return { data: { ...order } }
      if (c.op === 'update' && filterValue(c, 'eq', 'status') === 'pending_review') {
        if (order.status !== 'pending_review') return { data: null }
        Object.assign(order, c.payload as Record<string, unknown>)
        return { data: { id: ORDER } }
      }
      if (c.op === 'select') return { data: opts.existingOrder ? [opts.existingOrder] : [] }
      return { data: null }
    }
    if (c.table === 'order_items' && c.op === 'select') {
      return { data: filterValue(c, 'eq', 'order_id') === ORDER ? items.map((x) => ({ ...x })) : opts.existingItems ?? [] }
    }
    if (c.table === 'customers') return { data: { channel_identifiers: {} } }
    return { data: null }
  }
  const fake = createFakeSupabase(resolver)
  const approve = () => approveOrder(fake.client as unknown as SupabaseClient, { orderId: ORDER, role: 'admin', userId: 'u1' })
  return { fake, order, items, table, approve }
}

describe('承認と収穫タスク（1明細1件）', () => {
  it('既存の収穫タスクが無ければ、出荷日の前日で作る', async () => {
    const s = setup()
    const r = await s.approve()
    expect(r).toMatchObject({ ok: true, tasksCreated: 1 })
    expect(s.table.rows).toEqual([
      expect.objectContaining({ order_item_id: 'i1', required_qty: 30, task_date: '2026-11-09', status: 'not_started' }),
    ])
  })

  it('既存の収穫タスクがある明細は insert せず、数量・日付だけ更新して進捗は残す', async () => {
    const s = setup({
      tasks: [{ id: 't1', product_id: 'p1', order_item_id: 'i1', required_qty: 20, task_date: '2026-11-05', status: 'packing', assigned_to: 'staff-1' }],
    })
    const r = await s.approve()
    expect(r.ok).toBe(true)
    expect(s.fake.calls.some((c) => c.table === 'harvest_tasks' && c.op === 'insert')).toBe(false)
    expect(s.table.rows).toEqual([
      { id: 't1', product_id: 'p1', order_item_id: 'i1', required_qty: 30, task_date: '2026-11-09', status: 'packing', assigned_to: 'staff-1' },
    ])
  })

  it('取り込みで承認済み→承認待ちに戻った注文を再承認しても、収穫タスクは二重にならない', async () => {
    const s = setup()
    expect((await s.approve()).ok).toBe(true)
    expect(s.table.rows).toHaveLength(1)
    // 現場が作業を進める
    s.table.rows[0]!.status = 'harvesting'

    // 追加FAX（要確認）の取り込み: 数量が変わり、注文は承認待ちに戻る。収穫タスクは残ったまま
    s.items[0]!.quantity = 45
    s.order.status = 'pending_review'

    const r2 = await s.approve()
    expect(r2.ok).toBe(true)
    expect(s.table.rows).toHaveLength(1)
    expect(s.table.rows[0]).toMatchObject({ order_item_id: 'i1', required_qty: 45, task_date: '2026-11-09', status: 'harvesting' })
    expect(s.fake.calls.filter((c) => c.table === 'harvest_tasks' && c.op === 'insert')).toHaveLength(1)
  })

  it('納品日が変わって再承認されたら、収穫日も新しい納品日の前日に移す', async () => {
    const s = setup()
    await s.approve()
    s.order.status = 'pending_review'
    s.order.delivery_date = '2026-11-12'
    await s.approve()
    expect(s.table.rows).toHaveLength(1)
    expect(s.table.rows[0]!.task_date).toBe('2026-11-11')
  })

  it('統合（既存注文へ明細を移す）でも、移す明細に既存タスクがあれば増やさない', async () => {
    const s = setup({
      existingOrder: { id: 'order-old', note: null },
      // 既存注文に同じ品目が無い → 明細 i1 を既存注文へ移す経路
      existingItems: [
        { id: 'e9', product_id: 'p9', product_name: '小松菜', quantity: 10, version: 1, field_status: 'not_started', line_note: null, shipped_qty: null },
      ],
      tasks: [{ id: 't1', product_id: 'p1', order_item_id: 'i1', required_qty: 30, task_date: '2026-11-09', status: 'packing', assigned_to: null }],
    })
    const r = await s.approve()
    expect(r).toMatchObject({ ok: true, mergedIntoOrderId: 'order-old' })
    expect(s.table.rows).toHaveLength(1)
    expect(s.table.rows[0]).toMatchObject({ id: 't1', status: 'packing' })
    expect(s.fake.calls.some((c) => c.table === 'harvest_tasks' && c.op === 'insert')).toBe(false)
  })
})
