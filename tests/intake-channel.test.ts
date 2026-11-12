/**
 * 受注経路（orders.intake_channel）の扱いを固定する（CLAUDE.md「手入力で注文を作る経路は intake_channel を必ず埋める」）。
 * - 画面: 新しい注文を作りうる操作だけ経路を求める（requiresIntakeChannel）。既存の注文への加算・減量・上書き・
 *   0取消は経路なしで通す。既存かどうか確実に分からない操作は求める側に倒す。
 * - /api/shipments: 経路なしで新しい注文を作っても拒否しない（オフラインで溜まった注文の再送を捨てさせない）。
 *   代わりに console.warn に注文 id・source を残す。既存の注文への追加では出さない。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase, type FakeCall, type FakeResult } from './support/fake-supabase'
import { existingOrderKnownFromLookup, requiresIntakeChannel } from '@/lib/orders/intake-channel'

describe('requiresIntakeChannel（新しい注文を作りうる操作か）', () => {
  it('新規として追加（create）は、既存の注文があっても経路が必要', () => {
    expect(requiresIntakeChannel({ mode: 'create', quantity: 30, existingOrderKnown: false })).toBe(true)
    expect(requiresIntakeChannel({ mode: 'create', quantity: 30, existingOrderKnown: true })).toBe(true)
  })

  it.each(['increase', 'decrease', 'set'] as const)('既存の注文への %s は経路が不要', (mode) => {
    expect(requiresIntakeChannel({ mode, quantity: 30, existingOrderKnown: true })).toBe(false)
  })

  it.each(['increase', 'decrease', 'set'] as const)('既存の注文があるか分からない %s は経路が必要（安全側）', (mode) => {
    expect(requiresIntakeChannel({ mode, quantity: 30, existingOrderKnown: false })).toBe(true)
    expect(requiresIntakeChannel({ mode, quantity: 30, existingOrderKnown: null })).toBe(true)
    expect(requiresIntakeChannel({ mode, quantity: 30, existingOrderKnown: undefined })).toBe(true)
  })

  it.each(['create', 'increase', 'decrease', 'set'] as const)('数量0の取消（%s）は新しい注文を作らないので不要', (mode) => {
    expect(requiresIntakeChannel({ mode, quantity: 0, existingOrderKnown: false })).toBe(false)
  })

  it('数量が数えられないときは、既存が確実でなければ必要', () => {
    expect(requiresIntakeChannel({ mode: 'set', quantity: null, existingOrderKnown: false })).toBe(true)
  })
})

describe('existingOrderKnownFromLookup（既存の出荷の照会結果）', () => {
  it('見つからなければ既存ではない', () => {
    expect(existingOrderKnownFromLookup({ existingFound: false, destinationId: 'd', customerHasDestinations: true })).toBe(false)
  })
  it('納入先を指定して見つかれば既存', () => {
    expect(existingOrderKnownFromLookup({ existingFound: true, destinationId: 'd', customerHasDestinations: true })).toBe(true)
  })
  it('納入先なしの照会は別の納入先の注文も拾うので、取引先に納入先があれば既存とみなさない', () => {
    expect(existingOrderKnownFromLookup({ existingFound: true, destinationId: '', customerHasDestinations: true })).toBe(false)
    expect(existingOrderKnownFromLookup({ existingFound: true, destinationId: null, customerHasDestinations: true })).toBe(false)
  })
  it('納入先が1件も無い取引先なら、納入先なしの照会でも既存', () => {
    expect(existingOrderKnownFromLookup({ existingFound: true, destinationId: null, customerHasDestinations: false })).toBe(true)
  })
})

// ── /api/shipments ──────────────────────────────────────────────
const CUST = '11111111-1111-4111-8111-111111111111'
const PROD = '22222222-2222-4222-8222-222222222222'

let resolver: (call: FakeCall) => FakeResult | undefined = () => undefined
let fake = createFakeSupabase((c) => resolver(c))

vi.mock('@/lib/supabase/server', () => ({ getAuthedUser: async () => ({ id: 'u-1' }) }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => fake.client }))
vi.mock('@/lib/auth/api-guard', () => {
  const ok = async () => ({ ok: true, user: { id: 'u-1' }, role: 'staff' })
  return { requireStaffApi: ok, requireAdminApi: ok }
})
vi.mock('@/lib/audit/log', () => ({ writeAudit: async () => undefined }))
vi.mock('@/lib/ai/learning-loop', () => ({ recordMistakeFeedback: async () => undefined }))
vi.mock('@/lib/receipts/retention', () => ({ purgeOldReceiptBase64: async () => 0 }))

function masters(existingOrder: boolean) {
  resolver = (call) => {
    if (call.table === 'products') {
      return { data: { id: PROD, name: '小松菜', unit: 'P', default_unit_price: 100, default_tax_rate: 8, container_capacity: 20 } }
    }
    if (call.table === 'customers') return { data: { name: 'テスト青果' } }
    if (call.table === 'customer_product_rules' && call.op === 'select') return { data: null }
    if (call.table === 'pack_configs') return { data: [] }
    if (call.table === 'orders' && call.op === 'select') return { data: existingOrder ? { id: 'ord-existing' } : null }
    if (call.table === 'orders' && call.op === 'insert') return { data: { id: 'ord-new' } }
    if (call.table === 'order_items' && call.op === 'select') return { data: null }
    if (call.table === 'order_items' && call.op === 'insert') {
      return { data: { id: 'item-1', ...(call.payload as Record<string, unknown>) } }
    }
    return undefined
  }
}

async function postShipment(body: Record<string, unknown>) {
  const { POST } = await import('@/app/api/shipments/route')
  const res = await POST(
    new Request('http://x/api/shipments', {
      method: 'POST',
      body: JSON.stringify({ customer_id: CUST, product_id: PROD, delivery_date: '2026-11-13', quantity_raw: '40', ...body }),
    }),
  )
  return res.status
}

let warnSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  fake = createFakeSupabase((c) => resolver(c))
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => warnSpy.mockRestore())

const intakeWarns = () =>
  warnSpy.mock.calls.filter((args: unknown[]) => String(args[0]).includes('受注経路なしで新しい注文を作成しました'))

describe('POST /api/shipments：受注経路なしの新しい注文', () => {
  it('経路なしでも拒否せず保存し（intake_channel は NULL）、console.warn に注文 id と source を残す', async () => {
    masters(false)
    const status = await postShipment({})
    expect(status).toBeLessThan(300)
    const ord = fake.calls.find((c) => c.table === 'orders' && c.op === 'insert')!
    expect((ord.payload as Record<string, unknown>).intake_channel).toBeNull()
    expect(fake.calls.some((c) => c.table === 'order_items' && c.op === 'insert')).toBe(true)
    expect(intakeWarns()).toHaveLength(1)
    expect(intakeWarns()[0]![1]).toEqual({ orderId: 'ord-new', source: 'manual' })
  })

  it('経路ありなら intake_channel が入り、警告は出さない', async () => {
    masters(false)
    await postShipment({ intake_channel: 'phone' })
    const ord = fake.calls.find((c) => c.table === 'orders' && c.op === 'insert')!
    expect((ord.payload as Record<string, unknown>).intake_channel).toBe('phone')
    expect(intakeWarns()).toHaveLength(0)
  })

  it('既存の注文への追加は経路なしで通り、警告も出さない（注文は作らない）', async () => {
    masters(true)
    const status = await postShipment({ mode: 'increase' })
    expect(status).toBeLessThan(300)
    expect(fake.calls.some((c) => c.table === 'orders' && c.op === 'insert')).toBe(false)
    expect(intakeWarns()).toHaveLength(0)
  })
})
