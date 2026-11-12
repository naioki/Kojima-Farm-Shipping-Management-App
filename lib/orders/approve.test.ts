import { describe, it, expect, vi, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { approveOrder } from './approve'
import { createFakeSupabase, filterValue, type FakeCall, type FakeResult } from '@/tests/support/fake-supabase'

/**
 * 承認の業務フロー（DB不要の通しテスト）:
 *   納入先ゲート → 二重承認の防止 → 収穫タスク生成 / 既存注文への統合（上書き＋履歴）
 */
const ORDER = 'order-new'
const CUST = 'cust-1'

type Scenario = {
  order?: Record<string, unknown>
  items?: Record<string, unknown>[]
  dests?: { id: string; code: string | null; full_name: string; aliases: string[] }[]
  customerChannel?: Record<string, unknown>
  claimOk?: boolean
  existingOrder?: { id: string; note: string | null } | null
  existingItems?: Record<string, unknown>[]
  harvestInsertError?: string
  /** 付随更新の失敗（承認は成功のまま warnings で返ることを確かめる） */
  receiptsUpdateError?: string
  auditError?: string
  mergeSourceDeleteError?: string
}

function setup(s: Scenario) {
  const order = { id: ORDER, customer_id: CUST, status: 'pending_review', delivery_date: '2026-11-10', destination_id: null, note: null, ...s.order }
  const items = s.items ?? [
    { id: 'n1', product_id: 'p1', product_name: 'チンゲン菜', quantity: 30, confidence: 1, pack_config_id: null, spec: null, container_type: null, has_card: null, line_note: null },
  ]
  const resolver = (c: FakeCall): FakeResult | undefined => {
    if (c.table === 'orders') {
      if (c.op === 'select' && c.terminal === 'maybeSingle') return { data: order }
      if (c.op === 'update' && filterValue(c, 'eq', 'status') === 'pending_review') {
        return { data: s.claimOk === false ? null : { id: ORDER } }
      }
      if (c.op === 'select') return { data: s.existingOrder ? [s.existingOrder] : [] }
      if (c.op === 'delete' && s.mergeSourceDeleteError) return { error: { message: s.mergeSourceDeleteError } }
      return { data: null }
    }
    if (c.table === 'order_items' && c.op === 'select') {
      return { data: filterValue(c, 'eq', 'order_id') === ORDER ? items : s.existingItems ?? [] }
    }
    if (c.table === 'delivery_destinations') return { data: s.dests ?? [] }
    if (c.table === 'customers') return { data: { channel_identifiers: s.customerChannel ?? {} } }
    if (c.table === 'pack_configs') return { data: [] }
    if (c.table === 'order_receipts' && c.op === 'update' && s.receiptsUpdateError) {
      return { error: { message: s.receiptsUpdateError } }
    }
    if (c.table === 'audit_log' && c.op === 'insert' && s.auditError) return { error: { message: s.auditError } }
    if (c.table === 'harvest_tasks' && c.op === 'insert' && s.harvestInsertError) {
      return { error: { message: s.harvestInsertError } }
    }
    return { data: null }
  }
  return createFakeSupabase(resolver)
}

const run = (fake: ReturnType<typeof setup>, extra: Record<string, unknown> = {}) =>
  approveOrder(fake.client as unknown as SupabaseClient, { orderId: ORDER, role: 'admin', userId: 'u1', ...extra })

const twoDests = [
  { id: 'd1', code: 'ABC店', full_name: 'ABCスーパー 本店', aliases: [] },
  { id: 'd2', code: 'XYZ店', full_name: 'XYZセンター', aliases: [] },
]

describe('approveOrder（承認の通しフロー）', () => {
  it('承認すると approved・承認時刻を記録し、出荷前日の収穫タスクを作る', async () => {
    const fake = setup({})
    const r = await run(fake)
    expect(r).toMatchObject({ ok: true, tasksCreated: 1, deliveryDate: '2026-11-10' })
    const claim = fake.calls.find((c) => c.table === 'orders' && c.op === 'update')!
    expect(claim.payload).toMatchObject({ status: 'approved', approved_by: 'u1' })
    expect((claim.payload as { approved_at?: string }).approved_at).toBeTruthy()
    const task = fake.calls.find((c) => c.table === 'harvest_tasks' && c.op === 'insert')!
    expect(task.payload).toEqual([expect.objectContaining({ order_item_id: 'n1', task_date: '2026-11-09' })])
  })

  it('同時に2回押されても、2回目は 409 で収穫タスクを重複させない', async () => {
    const fake = setup({ claimOk: false })
    const r = await run(fake)
    expect(r).toMatchObject({ ok: false, status: 409 })
    expect(fake.calls.some((c) => c.table === 'harvest_tasks')).toBe(false)
  })

  it('納入先が複数あり特定できなければ承認しない（納入先ゲート）', async () => {
    const fake = setup({ dests: twoDests })
    const r = await run(fake)
    expect(r).toMatchObject({ ok: false, status: 400, reason: 'destination_required' })
    expect(fake.calls.some((c) => c.table === 'orders' && c.op === 'update')).toBe(false)
  })

  it('「納入先なし」を明示すれば承認できる', async () => {
    const r = await run(setup({ dests: twoDests }), { noDestination: true })
    expect(r.ok).toBe(true)
  })

  it('取引先設定「納入先を指定しない」がオンならゲートを飛ばす', async () => {
    const r = await run(setup({ dests: twoDests, customerChannel: { skip_destination_gate: true } }))
    expect(r.ok).toBe(true)
  })

  it('収穫タスクの作成に失敗したら承認を取り消す', async () => {
    const fake = setup({ harvestInsertError: 'boom' })
    const r = await run(fake)
    expect(r).toMatchObject({ ok: false, status: 500 })
    const revert = fake.calls.filter((c) => c.table === 'orders' && c.op === 'update').pop()!
    expect(revert.payload).toMatchObject({ status: 'pending_review', approved_at: null })
  })

  it('追加FAXの統合: 数量は上書きし、旧数量を明細メモと履歴に残す。出荷済みの明細は上書きしない', async () => {
    const fake = setup({
      items: [
        { id: 'n1', product_id: 'p1', product_name: 'チンゲン菜', quantity: 58, confidence: 1, pack_config_id: null, spec: null, container_type: null, has_card: null, line_note: null },
        { id: 'n2', product_id: 'p2', product_name: '小松菜', quantity: 20, confidence: 1, pack_config_id: null, spec: null, container_type: null, has_card: null, line_note: null },
      ],
      existingOrder: { id: 'order-old', note: null },
      existingItems: [
        { id: 'e1', product_id: 'p1', product_name: 'チンゲン菜', quantity: 50, version: 3, field_status: 'not_started', line_note: null, shipped_qty: null },
        { id: 'e2', product_id: 'p2', product_name: '小松菜', quantity: 10, version: 1, field_status: 'shipped', line_note: null, shipped_qty: 10 },
      ],
    })
    const r = await run(fake)
    expect(r).toMatchObject({ ok: true, mergedIntoOrderId: 'order-old' })

    // e1（未着手）: 50 → 58 に上書き、メモに「数量変更:50→58P」
    const e1Update = fake.calls.find((c) => c.table === 'order_items' && c.op === 'update' && filterValue(c, 'eq', 'id') === 'e1')!
    expect(e1Update.payload).toMatchObject({ quantity: 58, line_note: '数量変更:50→58P', field_status: 'not_started' })
    const audit = fake.calls.find(
      (c) => c.table === 'audit_log' && (c.payload as { entity_id?: string }).entity_id === 'e1',
    )!
    expect((audit.payload as { old_values: { quantity: number } }).old_values.quantity).toBe(50)

    // e2（出荷済み）は上書きせず、新しい明細 n2 を別行として既存注文へ移す
    expect(fake.calls.some((c) => c.table === 'order_items' && c.op === 'update' && filterValue(c, 'eq', 'id') === 'e2')).toBe(false)
    const moved = fake.calls.find((c) => c.table === 'order_items' && c.op === 'update' && filterValue(c, 'eq', 'id') === 'n2')!
    expect(moved.payload).toEqual({ order_id: 'order-old' })
  })

  describe('付随更新の失敗（承認は成功のまま、console.error と warnings で知らせる）', () => {
    let errorSpy: ReturnType<typeof vi.spyOn>
    const logged = () => errorSpy.mock.calls.map((a: unknown[]) => a.map(String).join(' ')).join('\n')
    const mergeScenario: Scenario = {
      existingOrder: { id: 'order-old', note: null },
      existingItems: [
        { id: 'e1', product_id: 'p1', product_name: 'チンゲン菜', quantity: 50, version: 3, field_status: 'not_started', line_note: null, shipped_qty: null },
      ],
    }
    afterEach(() => errorSpy?.mockRestore())

    it('成功時は warnings キーを付けない', async () => {
      errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const r = await run(setup({}))
      expect(r.ok).toBe(true)
      expect(r).not.toHaveProperty('warnings')
      const r2 = await run(setup(mergeScenario))
      expect(r2.ok).toBe(true)
      expect(r2).not.toHaveProperty('warnings')
      expect(errorSpy).not.toHaveBeenCalled()
    })

    it('受信票の状態更新・監査ログに失敗しても承認は成功し、両方を警告とログに出す', async () => {
      errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const r = await run(setup({ receiptsUpdateError: 'receipts down', auditError: 'audit down' }))
      expect(r).toMatchObject({ ok: true, tasksCreated: 1 })
      if (!r.ok) throw new Error('unreachable')
      expect(r.warnings).toHaveLength(2)
      expect(r.warnings!.join('\n')).toMatch(/受信箱/)
      expect(r.warnings!.join('\n')).toMatch(/記録/)
      // 内部のテーブル名は画面の文言に出さない
      expect(r.warnings!.join('')).not.toMatch(/order_receipts|audit_log/)
      expect(logged()).toMatch(/receipts down/)
      expect(logged()).toMatch(/audit down/)
    })

    it('統合時: 受信票の付け替えに失敗したら警告を返し、原本を失わないよう統合元の注文は削除しない', async () => {
      errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const fake = setup({ ...mergeScenario, receiptsUpdateError: 'receipts down' })
      const r = await run(fake)
      expect(r).toMatchObject({ ok: true, mergedIntoOrderId: 'order-old' })
      if (!r.ok) throw new Error('unreachable')
      expect(r.warnings?.[0]).toMatch(/付け替え/)
      expect(fake.calls.some((c) => c.table === 'orders' && c.op === 'delete')).toBe(false)
      expect(logged()).toMatch(/receipts down/)
    })

    it('統合時: 統合元の削除・監査ログの失敗を警告とログに出す', async () => {
      errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const r = await run(setup({ ...mergeScenario, mergeSourceDeleteError: 'fk violation', auditError: 'audit down' }))
      expect(r).toMatchObject({ ok: true, mergedIntoOrderId: 'order-old' })
      if (!r.ok) throw new Error('unreachable')
      const w = r.warnings!.join('\n')
      expect(w).toMatch(/統合元/)
      expect(w).toMatch(/記録/)
      expect(logged()).toMatch(/fk violation/)
      expect(logged()).toMatch(/audit down/)
    })
  })
})
