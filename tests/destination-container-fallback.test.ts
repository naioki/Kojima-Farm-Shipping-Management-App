/**
 * 規定コンテナ（delivery_destinations.default_container_type）は本番に列が無い。
 * 列が無い環境では退避ストア（app_settings v5_destination_routes の dest:<id>）へ保存し、読む側は
 * 「列の値 → 退避ストアの値」で解決する。保存できなかった項目があるのに警告なしの成功を返さない。
 * あわせて、週の管理（/api/shipments/cell）で新しい注文を作るときの受注経路の必須化も固定する。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase, type FakeCall, type FakeResult } from './support/fake-supabase'

const CUST = '11111111-1111-4111-8111-111111111111'
const PROD = '22222222-2222-4222-8222-222222222222'
const DEST = '33333333-3333-4333-8333-333333333333'
const OTHER = '44444444-4444-4444-8444-444444444444'

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

let errorSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  fake = createFakeSupabase(resolve)
  scenario = () => undefined
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => errorSpy.mockRestore())

function req(body: unknown, method: string): Request {
  return new Request('http://localhost/api/x', {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** 本番と同じく拡張4列が無い */
const MISSING_COL = { message: 'column "default_container_type" of relation "delivery_destinations" does not exist', code: '42703' }
const BASE_ROW = { id: DEST, code: 'A店', full_name: 'A店', aliases: [], is_active: true }

function savedStore(): Record<string, Record<string, unknown>> {
  const up = fake.calls.filter((c) => c.table === 'app_settings' && c.op === 'upsert').at(-1)
  if (!up) return {}
  return JSON.parse((up.payload as { value: string }).value) as Record<string, Record<string, unknown>>
}

/** 列なし環境：拡張列を含む update / insert は 42703、基本列は成功 */
const noColumns =
  (opts: { stored?: string | null; upsertError?: string | null } = {}) =>
  (c: FakeCall): FakeResult | undefined => {
    if (c.table === 'delivery_destinations' && (c.op === 'update' || c.op === 'insert')) {
      const p = c.payload as Record<string, unknown>
      if (['departure_time', 'shipping_route_name', 'pack_sort_order', 'default_container_type'].some((k) => k in p)) {
        return { error: MISSING_COL }
      }
      return { data: { ...BASE_ROW, ...p } }
    }
    if (c.table === 'delivery_destinations' && c.op === 'select') {
      return { data: c.terminal ? BASE_ROW : [] }
    }
    if (c.table === 'app_settings' && c.op === 'select') {
      return { data: opts.stored ? { value: opts.stored } : null }
    }
    if (c.table === 'app_settings' && c.op === 'upsert') {
      return opts.upsertError ? { error: { message: opts.upsertError } } : { data: null }
    }
    return undefined
  }

