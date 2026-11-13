/**
 * - POST /api/orders/revise：本番に無い列（has_seal / bag_type）を落として再試行し、本体の失敗は 500、
 *   収穫数（harvest_tasks）の同期失敗は 200＋警告にする。
 * - POST /api/deliveries/departure-time：既存の納入先（siblings）が読めないときは新規作成に進まず 500。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase, type FakeCall, type FakeResult } from './support/fake-supabase'

const ORDER = '55555555-5555-4555-8555-555555555555'
const ITEM = '66666666-6666-4666-8666-666666666666'
const CUST = '11111111-1111-4111-8111-111111111111'

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
        delivery_date: null,
        items: [{ product_name: '青梗菜', quantity: 40, has_seal: true, bag_type: 'FG', has_card: false }],
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
const reviseBody = {
  orderId: ORDER,
  instruction: '青梗菜を40に',
  currentOrders: [{ customer_name: 'テスト', items: [{ product_name: '青梗菜', quantity: 20 }] }],
}
const existingItems = { data: [{ id: ITEM, product_name: '青梗菜', quantity: 20, version: 3 }] }
/** 列が無い（本番）: has_seal / bag_type を含む更新は 42703 */
function missingColumnUpdate(c: FakeCall): FakeResult | undefined {
  if (c.table !== 'order_items' || c.op !== 'update') return undefined
  const p = c.payload as Record<string, unknown>
  if ('has_seal' in p) return { error: { code: '42703', message: 'column "has_seal" of relation "order_items" does not exist' } }
  if ('bag_type' in p) return { error: { code: '42703', message: 'column "bag_type" of relation "order_items" does not exist' } }
  return { data: { id: ITEM } }
}

describe('POST /api/orders/revise', () => {
  it('本番に無い列（42703）を落として再試行し、成功する（警告なし）', async () => {
    scenario = (c) => {
      if (c.table === 'order_items' && c.op === 'select') return existingItems
      return missingColumnUpdate(c)
    }
    const { POST } = await import('@/app/api/orders/revise/route')
    const res = await POST(post(reviseBody) as never)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok?: boolean; warnings?: string[] }
    expect(body.ok).toBe(true)
    expect(body.warnings).toBeUndefined()
    const updates = fake.calls.filter((c) => c.table === 'order_items' && c.op === 'update')
    const last = updates[updates.length - 1]!.payload as Record<string, unknown>
    expect(last).not.toHaveProperty('has_seal')
    expect(last).not.toHaveProperty('bag_type')
    expect(last).toMatchObject({ quantity: 40, version: 4, has_card: false })
    // 収穫数も同期している
    expect(fake.calls.some((c) => c.table === 'harvest_tasks' && c.op === 'update')).toBe(true)
  })

  it('本体（order_items）の更新が列不足以外で失敗したら 500', async () => {
    scenario = (c) => {
      if (c.table === 'order_items' && c.op === 'select') return existingItems
      if (c.table === 'order_items' && c.op === 'update') return { error: { message: 'permission denied' } }
      return undefined
    }
    const { POST } = await import('@/app/api/orders/revise/route')
    const res = await POST(post(reviseBody) as never)
    expect(res.status).toBe(500)
    const body = (await res.json()) as { ok?: boolean; error?: string }
    expect(body.ok).toBeUndefined()
    expect(body.error).toBe('修正内容を注文に保存できませんでした。もう一度お試しください')
    expect(fake.calls.some((c) => c.table === 'harvest_tasks')).toBe(false)
  })

  it('明細の読み込みに失敗したら 500（黙って何も保存しないまま成功扱いにしない）', async () => {
    scenario = (c) => (c.table === 'order_items' && c.op === 'select' ? { error: { message: 'timeout' } } : undefined)
    const { POST } = await import('@/app/api/orders/revise/route')
    const res = await POST(post(reviseBody) as never)
    expect(res.status).toBe(500)
  })

  it('収穫数（harvest_tasks）の同期だけ失敗したら 200＋警告', async () => {
    scenario = (c) => {
      if (c.table === 'order_items' && c.op === 'select') return existingItems
      if (c.table === 'harvest_tasks' && c.op === 'update') return { error: { message: 'harvest write failed' } }
      return missingColumnUpdate(c)
    }
    const { POST } = await import('@/app/api/orders/revise/route')
    const res = await POST(post(reviseBody) as never)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok?: boolean; warnings?: string[] }
    expect(body.ok).toBe(true)
    expect(body.warnings).toEqual([
      '注文の修正は保存しましたが、収穫・パックの必要数を更新できませんでした。収穫画面の数が古い可能性があります。この注文の数量をもう一度保存してください',
    ])
    expect(errorSpy.mock.calls.flat().map(String).join(' ')).toMatch(/harvest write failed/)
  })
})

describe('POST /api/deliveries/departure-time：既存の納入先の読み込み失敗', () => {
  it('siblings が読めなければ新規作成に進まず 500', async () => {
    scenario = (c) => {
      if (c.table === 'delivery_destinations' && c.op === 'select') return { error: { message: 'timeout' } }
      return undefined
    }
    const { POST } = await import('@/app/api/deliveries/departure-time/route')
    const res = await POST(
      post({
        deliveryDate: '2026-11-12',
        customerId: CUST,
        destinationName: 'A店',
        departureTime: '11:30',
        shippingRouteName: '1便',
        scope: 'master',
      }),
    )
    expect(res.status).toBe(500)
    const body = (await res.json()) as { error?: string }
    expect(body.error).toBe('納入先の一覧を読み込めなかったため、出発時刻・便名を保存していません。時間をおいてもう一度保存してください')
    expect(fake.calls.some((c) => c.table === 'delivery_destinations' && c.op === 'insert')).toBe(false)
    expect(fake.calls.some((c) => c.table === 'app_settings' && c.op === 'upsert')).toBe(false)
  })
})
