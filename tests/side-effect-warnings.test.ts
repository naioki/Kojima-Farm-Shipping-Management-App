/**
 * 付随更新の失敗を黙って消さないことを固定する（engineering.md §5・CLAUDE.md NEVER swallow errors）。
 * 本体の書き込みが成功した操作は、付随更新が失敗しても 500 にせず「成功＋warnings」で返し、
 * 詳細を console.error に残す。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase, filterValue, type FakeCall, type FakeResult } from './support/fake-supabase'

const CUST = '11111111-1111-4111-8111-111111111111'
const PROD = '22222222-2222-4222-8222-222222222222'
const DEST = '33333333-3333-4333-8333-333333333333'

let currentUser: { id: string } | null = { id: 'u-1' }
/** テストごとの応答。null を返すと既定（users=staff・それ以外は data:null）。 */
let scenario: (c: FakeCall) => FakeResult | undefined = () => undefined

const resolve = (c: FakeCall): FakeResult | undefined => {
  const r = scenario(c)
  if (r) return r
  if (c.table === 'users') return { data: { role: 'staff' } }
  return { data: null }
}
let fake = createFakeSupabase(resolve)

vi.mock('@/lib/supabase/server', () => ({ getAuthedUser: async () => currentUser }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => fake.client }))

let errorSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  fake = createFakeSupabase(resolve)
  currentUser = { id: 'u-1' }
  scenario = () => undefined
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  errorSpy.mockRestore()
})

function loggedText(): string {
  return errorSpy.mock.calls.map((args: unknown[]) => args.map(String).join(' ')).join('\n')
}