describe('PATCH /api/destinations/[id]：列が無い環境の規定コンテナ', () => {
  it('規定コンテナは退避ストアの dest:<id> に入り、他の納入先・出発時刻は残る。警告なし', async () => {
    const stored = JSON.stringify({
      [`dest:${DEST}`]: { departureTime: '16:00', shippingRouteName: '16時便' },
      [`dest:${OTHER}`]: { departureTime: '09:00', shippingRouteName: null, defaultContainerType: '茶コン' },
    })
    scenario = noColumns({ stored })
    const { PATCH } = await import('@/app/api/destinations/[id]/route')
    const res = await PATCH(req({ full_name: 'A店', default_container_type: '青コン' }, 'PATCH'), { params: { id: DEST } })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { destination?: Record<string, unknown>; warnings?: string[] }
    expect(body.warnings).toBeUndefined()
    expect(body.destination?.default_container_type).toBe('青コン')
    const s = savedStore()
    expect(s[`dest:${DEST}`]).toEqual({ departureTime: '16:00', shippingRouteName: '16時便', defaultContainerType: '青コン' })
    expect(s[`dest:${OTHER}`]).toEqual({ departureTime: '09:00', shippingRouteName: null, defaultContainerType: '茶コン' })
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('取引先詳細の保存（名前・出発時刻・便名・規定コンテナを一度に送る）でも全部が退避ストアに入る', async () => {
    scenario = noColumns()
    const { PATCH } = await import('@/app/api/destinations/[id]/route')
    const res = await PATCH(
      req({ code: 'A店', full_name: 'A店', aliases: [], is_active: true, departure_time: '11:30', shipping_route_name: '岩槻便', default_container_type: '青コン' }, 'PATCH'),
      { params: { id: DEST } },
    )
    expect(res.status).toBe(200)
    expect(await res.json()).not.toHaveProperty('warnings')
    expect(savedStore()[`dest:${DEST}`]).toEqual({ departureTime: '11:30', shippingRouteName: '岩槻便', defaultContainerType: '青コン' })
    // 退避ストアへの書き込みは1回にまとめる
    expect(fake.calls.filter((c) => c.table === 'app_settings' && c.op === 'upsert')).toHaveLength(1)
  })

  it('規定コンテナを空にすると退避ストアからも消える（未設定に戻る）', async () => {
    scenario = noColumns({ stored: JSON.stringify({ [`dest:${DEST}`]: { defaultContainerType: '青コン' } }) })
    const { PATCH } = await import('@/app/api/destinations/[id]/route')
    const res = await PATCH(req({ full_name: 'A店', default_container_type: null }, 'PATCH'), { params: { id: DEST } })
    expect(res.status).toBe(200)
    expect(savedStore()[`dest:${DEST}`]).toEqual({})
  })

  it('規定コンテナだけの変更で退避保存に失敗したら 500（成功扱いにしない）', async () => {
    scenario = noColumns({ upsertError: 'settings write failed' })
    const { PATCH } = await import('@/app/api/destinations/[id]/route')
    const res = await PATCH(req({ default_container_type: '青コン' }, 'PATCH'), { params: { id: DEST } })
    expect(res.status).toBe(500)
    expect(((await res.json()) as { error?: string }).error).toBe('規定コンテナを保存できませんでした。もう一度お試しください')
  })

  it('名前は保存済みで規定コンテナの退避保存に失敗したら、成功＋規定コンテナが未保存と分かる警告', async () => {
    scenario = noColumns({ upsertError: 'settings write failed' })
    const { PATCH } = await import('@/app/api/destinations/[id]/route')
    const res = await PATCH(req({ full_name: 'A店', default_container_type: '青コン' }, 'PATCH'), { params: { id: DEST } })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { warnings?: string[]; destination?: Record<string, unknown> }
    expect(body.warnings).toEqual(['納入先名などは保存しましたが、規定コンテナは保存できませんでした。規定コンテナをもう一度保存してください'])
    expect(body.destination?.default_container_type).toBeUndefined()
  })

  it('並び順（pack_sort_order）は退避先が無いので、列が無ければ警告を返す（黙って捨てない）', async () => {
    scenario = noColumns()
    const { PATCH } = await import('@/app/api/destinations/[id]/route')
    const res = await PATCH(req({ full_name: 'A店', pack_sort_order: 3 }, 'PATCH'), { params: { id: DEST } })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { warnings?: string[] }).warnings).toEqual([
      'この環境では納入先の並び順を保存できません。並び順は変わっていません',
    ])
  })

  it('列がある環境では従来どおり列に保存し、規定コンテナは退避ストアに書かない', async () => {
    scenario = (c) => {
      if (c.table === 'delivery_destinations' && c.op === 'update') {
        return { data: { ...BASE_ROW, ...(c.payload as object) } }
      }
      if (c.table === 'app_settings' && c.op === 'select') return { data: null }
      return undefined
    }
    const { PATCH } = await import('@/app/api/destinations/[id]/route')
    const res = await PATCH(req({ full_name: 'A店', default_container_type: '青コン', pack_sort_order: 2 }, 'PATCH'), { params: { id: DEST } })
    expect(res.status).toBe(200)
    expect(await res.json()).not.toHaveProperty('warnings')
    const upd = fake.calls.find((c) => c.table === 'delivery_destinations' && c.op === 'update')!
    expect(upd.payload).toMatchObject({ default_container_type: '青コン', pack_sort_order: 2 })
    expect(fake.calls.some((c) => c.table === 'app_settings' && c.op === 'upsert')).toBe(false)
  })
})

