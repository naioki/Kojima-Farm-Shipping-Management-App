/**
 * POST /api/orders/revise：AI の明細を鍵（line_key = order_items.id）で DB の明細に対応付ける回帰テスト。
 * 並べ替えても正しい明細に書く／増減・重複・未知の鍵・品目の取り違えは何も書かずに日本語エラー／表記ゆれは通す。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase, filterValue, type FakeCall, type FakeResult } from './support/fake-supabase'
import { REVISION_MISMATCH_MESSAGE, productNameKey } from '@/lib/orders/revise-match'

const ORDER = '55555555-5555-4555-8555-555555555555'
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

let scenario: (c: FakeCall) => FakeResult | undefined = () => undefined
const resolve = (c: FakeCall): FakeResult | undefined => {
  const r = scenario(c)
  if (r) return r
  if (c.table === 'users') return { data: { role: 'staff' } }
  return { data: null }
}
let fake = createFakeSupabase(resolve)
let aiItems: Array<Record<string, unknown>> = []

vi.mock('@/lib/supabase/server', () => ({ getAuthedUser: async () => ({ id: 'u-1' }) }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => fake.client }))
vi.mock('@/lib/gemini/analyze', () => ({
  invalidateAiRulesCache: () => {},
  reviseOrdersWithInstruction: async () => ({
    orders: [{ customer_name: 'テスト', delivery_date: '2026-11-20', items: aiItems }],
    aiLearnedRuleCandidate: '今後は青梗菜を40にする',
    revisionSummary: 'ok',
    usedModel: 'test',
  }),
}))

let warnSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  fake = createFakeSupabase(resolve)
  scenario = (c) => {
    if (c.table === 'order_items' && c.op === 'select') {
      return { data: [
        { id: A, product_name: '青梗菜', quantity: 20, version: 1 },
        { id: B, product_name: 'ミニトマト', quantity: 10, version: 1 },
      ] }
    }
    if (c.table === 'order_items' && c.op === 'update') return { data: { id: filterValue(c, 'eq', 'id') } }
    return undefined
  }
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => warnSpy.mockRestore())

const body = {
  orderId: ORDER,
  instruction: '直して',
  currentOrders: [{ customer_name: 'テスト', items: [{ line_key: A, product_name: '青梗菜', quantity: 20 }] }],
  itemVersions: { [A]: 1, [B]: 1 },
}
async function call() {
  const { POST } = await import('@/app/api/orders/revise/route')
  return POST(new Request('http://localhost/api/x', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }) as never)
}
const writes = () => fake.calls.filter((c) => c.op === 'update' || c.op === 'insert' || c.op === 'upsert')

describe('POST /api/orders/revise の明細の鍵による対応付け', () => {
  it('AI が並べ替えて返しても、鍵で正しい明細に書く', async () => {
    aiItems = [
      { line_key: B, product_name: 'ミニトマト', quantity: '15' },
      { line_key: A, product_name: '青梗菜', quantity: '40' },
    ]
    const res = await call()
    expect(res.status).toBe(200)
    const u = fake.calls.filter((c) => c.table === 'order_items' && c.op === 'update')
    const qtyOf = (id: string) => (u.find((c) => filterValue(c, 'eq', 'id') === id)!.payload as Record<string, unknown>).quantity
    expect(qtyOf(A)).toBe(40)
    expect(qtyOf(B)).toBe(15)
  })

  const bad: Array<[string, Array<Record<string, unknown>>]> = [
    ['明細が1件減った', [{ line_key: A, product_name: '青梗菜', quantity: '40' }]],
    ['明細が1件増えた', [
      { line_key: A, product_name: '青梗菜', quantity: '40' },
      { line_key: B, product_name: 'ミニトマト', quantity: '10' },
      { line_key: 'new', product_name: '小松菜', quantity: '5' },
    ]],
    ['鍵が重複', [
      { line_key: A, product_name: '青梗菜', quantity: '40' },
      { line_key: A, product_name: '青梗菜', quantity: '10' },
    ]],
    ['知らない鍵', [
      { line_key: A, product_name: '青梗菜', quantity: '40' },
      { line_key: 'zzz', product_name: 'ミニトマト', quantity: '10' },
    ]],
    ['鍵が無い', [
      { product_name: '青梗菜', quantity: '40' },
      { line_key: B, product_name: 'ミニトマト', quantity: '10' },
    ]],
    ['品目が別の品目に変わった', [
      { line_key: A, product_name: 'ミニトマト', quantity: '40' },
      { line_key: B, product_name: '青梗菜', quantity: '10' },
    ]],
  ]
  for (const [name, items] of bad) {
    it(`${name}なら何も書かずに日本語エラー`, async () => {
      aiItems = items
      const res = await call()
      expect(res.status).toBe(422)
      expect(((await res.json()) as { error: string }).error).toBe(REVISION_MISMATCH_MESSAGE)
      expect(writes()).toHaveLength(0)
    })
  }

  it('表記ゆれ（ひらがな・カタカナ、全角半角）だけなら通る', async () => {
    aiItems = [
      { line_key: A, product_name: 'ちんげん菜', quantity: '40' },
      { line_key: B, product_name: 'ﾐﾆﾄﾏﾄ', quantity: '10' },
    ]
    scenario = (c) => {
      if (c.table === 'order_items' && c.op === 'select') {
        return { data: [
          { id: A, product_name: 'チンゲン菜', quantity: 20, version: 1 },
          { id: B, product_name: 'ミニトマト', quantity: 10, version: 1 },
        ] }
      }
      if (c.table === 'order_items' && c.op === 'update') return { data: { id: filterValue(c, 'eq', 'id') } }
      return undefined
    }
    const res = await call()
    expect(res.status).toBe(200)
    expect(productNameKey('ＡＢＣ　ちんげん')).toBe(productNameKey('abc チンゲン'))
  })
})
