/**
 * 楽観ロック（CLAUDE.md: WHERE id=$ AND version=$expected、0件なら409）を
 * POST /api/order-items/[id]/reset と POST /api/orders/revise で守っていることの回帰テスト。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase, filterValue, type FakeCall, type FakeResult } from './support/fake-supabase'

const ORDER = '55555555-5555-4555-8555-555555555555'
const ITEM = '66666666-6666-4666-8666-666666666666'

let scenario: (c: FakeCall) => FakeResult | undefined = () => undefined
const resolve = (c: FakeCall): FakeResult | undefined => {
  const r = scenario(c)
  if (r) return r
  if (c.table === 'users') return { data: { role: 'staff' } }
  return { data: null }
}
let fake = createFakeSupabase(resolve)

vi.mock('@/lib/supabase/server', () => ({ getAuthedUser: async () => ({ id: 'u-1' }) }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => fake.client }))
vi.mock('@/lib/gemini/analyze', () => ({
  invalidateAiRulesCache: () => {},
  reviseOrdersWithInstruction: async () => ({
    orders: [
      {
        customer_name: 'テスト',
        delivery_date: '2026-11-20',
        items: [{ product_name: '青梗菜', quantity: 40, has_seal: true, bag_type: 'FG' }],
      },
    ],
    aiLearnedRuleCandidate: null,
    revisionSummary: '数量を40に',
    usedModel: 'test',
  }),
}))

let errorSpy: ReturnType<typeof vi.spyOn>
let warnSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  fake = createFakeSupabase(resolve)
  scenario = () => undefined
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  errorSpy.mockRestore()
  warnSpy.mockRestore()
})

function post(body: unknown): Request {
  return new Request('http://localhost/api/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}
const itemUpdates = () => fake.calls.filter((c) => c.table === 'order_items' && c.op === 'update')
/** 本番DBのように version 条件で照合する。dbVersion と一致しなければ 0件（data: null） */
function casUpdate(dbVersion: number, opts: { missingCols?: boolean } = {}) {
  return (c: FakeCall): FakeResult | undefined => {
    if (c.table !== 'order_items' || c.op !== 'update') return undefined
    const p = c.payload as Record<string, unknown>
    if (opts.missingCols) {
      if ('has_seal' in p) return { error: { code: '42703', message: 'column "has_seal" of relation "order_items" does not exist' } }
      if ('bag_type' in p) return { error: { code: 'PGRST204', message: "Could not find the 'bag_type' column of 'order_items' in the schema cache" } }
    }
    if (filterValue(c, 'eq', 'version') !== dbVersion) return { data: null }
    return { data: { id: ITEM, ...p } }
  }
}

describe('POST /api/order-items/[id]/reset の楽観ロック', () => {
  const current = { id: ITEM, order_id: null, field_status: 'packed', version: 3 }
  it('version 一致なら id と version で照合して更新し、version+1', async () => {
    scenario = (c) => {
      if (c.table === 'order_items' && c.op === 'select') return { data: current }
      return casUpdate(3)(c)
    }
    const { POST } = await import('@/app/api/order-items/[id]/reset/route')
    const res = await POST(post({ version: 3 }), { params: { id: ITEM } })
    expect(res.status).toBe(200)
    const u = itemUpdates()
    expect(u).toHaveLength(1)
    expect(filterValue(u[0]!, 'eq', 'id')).toBe(ITEM)
    expect(filterValue(u[0]!, 'eq', 'version')).toBe(3)
    expect(u[0]!.payload).toMatchObject({ field_status: 'not_started', version: 4 })
  })

  it('画面の version が古ければ 409 で書き込みなし', async () => {
    scenario = (c) => (c.table === 'order_items' && c.op === 'select' ? { data: current } : undefined)
    const { POST } = await import('@/app/api/order-items/[id]/reset/route')
    const res = await POST(post({ version: 2 }), { params: { id: ITEM } })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'conflict', currentVersion: 3 })
    expect(itemUpdates()).toHaveLength(0)
  })

  it('読んだ後に別の更新が入った（0件）なら 409', async () => {
    scenario = (c) => {
      if (c.table === 'order_items' && c.op === 'select') return { data: current }
      return casUpdate(4)(c)
    }
    const { POST } = await import('@/app/api/order-items/[id]/reset/route')
    const res = await POST(post({ version: 3 }), { params: { id: ITEM } })
    expect(res.status).toBe(409)
    expect(((await res.json()) as { error: string }).error).toBe('conflict')
  })
})

describe('POST /api/orders/revise の楽観ロック', () => {
  const existing = { data: [{ id: ITEM, product_name: '青梗菜', quantity: 20, version: 3 }] }
  const body = (v?: number) => ({
    orderId: ORDER,
    instruction: '青梗菜を40に',
    currentOrders: [{ customer_name: 'テスト', items: [{ product_name: '青梗菜', quantity: 20 }] }],
    ...(v !== undefined ? { itemVersions: { [ITEM]: v } } : {}),
  })

  it('version 一致なら version 条件付きで更新し、version+1', async () => {
    scenario = (c) => {
      if (c.table === 'order_items' && c.op === 'select') return existing
      return casUpdate(3)(c)
    }
    const { POST } = await import('@/app/api/orders/revise/route')
    const res = await POST(post(body(3)) as never)
    expect(res.status).toBe(200)
    const u = itemUpdates()
    expect(u).toHaveLength(1)
    expect(filterValue(u[0]!, 'eq', 'version')).toBe(3)
    expect(u[0]!.payload).toMatchObject({ quantity: 40, version: 4 })
  })

  it('画面の version が古ければ 409 で、明細も納品日も書き込まない', async () => {
    scenario = (c) => (c.table === 'order_items' && c.op === 'select' ? existing : undefined)
    const { POST } = await import('@/app/api/orders/revise/route')
    const res = await POST(post(body(2)) as never)
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'conflict', currentVersion: 3 })
    expect(fake.calls.some((c) => c.op === 'update')).toBe(false)
  })

  it('照合後に別の更新が入った（0件）なら 409（savedCount 付き）で収穫数は同期しない', async () => {
    scenario = (c) => {
      if (c.table === 'order_items' && c.op === 'select') return existing
      return casUpdate(5)(c)
    }
    const { POST } = await import('@/app/api/orders/revise/route')
    const res = await POST(post(body(3)) as never)
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'conflict', currentVersion: 3, savedCount: 0 })
    expect(fake.calls.some((c) => c.table === 'harvest_tasks')).toBe(false)
  })

  it('本番に無い列（42703 / PGRST204）で再試行しても毎回 version 条件を保ち、成功する', async () => {
    scenario = (c) => {
      if (c.table === 'order_items' && c.op === 'select') return existing
      return casUpdate(3, { missingCols: true })(c)
    }
    const { POST } = await import('@/app/api/orders/revise/route')
    const res = await POST(post(body(3)) as never)
    expect(res.status).toBe(200)
    const u = itemUpdates()
    expect(u.length).toBe(3)
    for (const c of u) {
      expect(filterValue(c, 'eq', 'id')).toBe(ITEM)
      expect(filterValue(c, 'eq', 'version')).toBe(3)
    }
    const last = u[u.length - 1]!.payload as Record<string, unknown>
    expect(last).not.toHaveProperty('has_seal')
    expect(last).not.toHaveProperty('bag_type')
    expect(last).toMatchObject({ quantity: 40, version: 4 })
  })
})