describe('POST /api/destinations：列が無い環境の規定コンテナ', () => {
  it('登録した納入先の規定コンテナが退避ストアに入り、応答にも載る（画面のカードに出る）', async () => {
    scenario = noColumns()
    const { POST } = await import('@/app/api/destinations/route')
    const res = await POST(req({ customer_id: CUST, full_name: 'B店', default_container_type: '青コン' }, 'POST'))
    expect(res.status).toBe(201)
    const body = (await res.json()) as { destination?: Record<string, unknown>; warnings?: string[] }
    expect(body.warnings).toBeUndefined()
    expect(body.destination?.default_container_type).toBe('青コン')
    expect(savedStore()[`dest:${DEST}`]).toEqual({ defaultContainerType: '青コン' })
  })

  it('退避保存に失敗したら 201＋規定コンテナが未保存と分かる警告', async () => {
    scenario = noColumns({ upsertError: 'settings write failed' })
    const { POST } = await import('@/app/api/destinations/route')
    const res = await POST(req({ customer_id: CUST, full_name: 'B店', default_container_type: '青コン' }, 'POST'))
    expect(res.status).toBe(201)
    expect(((await res.json()) as { warnings?: string[] }).warnings).toEqual([
      '納入先は登録しましたが、規定コンテナは保存できませんでした。この納入先の規定コンテナをもう一度保存してください',
    ])
  })

  it('列がある環境では列に保存し、退避ストアには書かない', async () => {
    scenario = (c) => {
      if (c.table === 'delivery_destinations' && c.op === 'select') return { data: [] }
      if (c.table === 'delivery_destinations' && c.op === 'insert') return { data: { ...BASE_ROW, ...(c.payload as object) } }
      return undefined
    }
    const { POST } = await import('@/app/api/destinations/route')
    const res = await POST(req({ customer_id: CUST, full_name: 'B店', default_container_type: '青コン' }, 'POST'))
    expect(res.status).toBe(201)
    const ins = fake.calls.find((c) => c.table === 'delivery_destinations' && c.op === 'insert')!
    expect(ins.payload).toMatchObject({ default_container_type: '青コン' })
    expect(fake.calls.some((c) => c.table === 'app_settings')).toBe(false)
  })
})

describe('読み出し：列の値 → 退避ストアの値', () => {
  it('loadRouteOverrides は規定コンテナを containers に分け、規定コンテナだけのエントリは出発時刻・便名の解決に出さない', async () => {
    const { loadRouteOverrides, resolveDestDefaultContainer } = await import('@/lib/field/destination-routes-store')
    const stored = JSON.stringify({
      [`dest:${DEST}`]: { defaultContainerType: '青コン' },
      [`dest:${OTHER}`]: { departureTime: '16:00', shippingRouteName: null, defaultContainerType: '茶コン' },
      [`cust:${CUST}:default`]: { departureTime: '18:00', shippingRouteName: '岩槻便' },
    })
    const client = createFakeSupabase((c) => (c.table === 'app_settings' ? { data: { value: stored } } : undefined)).client
    const r = await loadRouteOverrides(client as never)
    expect(r.containers).toEqual({ [DEST]: '青コン', [OTHER]: '茶コン' })
    expect(r.overrides[`dest:${DEST}`]).toBeUndefined()
    expect(r.overrides[`dest:${OTHER}`]?.departureTime).toBe('16:00')
    expect(resolveDestDefaultContainer(DEST, null, r.containers)).toBe('青コン')
    expect(resolveDestDefaultContainer(DEST, undefined, r.containers)).toBe('青コン')
    // 列に値があれば列が優先
    expect(resolveDestDefaultContainer(DEST, '段ボール', r.containers)).toBe('段ボール')
    expect(resolveDestDefaultContainer('unknown', null, r.containers)).toBeNull()
  })

  it('出発時刻の保存は同じエントリの規定コンテナを消さない', async () => {
    scenario = (c) =>
      c.table === 'app_settings' && c.op === 'select'
        ? { data: { value: JSON.stringify({ [`dest:${DEST}`]: { defaultContainerType: '青コン' } }) } }
        : undefined
    const { saveRouteOverride } = await import('@/lib/field/destination-routes-store')
    await saveRouteOverride(fake.client as never, [`dest:${DEST}`], { departureTime: '11:30', shippingRouteName: null })
    expect(savedStore()[`dest:${DEST}`]).toEqual({ departureTime: '11:30', shippingRouteName: null, defaultContainerType: '青コン' })
  })

  it('POST /api/shipments（注文の受付・現場の追加）は列が無くても退避ストアの規定コンテナを明細に使う', async () => {
    scenario = (c) => {
      if (c.table === 'delivery_destinations' && c.op === 'select') return { data: { id: DEST, customer_id: CUST, code: 'A店', full_name: 'A店', is_active: true } }
      if (c.table === 'customers') return { data: { id: CUST, name: 'テスト青果' } }
      if (c.table === 'products') return { data: { id: PROD, name: 'キュウリ', unit: 'P', default_unit_price: 100, default_tax_rate: 8, container_capacity: 30 } }
      if (c.table === 'app_settings' && c.op === 'select') {
        return { data: { value: JSON.stringify({ [`dest:${DEST}`]: { defaultContainerType: '黄コン' } }) } }
      }
      if (c.table === 'orders' && c.op === 'insert') return { data: { id: 'order-1' } }
      if (c.table === 'order_items' && c.op === 'insert') return { data: { id: 'item-1', ...(c.payload as object) } }
      return undefined
    }
    const { POST } = await import('@/app/api/shipments/route')
    const res = await POST(
      req({ customer_id: CUST, destination_id: DEST, product_id: PROD, delivery_date: '2026-11-13', quantity_raw: '60', intake_channel: 'phone' }, 'POST') as never,
    )
    expect(res.status).toBe(201)
    const ins = fake.calls.find((c) => c.table === 'order_items' && c.op === 'insert')!
    expect((ins.payload as Record<string, unknown>).container_type).toBe('黄コン')
    const ord = fake.calls.find((c) => c.table === 'orders' && c.op === 'insert')!
    expect((ord.payload as Record<string, unknown>).intake_channel).toBe('phone')
  })
})

