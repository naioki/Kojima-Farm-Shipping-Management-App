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
// 本番には patch_destination_route（migrations/0033）が未適用。このファイルは従来の読み→マージ→書きの経路を固定する
const rpcMissing = () => ({ error: { code: 'PGRST202', message: 'Could not find the function public.patch_destination_route' } })
let fake = createFakeSupabase(resolve, rpcMissing)

vi.mock('@/lib/supabase/server', () => ({ getAuthedUser: async () => currentUser }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => fake.client }))

let errorSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  fake = createFakeSupabase(resolve, rpcMissing)
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
    // 列には保存できている（退避側の同期だけ失敗）ので、何が失敗したか分かる文にする
    expect(body.warnings?.[0]).toMatch(/出発時刻・便名は保存しましたが、控えの更新に失敗/)
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

/** 本番と同じく delivery_destinations に出発時刻・便名の列が無い状態 */
const MISSING_COL = { message: 'column "departure_time" of relation "delivery_destinations" does not exist', code: '42703' }

describe('出発時刻・便名：列が無く退避ストアが唯一の保存先のとき', () => {
  it('PATCH /api/destinations/[id]：出発時刻だけの変更で退避保存に失敗したら 500（成功扱いにしない）', async () => {
    scenario = (c) => {
      if (c.table === 'delivery_destinations' && c.op === 'update') return { error: MISSING_COL }
      if (c.table === 'delivery_destinations' && c.op === 'select') {
        return { data: { id: DEST, code: 'A店', full_name: 'A店', aliases: [], is_active: true } }
      }
      if (c.table === 'app_settings' && c.op === 'select') return { data: null }
      if (c.table === 'app_settings' && c.op === 'upsert') return { error: { message: 'settings write failed' } }
      return undefined
    }
    const { PATCH } = await import('@/app/api/destinations/[id]/route')
    const res = await PATCH(json({ departure_time: '11:30' }, 'PATCH'), { params: { id: DEST } })
    expect(res.status).toBe(500)
    const body = (await res.json()) as { error?: string; destination?: unknown }
    expect(body.error).toBe('出発時刻・便名を保存できませんでした。もう一度お試しください')
    expect(body).not.toHaveProperty('destination')
    expect(loggedText()).toMatch(/settings write failed/)
  })

  it('PATCH /api/destinations/[id]：名前は保存済みで出発時刻だけ失敗したら、成功＋出発時刻が未保存と分かる警告', async () => {
    scenario = (c) => {
      if (c.table === 'delivery_destinations' && c.op === 'update') {
        const p = c.payload as Record<string, unknown>
        if ('departure_time' in p) return { error: MISSING_COL }
        return { data: { id: DEST, code: 'A店', full_name: 'A店（新）', aliases: [], is_active: true } }
      }
      if (c.table === 'app_settings' && c.op === 'select') return { data: null }
      if (c.table === 'app_settings' && c.op === 'upsert') return { error: { message: 'settings write failed' } }
      return undefined
    }
    const { PATCH } = await import('@/app/api/destinations/[id]/route')
    const res = await PATCH(json({ full_name: 'A店（新）', departure_time: '11:30' }, 'PATCH'), { params: { id: DEST } })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { warnings?: string[] }
    expect(body.warnings).toEqual([
      '納入先名などは保存しましたが、出発時刻・便名は保存できませんでした。出発時刻・便名をもう一度保存してください',
    ])
  })

  it('PATCH /api/destinations/[id]：列が無いのは想定内。退避保存が成功すれば警告もエラーログも出さない', async () => {
    scenario = (c) => {
      if (c.table === 'delivery_destinations' && c.op === 'update') return { error: MISSING_COL }
      if (c.table === 'delivery_destinations' && c.op === 'select') {
        return { data: { id: DEST, code: 'A店', full_name: 'A店', aliases: [], is_active: true } }
      }
      if (c.table === 'app_settings' && c.op === 'select') return { data: null }
      return undefined
    }
    const { PATCH } = await import('@/app/api/destinations/[id]/route')
    const res = await PATCH(json({ departure_time: '11:30' }, 'PATCH'), { params: { id: DEST } })
    expect(res.status).toBe(200)
    expect(await res.json()).not.toHaveProperty('warnings')
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('POST /api/destinations：納入先は作成済みなので 201＋出発時刻・便名が未保存と分かる警告', async () => {
    scenario = (c) => {
      if (c.table === 'delivery_destinations' && c.op === 'select') return { data: [] }
      if (c.table === 'delivery_destinations' && c.op === 'insert') {
        const p = c.payload as Record<string, unknown>
        if ('departure_time' in p) return { error: MISSING_COL }
        return { data: { id: DEST, code: null, full_name: 'B店', aliases: [], is_active: true } }
      }
      if (c.table === 'app_settings' && c.op === 'select') return { data: null }
      if (c.table === 'app_settings' && c.op === 'upsert') return { error: { message: 'settings write failed' } }
      return undefined
    }
    const { POST } = await import('@/app/api/destinations/route')
    const res = await POST(json({ customer_id: CUST, full_name: 'B店', departure_time: '11:30' }, 'POST'))
    expect(res.status).toBe(201)
    const body = (await res.json()) as { warnings?: string[] }
    expect(body.warnings).toEqual([
      '納入先は登録しましたが、出発時刻・便名は保存できませんでした。この納入先の出発時刻・便名をもう一度保存してください',
    ])
  })

  const departureScenario = (opts: { columnOk: boolean; upsertError: string | null }) => (c: FakeCall): FakeResult | undefined => {
    if (c.table === 'delivery_destinations' && c.op === 'update') return opts.columnOk ? { data: null } : { error: MISSING_COL }
    if (c.table === 'orders' && c.op === 'update') return { data: null }
    if (c.table === 'app_settings' && c.op === 'select') return { data: null }
    if (c.table === 'app_settings' && c.op === 'upsert') return opts.upsertError ? { error: { message: opts.upsertError } } : { data: null }
    return undefined
  }
  const departureBody = (scope: 'master' | 'date_only') => ({
    deliveryDate: '2026-11-12',
    customerId: CUST,
    destinationId: DEST,
    departureTime: '11:30',
    shippingRouteName: 'NSK便',
    scope,
  })

  it.each(['master', 'date_only'] as const)(
    'POST /api/deliveries/departure-time（%s）：列に保存できず退避保存も失敗したら 500',
    async (scope) => {
      scenario = departureScenario({ columnOk: false, upsertError: 'settings write failed' })
      const { POST } = await import('@/app/api/deliveries/departure-time/route')
      const res = await POST(json(departureBody(scope), 'POST'))
      expect(res.status).toBe(500)
      const body = (await res.json()) as { error?: string; ok?: boolean }
      expect(body.ok).toBeUndefined()
      expect(body.error).toBe('出発時刻・便名を保存できませんでした。もう一度お試しください')
      expect(loggedText()).toMatch(/settings write failed/)
    },
  )

  it('POST /api/deliveries/departure-time：列に保存済みで退避側の同期だけ失敗したら、成功＋同期失敗と分かる警告', async () => {
    scenario = departureScenario({ columnOk: true, upsertError: 'settings write failed' })
    const { POST } = await import('@/app/api/deliveries/departure-time/route')
    const res = await POST(json(departureBody('master'), 'POST'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok?: boolean; warnings?: string[] }
    expect(body.ok).toBe(true)
    expect(body.warnings).toEqual([
      '出発時刻・便名は保存しましたが、控えの更新に失敗しました。表示が古いままの場合は、もう一度保存してください',
    ])
  })

  it('POST /api/deliveries/departure-time：列が無くても退避保存が成功すれば警告もエラーログも出さない', async () => {
    scenario = departureScenario({ columnOk: false, upsertError: null })
    const { POST } = await import('@/app/api/deliveries/departure-time/route')
    const res = await POST(json(departureBody('master'), 'POST'))
    expect(res.status).toBe(200)
    expect(await res.json()).not.toHaveProperty('warnings')
    expect(errorSpy).not.toHaveBeenCalled()
  })
})

describe('退避ストア（v5_destination_routes）の壊れた JSON', () => {
  const OTHER = '44444444-4444-4444-8444-444444444444'

  it('壊れた JSON は元の値をログに残して作り直し、保存を続ける', async () => {
    scenario = (c) => (c.table === 'app_settings' && c.op === 'select' ? { data: { value: '{"dest:x": {' } } : undefined)
    const { saveRouteOverride } = await import('@/lib/field/destination-routes-store')
    await saveRouteOverride(fake.client as never, [`dest:${DEST}`], { departureTime: '11:30', shippingRouteName: null })
    const up = fake.calls.find((c) => c.table === 'app_settings' && c.op === 'upsert')!
    expect(up).toBeDefined()
    expect(JSON.parse((up.payload as { value: string }).value)).toEqual({
      [`dest:${DEST}`]: { departureTime: '11:30', shippingRouteName: null },
    })
    expect(loggedText()).toMatch(/壊れているため作り直します/)
    expect(loggedText()).toContain('{"dest:x": {')
  })

  it('JSON として読めてもオブジェクトでない値（配列など）は壊れているとして作り直す', async () => {
    scenario = (c) => (c.table === 'app_settings' && c.op === 'select' ? { data: { value: '[1,2]' } } : undefined)
    const { saveRouteOverride } = await import('@/lib/field/destination-routes-store')
    await saveRouteOverride(fake.client as never, [`dest:${DEST}`], { departureTime: '11:30', shippingRouteName: null })
    const up = fake.calls.find((c) => c.table === 'app_settings' && c.op === 'upsert')!
    expect(Object.keys(JSON.parse((up.payload as { value: string }).value))).toEqual([`dest:${DEST}`])
  })

  it('正常な値は他の納入先の値を残したまま更新する', async () => {
    const stored = JSON.stringify({ [`dest:${OTHER}`]: { departureTime: '09:00', shippingRouteName: '和郷園便' } })
    scenario = (c) => (c.table === 'app_settings' && c.op === 'select' ? { data: { value: stored } } : undefined)
    const { saveRouteOverride } = await import('@/lib/field/destination-routes-store')
    await saveRouteOverride(fake.client as never, [`dest:${DEST}`], { departureTime: '11:30', shippingRouteName: null })
    const up = fake.calls.find((c) => c.table === 'app_settings' && c.op === 'upsert')!
    const saved = JSON.parse((up.payload as { value: string }).value) as Record<string, unknown>
    expect(saved[`dest:${OTHER}`]).toEqual({ departureTime: '09:00', shippingRouteName: '和郷園便' })
    expect(saved[`dest:${DEST}`]).toEqual({ departureTime: '11:30', shippingRouteName: null })
  })

  it('読み込みの通信・DBエラーでは上書きせず throw する（他の納入先の値を消さない）', async () => {
    scenario = (c) => (c.table === 'app_settings' && c.op === 'select' ? { error: { message: 'read timeout' } } : undefined)
    const { saveRouteOverride } = await import('@/lib/field/destination-routes-store')
    await expect(
      saveRouteOverride(fake.client as never, [`dest:${DEST}`], { departureTime: '11:30', shippingRouteName: null }),
    ).rejects.toThrow(/read timeout/)
    expect(fake.calls.some((c) => c.table === 'app_settings' && c.op === 'upsert')).toBe(false)
  })
})

describe('POST /api/order-items/reorder：退避ストア（v5_pack_sort_order）の壊れた JSON', () => {
  it('列への保存が成功した経路でも、壊れた値は元の値をログに残して作り直し、警告なしで保存する', async () => {
    scenario = (c) => {
      if (c.table === 'order_items' && c.op === 'update') return { data: null }
      if (c.table === 'app_settings' && c.op === 'select') return { data: { value: 'not json' } }
      return undefined
    }
    const { POST } = await import('@/app/api/order-items/reorder/route')
    const res = await POST(json({ items: [{ id: 'item-1', sortOrder: 10 }] }, 'POST') as never)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    const up = fake.calls.find((c) => c.table === 'app_settings' && c.op === 'upsert')!
    expect(JSON.parse((up.payload as { value: string }).value)).toEqual({ 'item-1': 10 })
    expect(loggedText()).toContain('not json')
  })

  it('列への保存が成功した経路で読み込みエラーなら上書きしない（警告で返す）', async () => {
    scenario = (c) => {
      if (c.table === 'order_items' && c.op === 'update') return { data: null }
      if (c.table === 'app_settings' && c.op === 'select') return { error: { message: 'read timeout' } }
      return undefined
    }
    const { POST } = await import('@/app/api/order-items/reorder/route')
    const res = await POST(json({ items: [{ id: 'item-1', sortOrder: 10 }] }, 'POST') as never)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { warnings?: string[] }
    expect(body.warnings).toHaveLength(1)
    expect(fake.calls.some((c) => c.table === 'app_settings' && c.op === 'upsert')).toBe(false)
  })
})

describe('既存明細の読み込み失敗で新規 insert しない（明細の二重登録を防ぐ）', () => {
  const masters = (c: FakeCall): FakeResult | undefined => {
    if (c.table === 'products') return { data: { id: PROD, name: '小松菜', unit: 'P', default_unit_price: 100, default_tax_rate: 8, container_capacity: 20 } }
    if (c.table === 'customers') return { data: { name: 'テスト青果' } }
    if (c.table === 'customer_product_rules') return { data: null }
    if (c.table === 'pack_configs') return { data: [] }
    if (c.table === 'orders' && c.op === 'select') return { data: { id: 'order-1' } }
    if (c.table === 'order_items' && c.op === 'select') return { error: { message: 'statement timeout' } }
    return undefined
  }

  it('PUT /api/shipments/cell：読み込み失敗は 500 で返し、書き込みに進まない', async () => {
    scenario = masters
    const { PUT } = await import('@/app/api/shipments/cell/route')
    const res = await PUT(json({ customer_id: CUST, destination_id: DEST, product_id: PROD, delivery_date: '2026-11-12', quantity_raw: '30' }))
    expect(res.status).toBe(500)
    expect(((await res.json()) as { error?: string }).error).toMatch(/明細を読み込めなかった/)
    expect(fake.calls.some((c) => c.op === 'insert' || c.op === 'update' || c.op === 'delete' || c.op === 'upsert')).toBe(false)
    expect(loggedText()).toMatch(/statement timeout/)
  })

  it('POST /api/shipments：読み込み失敗は 500 で返し、書き込みに進まない', async () => {
    scenario = masters
    const { POST } = await import('@/app/api/shipments/route')
    const res = await POST(json({ customer_id: CUST, product_id: PROD, delivery_date: '2026-11-12', quantity_raw: '30' }, 'POST'))
    expect(res.status).toBe(500)
    expect(((await res.json()) as { error?: string }).error).toMatch(/明細を読み込めなかった/)
    expect(fake.calls.some((c) => c.op === 'insert' || c.op === 'update' || c.op === 'delete' || c.op === 'upsert')).toBe(false)
  })
})