function json(body: unknown, method = 'PUT'): Request {
  return new Request('http://localhost/api/x', {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('PUT /api/shipments/cell（数量変更）', () => {
  const existingItem = {
    id: 'item-1',
    order_id: 'order-1',
    product_id: PROD,
    quantity: 20,
    version: 2,
    field_status: 'not_started',
    shipped_qty: null,
  }
  const cellScenario = (harvestError: string | null) => (c: FakeCall): FakeResult | undefined => {
    if (c.table === 'products') return { data: { id: PROD, name: '小松菜', unit: 'P', default_unit_price: 100, default_tax_rate: 8, container_capacity: 20 } }
    if (c.table === 'customers') return { data: { name: 'テスト青果' } }
    if (c.table === 'customer_product_rules') return { data: null }
    if (c.table === 'pack_configs') return { data: [] }
    if (c.table === 'orders' && c.op === 'select') return { data: { id: 'order-1' } }
    if (c.table === 'order_items' && c.op === 'select') return { data: existingItem }
    if (c.table === 'order_items' && c.op === 'update') return { data: { ...existingItem, ...(c.payload as object) } }
    if (c.table === 'harvest_tasks' && c.op === 'update') {
      return harvestError ? { error: { message: harvestError } } : { data: null }
    }
    return undefined
  }

  it('収穫数（harvest_tasks）の更新に失敗しても数量は保存済みとして返し、警告とサーバーログを残す', async () => {
    scenario = cellScenario('permission denied for harvest_tasks')
    const { PUT } = await import('@/app/api/shipments/cell/route')
    const res = await PUT(json({ customer_id: CUST, destination_id: DEST, product_id: PROD, delivery_date: '2026-11-12', quantity_raw: '30' }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { item?: { quantity: number }; warnings?: string[] }
    expect(body.item?.quantity).toBe(30)
    expect(body.warnings).toEqual([
      '数量は保存しましたが、収穫数の更新に失敗しました。画面を読み込み直して確認してください',
    ])
    // 内部のテーブル名は画面の文言に出さず、サーバーログ側に出す
    expect(body.warnings?.join('')).not.toMatch(/harvest_tasks/)
    expect(loggedText()).toMatch(/harvest_tasks/)
    expect(loggedText()).toMatch(/permission denied for harvest_tasks/)
    const htUpdate = fake.calls.find((c) => c.table === 'harvest_tasks' && c.op === 'update')!
    expect(htUpdate.payload).toEqual({ required_qty: 30 })
    expect(filterValue(htUpdate, 'eq', 'order_item_id')).toBe('item-1')
  })

  it('収穫数の更新が成功したときは warnings キーを付けない（応答の形を変えない）', async () => {
    scenario = cellScenario(null)
    const { PUT } = await import('@/app/api/shipments/cell/route')
    const res = await PUT(json({ customer_id: CUST, destination_id: DEST, product_id: PROD, delivery_date: '2026-11-12', quantity_raw: '30' }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body).not.toHaveProperty('warnings')
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('監査ログの記録に失敗しても 500 にしない（本体は保存済み）。ログには残す', async () => {
    const base = cellScenario(null)
    scenario = (c) => (c.table === 'audit_log' ? { error: { message: 'audit down' } } : base(c))
    const { PUT } = await import('@/app/api/shipments/cell/route')
    const res = await PUT(json({ customer_id: CUST, destination_id: DEST, product_id: PROD, delivery_date: '2026-11-12', quantity_raw: '30' }))
    expect(res.status).toBe(200)
    expect(loggedText()).toMatch(/audit down/)
  })
})

describe('POST /api/order-items/[id]/reset（出荷済みの取り消し）', () => {
  const current = { id: 'item-1', order_id: 'order-1', field_status: 'shipped', version: 4 }
  it('配送チェックの戻しに失敗したら、取り消しは成功のまま警告を返す', async () => {
    scenario = (c) => {
      if (c.table === 'order_items' && c.op === 'select') return { data: current }
      if (c.table === 'order_items' && c.op === 'update') return { data: { ...current, field_status: 'packed', version: 5 } }
      if (c.table === 'orders' && c.op === 'select') {
        return { data: { id: 'order-1', customer_id: CUST, destination_id: null, delivery_date: '2026-11-12', status: 'shipped' } }
      }
      if (c.table === 'deliveries' && c.op === 'update') return { error: { message: 'deliveries locked' } }
      return undefined
    }
    const { POST } = await import('@/app/api/order-items/[id]/reset/route')
    const res = await POST(json({ version: 4 }, 'POST'), { params: { id: 'item-1' } })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { item?: { field_status: string }; warnings?: string[] }
    expect(body.item?.field_status).toBe('packed')
    expect(body.warnings?.[0]).toMatch(/配送チェック/)
    expect(loggedText()).toMatch(/deliveries locked/)
    // orders は戻せている
    const ordUpd = fake.calls.find((c) => c.table === 'orders' && c.op === 'update')!
    expect(ordUpd.payload).toEqual({ status: 'approved' })
  })
})

describe('PATCH /api/destinations/[id]（出発時刻の退避保存）', () => {
  it('退避保存（app_settings）に失敗したら、納入先の更新は成功のまま警告を返す', async () => {
    scenario = (c) => {
      if (c.table === 'delivery_destinations' && c.op === 'update') {
        return { data: { id: DEST, code: 'A店', full_name: 'A店', aliases: [], is_active: true } }
      }
      if (c.table === 'app_settings' && c.op === 'select') return { data: null }
      if (c.table === 'app_settings' && c.op === 'upsert') return { error: { message: 'settings write failed' } }
      return undefined
    }
    const { PATCH } = await import('@/app/api/destinations/[id]/route')
    const res = await PATCH(json({ departure_time: '11:30' }, 'PATCH'), { params: { id: DEST } })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { destination?: { id: string }; warnings?: string[] }
    expect(body.destination?.id).toBe(DEST)
    expect(body.warnings?.[0]).toMatch(/出発時刻・便名の保存に失敗/)
    expect(loggedText()).toMatch(/settings write failed/)
  })

  it('退避ストアが読めないときは上書きしない（他の納入先の出発時刻を消さない）', async () => {
    scenario = (c) => {
      if (c.table === 'delivery_destinations' && c.op === 'update') {
        return { data: { id: DEST, code: 'A店', full_name: 'A店', aliases: [], is_active: true } }
      }
      if (c.table === 'app_settings' && c.op === 'select') return { error: { message: 'read timeout' } }
      return undefined
    }
    const { PATCH } = await import('@/app/api/destinations/[id]/route')
    const res = await PATCH(json({ departure_time: '11:30' }, 'PATCH'), { params: { id: DEST } })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { warnings?: string[] }
    expect(body.warnings).toHaveLength(1)
    expect(fake.calls.some((c) => c.table === 'app_settings' && c.op === 'upsert')).toBe(false)
  })
})

describe('lib/inventory/chain writeFallbackInventory', () => {
  it('退避保存に失敗したら throw する（成功扱いにしない）', async () => {
    scenario = (c) => (c.table === 'app_settings' && c.op === 'upsert' ? { error: { message: 'nope' } } : undefined)
    const { writeFallbackInventory } = await import('@/lib/inventory/chain')
    await expect(
      writeFallbackInventory(fake.client as never, PROD, '2026-11-12', { stock_containers: 3 }),
    ).rejects.toThrow(/nope/)
  })
})
