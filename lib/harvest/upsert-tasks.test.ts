import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { upsertHarvestTasks } from './upsert-tasks'
import { createFakeSupabase } from '@/tests/support/fake-supabase'
import { harvestTable } from '@/tests/support/harvest-table'

const plan = { product_id: 'p1', order_item_id: 'i1', required_qty: 40, task_date: '2026-11-09' }

describe('upsertHarvestTasks（収穫タスクは1明細1件）', () => {
  it('既存タスクが無ければ作る', async () => {
    const t = harvestTable()
    const fake = createFakeSupabase(t.resolve)
    const r = await upsertHarvestTasks(fake.client as unknown as SupabaseClient, [plan])
    expect(r).toEqual({ created: 1, updated: 0, error: null })
    expect(t.rows).toHaveLength(1)
    expect(t.rows[0]).toMatchObject({ order_item_id: 'i1', required_qty: 40, task_date: '2026-11-09', status: 'not_started' })
  })

  it('既存タスクがあれば insert せず、数量・日付だけ更新して進捗（status・担当）は残す', async () => {
    const t = harvestTable([
      { id: 't1', product_id: 'p1', order_item_id: 'i1', required_qty: 30, task_date: '2026-11-08', status: 'packing', assigned_to: 'u9' },
    ])
    const fake = createFakeSupabase(t.resolve)
    const r = await upsertHarvestTasks(fake.client as unknown as SupabaseClient, [plan])
    expect(r).toEqual({ created: 0, updated: 1, error: null })
    expect(fake.calls.some((c) => c.table === 'harvest_tasks' && c.op === 'insert')).toBe(false)
    const upd = fake.calls.find((c) => c.table === 'harvest_tasks' && c.op === 'update')!
    expect(upd.payload).toEqual({ product_id: 'p1', required_qty: 40, task_date: '2026-11-09' })
    expect(t.rows).toEqual([
      { id: 't1', product_id: 'p1', order_item_id: 'i1', required_qty: 40, task_date: '2026-11-09', status: 'packing', assigned_to: 'u9' },
    ])
  })

  it('同じ内容なら書き込まない', async () => {
    const t = harvestTable([{ id: 't1', ...plan, status: 'completed', assigned_to: null }])
    const fake = createFakeSupabase(t.resolve)
    const r = await upsertHarvestTasks(fake.client as unknown as SupabaseClient, [plan])
    expect(r).toEqual({ created: 0, updated: 1, error: null })
    expect(fake.calls.filter((c) => c.table === 'harvest_tasks' && c.op !== 'select')).toHaveLength(0)
  })

  it('既存と新規が混ざっていても、既存は更新・無いものだけ作る（何度呼んでも1明細1件）', async () => {
    const t = harvestTable([
      { id: 't1', product_id: 'p1', order_item_id: 'i1', required_qty: 30, task_date: '2026-11-09', status: 'harvesting', assigned_to: null },
    ])
    const fake = createFakeSupabase(t.resolve)
    const plans = [plan, { product_id: 'p2', order_item_id: 'i2', required_qty: 5, task_date: '2026-11-09' }]
    await upsertHarvestTasks(fake.client as unknown as SupabaseClient, plans)
    await upsertHarvestTasks(fake.client as unknown as SupabaseClient, plans)
    expect(t.rows.map((r) => r.order_item_id).sort()).toEqual(['i1', 'i2'])
    expect(t.rows.find((r) => r.order_item_id === 'i1')).toMatchObject({ required_qty: 40, status: 'harvesting' })
  })

  it('一意制約がある環境で同時に作られていたら（23505）、更新に切り替えて二重にしない', async () => {
    // 読んだ時点では無かったが、insert の直前に別の処理が作った状況
    const t = harvestTable([], { unique: true })
    let raced = false
    const fake = createFakeSupabase((c) => {
      if (c.table === 'harvest_tasks' && c.op === 'insert' && !raced) {
        raced = true
        t.rows.push({ id: 't-other', product_id: 'p1', order_item_id: 'i1', required_qty: 30, task_date: '2026-11-08', status: 'packing', assigned_to: null })
      }
      return t.resolve(c)
    })
    const r = await upsertHarvestTasks(fake.client as unknown as SupabaseClient, [
      plan,
      { product_id: 'p2', order_item_id: 'i2', required_qty: 5, task_date: '2026-11-09' },
    ])
    expect(r.error).toBeNull()
    expect(r).toMatchObject({ created: 1, updated: 1 })
    expect(t.rows).toHaveLength(2)
    expect(t.rows.find((x) => x.order_item_id === 'i1')).toMatchObject({ id: 't-other', required_qty: 40, status: 'packing' })
  })

  it('一意制約が無い環境で既に重複している明細は、重複行すべての数量・日付をそろえる（行は増やさない）', async () => {
    const t = harvestTable([
      { id: 'a', product_id: 'p1', order_item_id: 'i1', required_qty: 30, task_date: '2026-11-08', status: 'packing', assigned_to: null },
      { id: 'b', product_id: 'p1', order_item_id: 'i1', required_qty: 30, task_date: '2026-11-08', status: 'not_started', assigned_to: null },
    ])
    const fake = createFakeSupabase(t.resolve)
    await upsertHarvestTasks(fake.client as unknown as SupabaseClient, [plan])
    expect(t.rows).toHaveLength(2)
    expect(t.rows.every((r) => r.required_qty === 40 && r.task_date === '2026-11-09')).toBe(true)
    expect(t.rows.map((r) => r.status)).toEqual(['packing', 'not_started'])
  })

  it('既存の読み込みに失敗したら、二重登録を避けるため何も作らず error を返す', async () => {
    const t = harvestTable([], { selectError: 'db down' })
    const fake = createFakeSupabase(t.resolve)
    const r = await upsertHarvestTasks(fake.client as unknown as SupabaseClient, [plan])
    expect(r.error?.message).toBe('db down')
    expect(fake.calls.some((c) => c.table === 'harvest_tasks' && c.op === 'insert')).toBe(false)
  })

  it('insert の失敗（23505 以外）は error で返す', async () => {
    const fake = createFakeSupabase((c) =>
      c.table === 'harvest_tasks' && c.op === 'insert' ? { error: { message: 'boom', code: '23503' } } : undefined,
    )
    const r = await upsertHarvestTasks(fake.client as unknown as SupabaseClient, [plan])
    expect(r).toMatchObject({ created: 0, error: { message: 'boom', code: '23503' } })
  })
})
