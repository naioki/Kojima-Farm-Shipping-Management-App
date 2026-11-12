/**
 * 出荷一覧のスマート追加（POST /api/shipments）と週の管理の1セル更新（PUT /api/shipments/cell）が、
 * 入数を lib/masters/packs-per-case.ts の優先順位で決めることを固定する。
 * 取引先名（NSK・農業総合研究所）からの 24 推測はしない。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase, type FakeCall, type FakeResult } from './support/fake-supabase'

const CUST = '11111111-1111-4111-8111-111111111111'
const PROD = '22222222-2222-4222-8222-222222222222'

let resolver: (call: FakeCall) => FakeResult | undefined = () => undefined
let fake = createFakeSupabase((c) => resolver(c))

vi.mock('@/lib/supabase/server', () => ({ getAuthedUser: async () => ({ id: 'u-1' }) }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => fake.client }))
// 権限ガードは tests/api-guards.test.ts で確かめる。ここでは社内スタッフとして通す
vi.mock('@/lib/auth/api-guard', () => {
  const ok = async () => ({ ok: true, user: { id: 'u-1' }, role: 'staff' })
  return { requireStaffApi: ok, requireAdminApi: ok }
})
vi.mock('@/lib/audit/log', () => ({ writeAudit: async () => undefined }))
vi.mock('@/lib/ai/learning-loop', () => ({ recordMistakeFeedback: async () => undefined }))
vi.mock('@/lib/receipts/retention', () => ({ purgeOldReceiptBase64: async () => 0 }))

interface Masters {
  customerName: string
  capacity: number | null
  rule: Record<string, unknown> | null
  packs: Array<{ id: string; product_id: string; customer_id: string | null; base_per_selling: number; is_active: boolean }>
}

function useMasters(m: Masters) {
  resolver = (call) => {
    if (call.table === 'products') {
      return { data: { id: PROD, name: '小松菜', unit: 'P', default_unit_price: 100, default_tax_rate: 8, container_capacity: m.capacity } }
    }
    if (call.table === 'customers') return { data: { name: m.customerName } }
    if (call.table === 'customer_product_rules' && call.op === 'select') return { data: m.rule }
    if (call.table === 'pack_configs') return { data: m.packs }
    if (call.table === 'orders' && call.op === 'select') return { data: null }
    if (call.table === 'orders' && call.op === 'insert') return { data: { id: 'ord-1' } }
    if (call.table === 'order_items' && call.op === 'insert') {
      return { data: { id: 'item-1', order_id: 'ord-1', ...(call.payload as Record<string, unknown>) } }
    }
    return undefined
  }
}

function insertedItem(): Record<string, unknown> {
  const c = fake.calls.find((x) => x.table === 'order_items' && x.op === 'insert')
  return (c?.payload ?? {}) as Record<string, unknown>
}

async function postShipment(body: Record<string, unknown>) {
  const { POST } = await import('@/app/api/shipments/route')
  const res = await POST(
    new Request('http://x/api/shipments', {
      method: 'POST',
      body: JSON.stringify({ customer_id: CUST, product_id: PROD, delivery_date: '2026-11-10', ...body }),
    }),
  )
  return { status: res.status, json: (await res.json()) as Record<string, unknown> }
}

async function putCell(quantity_raw: string) {
  const { PUT } = await import('@/app/api/shipments/cell/route')
  const res = await PUT(
    new Request('http://x/api/shipments/cell', {
      method: 'PUT',
      body: JSON.stringify({ customer_id: CUST, product_id: PROD, delivery_date: '2026-11-10', quantity_raw, intake_channel: 'phone' }),
    }),
  )
  return res.status
}

beforeEach(() => {
  fake = createFakeSupabase((c) => resolver(c))
})

describe('POST /api/shipments の入数', () => {
  it('取引先名が NSK でも、マスタが無ければ 24 ではなく 20', async () => {
    useMasters({ customerName: 'NSK（農業総合研究所）', capacity: null, rule: null, packs: [] })
    const r = await postShipment({ quantity_raw: '2c' })
    expect(r.status).toBe(201)
    expect(r.json.effectivePacksPerCase).toBe(20)
    expect(insertedItem().quantity).toBe(40)
  })

  it('取引先別の設定が無ければ荷姿（取引先専用）の入数を使う', async () => {
    useMasters({
      customerName: 'ヨーク',
      capacity: 30,
      rule: null,
      packs: [{ id: 'pk-1', product_id: PROD, customer_id: CUST, base_per_selling: 24, is_active: true }],
    })
    const r = await postShipment({ quantity_raw: '2c' })
    expect(r.json.effectivePacksPerCase).toBe(24)
    expect(insertedItem().quantity).toBe(48)
    expect(insertedItem().quantity_raw).toBe('2c')
  })

  it('取引先別の設定は荷姿より優先', async () => {
    useMasters({
      customerName: 'ヨーク',
      capacity: 30,
      rule: { id: 'r-1', customer_id: CUST, product_id: PROD, packs_per_case: 12 },
      packs: [{ id: 'pk-1', product_id: PROD, customer_id: CUST, base_per_selling: 24, is_active: true }],
    })
    const r = await postShipment({ quantity_raw: '2c' })
    expect(r.json.effectivePacksPerCase).toBe(12)
  })

  it('画面で入力された入数は最優先で、取引先別の設定に保存される', async () => {
    useMasters({ customerName: 'ヨーク', capacity: 30, rule: null, packs: [] })
    const r = await postShipment({ quantity_raw: '2c', packs_per_case: 15 })
    expect(r.json.effectivePacksPerCase).toBe(15)
    expect(insertedItem().quantity).toBe(30)
    const ruleInsert = fake.calls.find((x) => x.table === 'customer_product_rules' && x.op === 'insert')
    expect((ruleInsert?.payload as Record<string, unknown>).packs_per_case).toBe(15)
  })

  it('入数を入力していないときは、荷姿・品目の標準から決まった入数を取引先別の設定に書き込まない', async () => {
    useMasters({ customerName: 'ヨーク', capacity: 30, rule: null, packs: [] })
    const r = await postShipment({ quantity_raw: '2c' })
    expect(r.json.effectivePacksPerCase).toBe(30)
    const ruleInsert = fake.calls.find((x) => x.table === 'customer_product_rules' && x.op === 'insert')
    expect(ruleInsert).toBeTruthy()
    expect(ruleInsert?.payload as Record<string, unknown>).not.toHaveProperty('packs_per_case')
  })
})

describe('PUT /api/shipments/cell の入数', () => {
  it('取引先名が NSK でも、品目の標準があればそれを使う（24 推測なし）', async () => {
    useMasters({ customerName: '農業総合研究所', capacity: 30, rule: null, packs: [] })
    expect(await putCell('2c')).toBe(201)
    expect(insertedItem().quantity).toBe(60)
  })

  it('取引先共通の荷姿の入数を使う（入数の違う荷姿が複数あればその段は飛ばす）', async () => {
    useMasters({
      customerName: 'ヨーク',
      capacity: 30,
      rule: null,
      packs: [{ id: 'pk-s', product_id: PROD, customer_id: null, base_per_selling: 25, is_active: true }],
    })
    await putCell('2c')
    expect(insertedItem().quantity).toBe(50)

    fake = createFakeSupabase((c) => resolver(c))
    useMasters({
      customerName: 'ヨーク',
      capacity: 30,
      rule: null,
      packs: [
        { id: 'pk-a', product_id: PROD, customer_id: null, base_per_selling: 25, is_active: true },
        { id: 'pk-b', product_id: PROD, customer_id: null, base_per_selling: 10, is_active: true },
      ],
    })
    await putCell('2c')
    expect(insertedItem().quantity).toBe(60)
  })
})