describe('PUT /api/shipments/cell（週の管理）：新しい注文の受注経路', () => {
  const cellScenario = (c: FakeCall): FakeResult | undefined => {
    if (c.table === 'products') return { data: { id: PROD, name: 'キュウリ', unit: 'P', default_unit_price: 100, default_tax_rate: 8, container_capacity: 30 } }
    if (c.table === 'customers') return { data: { name: 'テスト青果' } }
    if (c.table === 'orders' && c.op === 'select') return { data: null }
    if (c.table === 'orders' && c.op === 'insert') return { data: { id: 'order-new' } }
    if (c.table === 'order_items' && c.op === 'insert') return { data: { id: 'item-new', ...(c.payload as object) } }
    return undefined
  }
  const body = { customer_id: CUST, product_id: PROD, delivery_date: '2026-11-13', quantity_raw: '30' }

  it('受注経路が無いまま新しい注文を作ろうとしたら 400（注文も明細も作らない）', async () => {
    scenario = cellScenario
    const { PUT } = await import('@/app/api/shipments/cell/route')
    const res = await PUT(req(body, 'PUT'))
    expect(res.status).toBe(400)
    const j = (await res.json()) as { error?: string; message?: string }
    expect(j.error).toBe('intake_channel_required')
    expect(j.message).toBe('受注経路（電話・LINE・紙・その他）を選んでから登録してください')
    expect(fake.calls.some((c) => c.op === 'insert')).toBe(false)
  })

  it('受注経路を選んでいれば、新しい注文に intake_channel が入る', async () => {
    scenario = cellScenario
    const { PUT } = await import('@/app/api/shipments/cell/route')
    const res = await PUT(req({ ...body, intake_channel: 'line' }, 'PUT'))
    expect(res.status).toBe(201)
    const ord = fake.calls.find((c) => c.table === 'orders' && c.op === 'insert')!
    expect(ord.payload).toMatchObject({ intake_channel: 'line', source: 'manual' })
  })
})

describe('受注経路の決め方（画面の共通規則）', () => {
  it('固定の経路（受信ボックスの原本）→ 選んだ経路 → 未選択は null（既定値を勝手に入れない）', async () => {
    const { resolveIntakeChannel } = await import('@/lib/orders/intake-channel')
    expect(resolveIntakeChannel('fax', 'phone')).toBe('fax')
    expect(resolveIntakeChannel(null, 'line')).toBe('line')
    expect(resolveIntakeChannel(null, null)).toBeNull()
    expect(resolveIntakeChannel(undefined, undefined)).toBeNull()
  })
})

describe('saveDestDefaultContainer（明細のコンテナ変更からの自動更新）', () => {
  it('列が無ければ退避ストアへ保存する', async () => {
    scenario = noColumns()
    const { saveDestDefaultContainer } = await import('@/lib/field/destination-routes-store')
    const r = await saveDestDefaultContainer(fake.client as never, DEST, '青コン')
    expect(r.error).toBeNull()
    expect(savedStore()[`dest:${DEST}`]).toEqual({ defaultContainerType: '青コン' })
  })

  it('退避保存に失敗したら error を返す（呼び出し側が警告にする）', async () => {
    scenario = noColumns({ upsertError: 'settings write failed' })
    const { saveDestDefaultContainer } = await import('@/lib/field/destination-routes-store')
    const r = await saveDestDefaultContainer(fake.client as never, DEST, '青コン')
    expect(r.error?.message).toMatch(/settings write failed/)
  })

  it('列があれば列だけに保存する', async () => {
    scenario = (c) => (c.table === 'delivery_destinations' && c.op === 'update' ? { data: null } : undefined)
    const { saveDestDefaultContainer } = await import('@/lib/field/destination-routes-store')
    const r = await saveDestDefaultContainer(fake.client as never, DEST, '青コン')
    expect(r.error).toBeNull()
    expect(fake.calls.some((c) => c.table === 'app_settings')).toBe(false)
  })
})
