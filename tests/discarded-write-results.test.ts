/**
 * 結果を確認していなかった書き込みを直したルートの挙動を固定する（engineering.md §5）。
 * - 本体の書き込みの失敗は 500
 * - 本体が成功した後の付随更新の失敗は 200＋warnings（詳細は console.error）
 * - 巻き戻しの失敗は console.error に残し、応答に「一部が残っている可能性」を含める
 * - 取り込み（process-receipt）は画面が無いので、受信票を要確認にして error_message と alerts に残す
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase, filterValue, type FakeCall, type FakeResult } from './support/fake-supabase'

const CUST = '11111111-1111-4111-8111-111111111111'
const PROD = '22222222-2222-4222-8222-222222222222'
const DEST = '33333333-3333-4333-8333-333333333333'
const ORDER = '44444444-4444-4444-8444-444444444444'
const PROD2 = '55555555-5555-4555-8555-555555555555'

let currentUser: { id: string } | null = { id: 'u-1' }
let scenario: (c: FakeCall) => FakeResult | undefined = () => undefined

const resolve = (c: FakeCall): FakeResult | undefined => {
  const r = scenario(c)
  if (r) return r
  if (c.table === 'users') return { data: { role: 'admin', id: 'u-1' } }
  return { data: null }
}
let fake = createFakeSupabase(resolve)

const analyzeOrdersMock = vi.fn()

vi.mock('@/lib/supabase/server', () => ({ getAuthedUser: async () => currentUser }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => fake.client }))
vi.mock('@/lib/gemini/analyze', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/gemini/analyze')>()),
  analyzeOrders: (...args: unknown[]) => analyzeOrdersMock(...args),
}))
let settings: Record<string, string | null> = {}
vi.mock('@/lib/settings', () => ({ getSetting: async (k: string) => settings[k] ?? null }))
vi.mock('@/lib/notifications/multi-channel', () => ({ sendMultiChannelAlert: async () => ({}) }))

let errorSpy: ReturnType<typeof vi.spyOn>
let warnSpy: ReturnType<typeof vi.spyOn>
let logSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  fake = createFakeSupabase(resolve)
  currentUser = { id: 'u-1' }
  scenario = () => undefined
  settings = {}
  analyzeOrdersMock.mockReset()
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => {
  errorSpy.mockRestore()
  warnSpy.mockRestore()
  logSpy.mockRestore()
})

function loggedText(): string {
  return errorSpy.mock.calls.map((args: unknown[]) => args.map(String).join(' ')).join('\n')
}

function json(body: unknown, method = 'POST'): Request {
  return new Request('http://localhost/api/x', {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/deliveries/confirm-customer（積込チェック）', () => {
  const body = { delivery_date: '2026-11-12', customer_id: CUST, destination_ids: [DEST], action: 'loaded' }
  const base = (over: (c: FakeCall) => FakeResult | undefined) => (c: FakeCall): FakeResult | undefined => {
    const r = over(c)
    if (r) return r
    if (c.table === 'deliveries' && c.op === 'select') return { data: [{ id: 'dlv-1', status: 'planned' }] }
    if (c.table === 'orders' && c.op === 'select') return { data: [{ id: ORDER }] }
    if (c.table === 'order_items' && c.op === 'select') return { data: [{ id: 'item-1', version: 3, field_status: 'packed' }] }
    return undefined
  }

  it('本体（deliveries の更新）が失敗したら 500 で返し、成功扱いにしない', async () => {
    scenario = base((c) => (c.table === 'deliveries' && c.op === 'update' ? { error: { message: 'deliveries locked' } } : undefined))
    const { POST } = await import('@/app/api/deliveries/confirm-customer/route')
    const res = await POST(json(body))
    expect(res.status).toBe(500)
    const j = (await res.json()) as { ok?: boolean; error?: string }
    expect(j.ok).toBeUndefined()
    expect(j.error).toMatch(/積込状態を保存できませんでした/)
    expect(loggedText()).toMatch(/deliveries locked/)
    // 本体が失敗したら付随の同期に進まない
    expect(fake.calls.some((c) => c.table === 'order_items' && c.op === 'update')).toBe(false)
  })

  it('付随（order_items の同期）が失敗しても 200＋警告。詳細はサーバーログ', async () => {
    scenario = base((c) => (c.table === 'order_items' && c.op === 'update' ? { error: { message: 'items timeout' } } : undefined))
    const { POST } = await import('@/app/api/deliveries/confirm-customer/route')
    const res = await POST(json(body))
    expect(res.status).toBe(200)
    const j = (await res.json()) as { ok?: boolean; warnings?: string[] }
    expect(j.ok).toBe(true)
    expect(j.warnings).toEqual([
      '積込状態は保存しましたが、出荷状況（パック・出荷の表示）の同期に失敗しました。画面を読み込み直して確認してください',
    ])
    expect(loggedText()).toMatch(/items timeout/)
    // orders.status の同期は続けて行う
    expect(fake.calls.some((c) => c.table === 'orders' && c.op === 'update')).toBe(true)
  })

  it('すべて成功なら warnings キーを付けない', async () => {
    scenario = base(() => undefined)
    const { POST } = await import('@/app/api/deliveries/confirm-customer/route')
    const res = await POST(json(body))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, action: 'loaded' })
    expect(errorSpy).not.toHaveBeenCalled()
  })
})

describe('POST /api/orders/[id]/reject（承認しない）', () => {
  const base = (over: (c: FakeCall) => FakeResult | undefined) => (c: FakeCall): FakeResult | undefined => {
    const r = over(c)
    if (r) return r
    if (c.table === 'orders' && c.op === 'select') return { data: { id: ORDER, status: 'pending_review', customer_id: CUST, note: null } }
    if (c.table === 'order_items' && c.op === 'select') return { data: [{ id: 'item-1' }, { id: 'item-2' }] }
    return undefined
  }

  it('収穫タスクの削除・受信票の更新に失敗しても却下は成功のまま、警告を返す', async () => {
    scenario = base((c) => {
      if (c.table === 'harvest_tasks' && c.op === 'delete') return { error: { message: 'ht denied' } }
      if (c.table === 'order_receipts' && c.op === 'update') return { error: { message: 'receipt denied' } }
      return undefined
    })
    const { POST } = await import('@/app/api/orders/[id]/reject/route')
    const res = await POST(json({ reason: '重複' }), { params: { id: ORDER } })
    expect(res.status).toBe(200)
    const j = (await res.json()) as { ok?: boolean; warnings?: string[] }
    expect(j.ok).toBe(true)
    expect(j.warnings).toHaveLength(2)
    expect(j.warnings?.[0]).toMatch(/収穫・パックの作業一覧から外せませんでした/)
    expect(j.warnings?.[1]).toMatch(/受信箱の表示を片付けられませんでした/)
    expect(loggedText()).toMatch(/ht denied/)
    expect(loggedText()).toMatch(/receipt denied/)
    const ordUpd = fake.calls.find((c) => c.table === 'orders' && c.op === 'update')!
    expect((ordUpd.payload as { status: string }).status).toBe('cancelled')
  })

  it('本体（注文の却下）が失敗したら 500。付随には進まない', async () => {
    scenario = base((c) => (c.table === 'orders' && c.op === 'update' ? { error: { message: 'orders locked' } } : undefined))
    const { POST } = await import('@/app/api/orders/[id]/reject/route')
    const res = await POST(json({}), { params: { id: ORDER } })
    expect(res.status).toBe(500)
    expect(fake.calls.some((c) => c.table === 'harvest_tasks')).toBe(false)
  })
})

describe('PATCH /api/order-items/[id]（数量変更）', () => {
  const current = {
    id: 'item-1',
    order_id: ORDER,
    product_id: PROD,
    product_name: '小松菜',
    quantity: 20,
    unit_price: 100,
    tax_rate: 8,
    version: 2,
    field_status: 'not_started',
    spec: null,
    container_type: null,
    has_card: null,
    has_seal: null,
    bag_type: null,
  }
  const base = (harvestError: string | null) => (c: FakeCall): FakeResult | undefined => {
    if (c.table === 'order_items' && c.op === 'select') return { data: current }
    if (c.table === 'order_items' && c.op === 'update') return { data: { ...current, ...(c.payload as object) } }
    if (c.table === 'harvest_tasks' && c.op === 'update') return harvestError ? { error: { message: harvestError } } : { data: null }
    return undefined
  }

  it('収穫数の同期に失敗しても数量は保存済みとして 200＋警告', async () => {
    scenario = base('ht write failed')
    const { PATCH } = await import('@/app/api/order-items/[id]/route')
    const res = await PATCH(json({ quantity: 30, version: 2 }, 'PATCH'), { params: { id: 'item-1' } })
    expect(res.status).toBe(200)
    const j = (await res.json()) as { item?: { quantity: number }; warnings?: string[] }
    expect(j.item?.quantity).toBe(30)
    expect(j.warnings).toEqual(['数量は保存しましたが、収穫数の更新に失敗しました。画面を読み込み直して確認してください'])
    expect(loggedText()).toMatch(/ht write failed/)
  })

  it('収穫数を新しい数量で同期する（成功時は warnings なし）', async () => {
    scenario = base(null)
    const { PATCH } = await import('@/app/api/order-items/[id]/route')
    const res = await PATCH(json({ quantity: 30, version: 2 }, 'PATCH'), { params: { id: 'item-1' } })
    expect(res.status).toBe(200)
    expect(await res.json()).not.toHaveProperty('warnings')
    const ht = fake.calls.find((c) => c.table === 'harvest_tasks' && c.op === 'update')!
    expect(ht.payload).toEqual({ required_qty: 30 })
    expect(filterValue(ht, 'eq', 'order_item_id')).toBe('item-1')
  })
})

describe('POST /api/orders（手入力の新規登録）', () => {
  const body = {
    customer_id: CUST,
    delivery_date: '2026-11-13',
    confirm_duplicate: true,
    items: [{ product_id: PROD, product_name: '小松菜', quantity: 20, unit: 'P' }],
  }
  const base = (rollbackError: string | null) => (c: FakeCall): FakeResult | undefined => {
    if (c.table === 'customers') return { data: { id: CUST, name: 'テスト青果' } }
    if (c.table === 'orders' && c.op === 'insert') return { data: { id: ORDER } }
    if (c.table === 'order_items' && c.op === 'insert') return { error: { message: 'items insert failed' } }
    if (c.table === 'orders' && c.op === 'delete') return rollbackError ? { error: { message: rollbackError } } : { data: null }
    return undefined
  }

  it('明細の登録に失敗し、巻き戻し（注文の削除）も失敗したら、一部が残っている可能性を伝えてログに残す', async () => {
    scenario = base('rollback denied')
    const { POST } = await import('@/app/api/orders/route')
    const res = await POST(json(body) as never)
    expect(res.status).toBe(500)
    const j = (await res.json()) as { error?: string; orderId?: string }
    expect(j.error).toMatch(/明細の登録に失敗しました/)
    expect(j.error).toMatch(/一部が残っている可能性/)
    expect(j.orderId).toBe(ORDER)
    expect(loggedText()).toMatch(/rollback denied/)
  })

  it('巻き戻しが成功したら、従来どおり明細の失敗だけを返す', async () => {
    scenario = base(null)
    const { POST } = await import('@/app/api/orders/route')
    const res = await POST(json(body) as never)
    expect(res.status).toBe(500)
    const j = (await res.json()) as { error?: string }
    expect(j.error).toBe('明細の登録に失敗しました: items insert failed')
    const del = fake.calls.find((c) => c.table === 'orders' && c.op === 'delete')!
    expect(filterValue(del, 'eq', 'id')).toBe(ORDER)
  })

  it('本体が成功し、収穫タスクの生成に失敗したら 200＋side_effect_warnings（数量の異常値 warnings とは別キー）', async () => {
    scenario = (c) => {
      if (c.table === 'customers') return { data: { id: CUST, name: 'テスト青果' } }
      if (c.table === 'orders' && c.op === 'insert') return { data: { id: ORDER } }
      if (c.table === 'order_items' && c.op === 'insert') return { data: { id: 'item-1' } }
      if (c.table === 'order_items' && c.op === 'select') return { data: [{ id: 'item-1', product_id: PROD, quantity: 20 }] }
      if (c.table === 'harvest_tasks' && c.op === 'insert') return { error: { message: 'ht insert failed' } }
      return undefined
    }
    const { POST } = await import('@/app/api/orders/route')
    const res = await POST(json(body) as never)
    expect(res.status).toBe(200)
    const j = (await res.json()) as { orderId?: string; warnings?: unknown; side_effect_warnings?: string[] }
    expect(j.orderId).toBe(ORDER)
    expect(j.warnings).toEqual({})
    expect(j.side_effect_warnings?.[0]).toMatch(/収穫・パックの作業一覧の更新に失敗/)
    expect(loggedText()).toMatch(/ht insert failed/)
  })
})

describe('processReceipt：既存注文への統合で新規明細の追加に失敗したとき', () => {
  const RECEIPT = 'rcpt-1'
  const prevItem = {
    id: 'prev-1',
    order_id: ORDER,
    product_id: PROD,
    product_name: '小松菜',
    quantity: 20,
    field_status: 'not_started',
    shipped_qty: null,
    version: 1,
    line_note: null,
  }
  const parsed = [
    {
      customer_name: 'テスト青果',
      destination_name: null,
      delivery_date: '2026-11-13',
      slip_no: null,
      note: null,
      items: [
        { raw_name: '小松菜', product_name: '小松菜', quantity: '20', unit: 'P', confidence: 0.95 },
        { raw_name: 'ほうれん草', product_name: 'ほうれん草', quantity: '30', unit: 'P', confidence: 0.95 },
      ],
    },
  ]
  const base = (insertError: { message: string; code?: string }, existingStatus = 'pending_review') => (c: FakeCall): FakeResult | undefined => {
    if (c.table === 'order_receipts' && c.op === 'select') {
      return {
        data: {
          id: RECEIPT,
          channel: 'email',
          r2_key: null,
          raw_payload: { text: '小松菜20P ほうれん草30P' },
          sender_date_key: null,
          customer_id: CUST,
          is_revision: false,
          status: 'pending_ai',
        },
      }
    }
    if (c.table === 'customers') return { data: [{ id: CUST, name: 'テスト青果', channel_identifiers: null }] }
    if (c.table === 'products' && c.op === 'select') {
      return {
        data: [
          { id: PROD, name: '小松菜', unit: 'P', aliases: [], default_tax_rate: 8, default_unit_price: 100 },
          { id: PROD2, name: 'ほうれん草', unit: 'P', aliases: [], default_tax_rate: 8, default_unit_price: 120 },
        ],
      }
    }
    if (c.table === 'orders' && c.op === 'select') {
      return { data: [{ id: ORDER, status: existingStatus, note: null, destination_id: null }] }
    }
    if (c.table === 'order_items' && c.op === 'select') return { data: [prevItem] }
    if (c.table === 'order_items' && c.op === 'insert') return { error: insertError }
    return undefined
  }

  it('明細を黙って欠落させない：受信票を要確認にし、error_message と alerts に残し、取り込み前から承認待ちだった注文は承認待ちに戻す', async () => {
    analyzeOrdersMock.mockResolvedValue({ is_order: true, orders: parsed, skip_reason: null, slip_no: null })
    scenario = base({ message: 'insert denied' })
    const { processReceipt } = await import('@/lib/ingestion/process-receipt')
    const result = await processReceipt(RECEIPT)

    expect(result.status).toBe('pending_review')
    const receiptUpd = fake.calls.filter((c) => c.table === 'order_receipts' && c.op === 'update').at(-1)!
    const p = receiptUpd.payload as { status: string; error_message: string | null; raw_payload: { slip_data: { alerts: { message: string; alert_type: string }[] } } }
    expect(p.status).toBe('pending_review')
    expect(p.error_message).toMatch(/ほうれん草/)
    expect(p.error_message).toMatch(/明細を注文に追加できませんでした/)
    expect(p.raw_payload.slip_data.alerts.some((a) => a.alert_type === '要確認' && /ほうれん草/.test(a.message))).toBe(true)
    // 自動承認のまま現場ボードに出さない（承認待ちに戻す）
    const backToReview = fake.calls.find(
      (c) => c.table === 'orders' && c.op === 'update' && (c.payload as { status?: string }).status === 'pending_review' && Object.keys(c.payload as object).length === 1,
    )
    expect(backToReview).toBeDefined()
    // 収穫タスクは作らない（承認待ちのため）
    expect(fake.calls.some((c) => c.table === 'harvest_tasks' && c.op === 'insert')).toBe(false)
    expect(loggedText()).toMatch(/insert denied/)
  })

  it('列が無いだけ（42703）なら基本列で再試行し、成功すれば要確認にも警告にもしない', async () => {
    analyzeOrdersMock.mockResolvedValue({ is_order: true, orders: parsed, skip_reason: null, slip_no: null })
    const missingCol = { message: 'column "bag_type" of relation "order_items" does not exist', code: '42703' }
    scenario = (c) => {
      if (c.table === 'order_items' && c.op === 'insert') {
        return 'bag_type' in (c.payload as object) ? { error: missingCol } : { data: { id: 'new-1', product_id: PROD2, quantity: 30 } }
      }
      if (c.table === 'order_items' && c.op === 'update') {
        return 'bag_type' in (c.payload as object) ? { error: missingCol } : { data: null }
      }
      return base(missingCol)(c)
    }
    const { processReceipt } = await import('@/lib/ingestion/process-receipt')
    const result = await processReceipt(RECEIPT)
    expect(result.status).toBe('approved')
    const receiptUpd = fake.calls.filter((c) => c.table === 'order_receipts' && c.op === 'update').at(-1)!
    expect((receiptUpd.payload as { error_message: unknown }).error_message).toBeNull()
    expect(fake.calls.some((c) => c.table === 'harvest_tasks' && c.op === 'insert')).toBe(true)
  })

  /** orders への update のうち status を書いたもの */
  const statusWrites = () =>
    fake.calls.filter((c) => c.table === 'orders' && c.op === 'update' && 'status' in (c.payload as object))
  const lastReceiptUpdate = () =>
    fake.calls.filter((c) => c.table === 'order_receipts' && c.op === 'update').at(-1)!.payload as {
      status: string
      error_message: string | null
      raw_payload: { ingest_review_hold?: boolean; slip_data: { alerts: { message: string; alert_type: string }[] } }
    }

  it('元から承認済みの注文に追加FAXが来て明細追加に失敗したら、承認待ちに戻し、受信票を要確認（印つき）にする', async () => {
    analyzeOrdersMock.mockResolvedValue({ is_order: true, orders: parsed, skip_reason: null, slip_no: null })
    scenario = base({ message: 'insert denied' }, 'approved')
    const { processReceipt } = await import('@/lib/ingestion/process-receipt')
    const result = await processReceipt(RECEIPT)
    expect(result.status).toBe('pending_review')
    // 欠けた明細のまま出荷一覧に出さない: 最後に書いた状態は承認待ち
    expect((statusWrites().at(-1)!.payload as { status: string }).status).toBe('pending_review')
    const p = lastReceiptUpdate()
    expect(p.status).toBe('pending_review')
    expect(p.raw_payload.ingest_review_hold).toBe(true)
    // 欠けた明細のまま収穫タスクを作らない
    expect(fake.calls.some((c) => c.table === 'harvest_tasks' && c.op === 'insert')).toBe(false)
  })

  /** order_items への書き込み（更新・追加） */
  const itemWrites = () => fake.calls.filter((c) => c.table === 'order_items' && (c.op === 'update' || c.op === 'insert'))

  it.each([
    ['shipped', '出荷済み'],
    ['invoiced', '請求済み'],
  ])(
    '元から %s の注文に追加・訂正FAXが来たら、明細を書き換えず・足さず、受信票を要確認（印つき）にして「今の数量 → FAXの数量」を残す',
    async (existingStatus, statusJa) => {
      // 小松菜 20 → 25 に訂正、ほうれん草 30 を追加
      const changed = [{ ...parsed[0]!, items: [{ ...parsed[0]!.items[0]!, quantity: '25' }, parsed[0]!.items[1]!] }]
      analyzeOrdersMock.mockResolvedValue({ is_order: true, orders: changed, skip_reason: null, slip_no: null })
      scenario = (c) => {
        if (c.table === 'order_items' && c.op === 'insert') return { data: { id: 'new-1', product_id: PROD2, quantity: 30 } }
        return base({ message: 'unused' }, existingStatus)(c)
      }
      const { processReceipt } = await import('@/lib/ingestion/process-receipt')
      const result = await processReceipt(RECEIPT)
      expect(result.status).toBe('pending_review')
      // 数量の変更も品目の追加も書かない・状態も変えない・収穫タスクも触らない
      expect(itemWrites()).toHaveLength(0)
      expect(statusWrites()).toHaveLength(0)
      expect(fake.calls.some((c) => c.table === 'harvest_tasks')).toBe(false)
      const p = lastReceiptUpdate()
      expect(p.status).toBe('pending_review')
      expect(p.raw_payload.ingest_review_hold).toBe(true)
      const hold = p.raw_payload.slip_data.alerts.filter((a) => a.alert_type === '要確認').map((a) => a.message).join('\n')
      expect(hold).toContain('小松菜 20P → 25P')
      expect(hold).toContain('追加: ほうれん草 30P')
      expect(hold).toContain(`（${statusJa}）`)
      expect(hold).toContain('反映していません')
      expect(hold).toContain('新しい注文として登録してください')
      expect(hold).not.toMatch(/shipped|invoiced/)
      expect(p.error_message).toContain('小松菜 20P → 25P')
    },
  )

  it.each(['pending_review', 'approved'])('元から %s の注文には、従来どおり数量の変更と品目の追加を反映する', async (existingStatus) => {
    const changed = [{ ...parsed[0]!, items: [{ ...parsed[0]!.items[0]!, quantity: '25' }, parsed[0]!.items[1]!] }]
    analyzeOrdersMock.mockResolvedValue({ is_order: true, orders: changed, skip_reason: null, slip_no: null })
    scenario = (c) => {
      if (c.table === 'order_items' && c.op === 'insert') return { data: { id: 'new-1', product_id: PROD2, quantity: 30 } }
      return base({ message: 'unused' }, existingStatus)(c)
    }
    const { processReceipt } = await import('@/lib/ingestion/process-receipt')
    await processReceipt(RECEIPT)
    const upd = fake.calls.find((c) => c.table === 'order_items' && c.op === 'update' && filterValue(c, 'eq', 'id') === 'prev-1')
    expect((upd?.payload as { quantity?: number } | undefined)?.quantity).toBe(25)
    expect(fake.calls.some((c) => c.table === 'order_items' && c.op === 'insert')).toBe(true)
    const hold = lastReceiptUpdate().raw_payload.slip_data.alerts.map((a) => a.message).join('\n')
    expect(hold).not.toContain('反映していません')
  })

  const approvedOrderOk = (c: FakeCall): FakeResult | undefined => {
    if (c.table === 'order_items' && c.op === 'insert') return { data: { id: 'new-1', product_id: PROD2, quantity: 30 } }
    return base({ message: 'unused' }, 'approved')(c)
  }

  it('元から承認済みの注文に、取り込みの判定が要確認の再送が来たら、承認待ちに戻る（確認ゲート）', async () => {
    analyzeOrdersMock.mockResolvedValue({ is_order: true, orders: parsed, skip_reason: null, slip_no: null })
    settings = { AUTO_APPROVE_ENABLED: 'off' } // 自動承認オフ → 判定は必ず要確認
    scenario = approvedOrderOk
    const { processReceipt } = await import('@/lib/ingestion/process-receipt')
    const result = await processReceipt(RECEIPT)
    expect(result.status).toBe('pending_review')
    const writes = statusWrites()
    expect(writes).toHaveLength(1)
    expect((writes[0]!.payload as { status: string }).status).toBe('pending_review')
    expect(fake.calls.some((c) => c.table === 'harvest_tasks' && c.op === 'insert')).toBe(false)
  })

  it('元から承認済みの注文に、取り込みの判定が自動承認の再送が来たら、承認済みのまま（承認待ちを書かない）', async () => {
    analyzeOrdersMock.mockResolvedValue({ is_order: true, orders: parsed, skip_reason: null, slip_no: null })
    settings = { AUTO_APPROVE_ENABLED: 'on' }
    scenario = approvedOrderOk
    const { processReceipt } = await import('@/lib/ingestion/process-receipt')
    const result = await processReceipt(RECEIPT)
    expect(result.status).toBe('approved')
    const writes = statusWrites()
    expect(writes.length).toBeGreaterThan(0)
    expect(writes.every((w) => (w.payload as { status: string }).status === 'approved')).toBe(true)
    expect(lastReceiptUpdate().raw_payload.ingest_review_hold).toBeUndefined()
  })

  it.each([
    ['shipped', '出荷済み'],
    ['invoiced', '請求済み'],
  ])('元から %s の注文に要確認の再送が来たら、状態は変えず、印の文言に日本語の状態名（%s）を出す', async (existingStatus, statusJa) => {
    analyzeOrdersMock.mockResolvedValue({ is_order: true, orders: parsed, skip_reason: null, slip_no: null })
    settings = { AUTO_APPROVE_ENABLED: 'off' }
    scenario = (c) => {
      if (c.table === 'order_items' && c.op === 'insert') return { data: { id: 'new-1', product_id: PROD2, quantity: 30 } }
      return base({ message: 'unused' }, existingStatus)(c)
    }
    const { processReceipt } = await import('@/lib/ingestion/process-receipt')
    await processReceipt(RECEIPT)
    expect(statusWrites()).toHaveLength(0)
    const p = lastReceiptUpdate()
    expect(p.raw_payload.ingest_review_hold).toBe(true)
    const holdMsg = p.raw_payload.slip_data.alerts.map((a) => a.message).join('\n')
    expect(holdMsg).toContain(`（${statusJa}）`)
    expect(holdMsg).not.toMatch(/shipped|invoiced/)
  })

  it.each(['shipped', 'invoiced'])('元から %s の注文は、取り込みが成功しても状態を上書きしない', async (existingStatus) => {
    // 今の注文と同じ内容の再送（差分なし）
    const same = [{ ...parsed[0]!, items: [parsed[0]!.items[0]!] }]
    analyzeOrdersMock.mockResolvedValue({ is_order: true, orders: same, skip_reason: null, slip_no: null })
    scenario = (c) => {
      if (c.table === 'order_items' && c.op === 'insert') return { data: { id: 'new-1', product_id: PROD2, quantity: 30 } }
      return base({ message: 'unused' }, existingStatus)(c)
    }
    const { processReceipt } = await import('@/lib/ingestion/process-receipt')
    await processReceipt(RECEIPT)
    expect(statusWrites()).toHaveLength(0)
    // 備考などのヘッダー更新は行う
    expect(fake.calls.some((c) => c.table === 'orders' && c.op === 'update' && 'note' in (c.payload as object))).toBe(true)
    expect(lastReceiptUpdate().raw_payload.ingest_review_hold).toBeUndefined()
  })

  it('取り込み前から承認待ちの注文は、判定どおり状態を更新する（従来どおり）', async () => {
    analyzeOrdersMock.mockResolvedValue({ is_order: true, orders: parsed, skip_reason: null, slip_no: null })
    scenario = (c) => {
      if (c.table === 'order_items' && c.op === 'insert') return { data: { id: 'new-1', product_id: PROD2, quantity: 30 } }
      return base({ message: 'unused' }, 'pending_review')(c)
    }
    const { processReceipt } = await import('@/lib/ingestion/process-receipt')
    await processReceipt(RECEIPT)
    expect(statusWrites().length).toBeGreaterThan(0)
  })
})

describe('processReceipt：既存注文・既存明細の読み込みに失敗したとき（二重登録の防止）', () => {
  const RECEIPT = 'rcpt-2'
  const parsed = [
    {
      customer_name: 'テスト青果',
      destination_name: null,
      delivery_date: '2026-11-13',
      slip_no: null,
      note: null,
      items: [{ raw_name: '小松菜', product_name: '小松菜', quantity: '20', unit: 'P', confidence: 0.95 }],
    },
  ]
  const base = (c: FakeCall): FakeResult | undefined => {
    if (c.table === 'order_receipts' && c.op === 'select') {
      return {
        data: {
          id: RECEIPT,
          channel: 'email',
          r2_key: null,
          raw_payload: { text: '小松菜20P' },
          sender_date_key: null,
          customer_id: CUST,
          is_revision: false,
          status: 'pending_ai',
          retry_count: 0,
        },
      }
    }
    if (c.table === 'customers') return { data: [{ id: CUST, name: 'テスト青果', channel_identifiers: null }] }
    if (c.table === 'products' && c.op === 'select') {
      return { data: [{ id: PROD, name: '小松菜', unit: 'P', aliases: [], default_tax_rate: 8, default_unit_price: 100 }] }
    }
    return undefined
  }
  const noNewOrderOrItems = () => {
    expect(fake.calls.some((c) => c.table === 'orders' && c.op === 'insert')).toBe(false)
    expect(fake.calls.some((c) => c.table === 'order_items' && c.op === 'insert')).toBe(false)
  }

  it('既存注文の読み込みに失敗したら新規作成に進まず、受信票を再試行待ち（ai_failed）にする', async () => {
    analyzeOrdersMock.mockResolvedValue({ is_order: true, orders: parsed, skip_reason: null, slip_no: null })
    scenario = (c) => {
      if (c.table === 'orders' && c.op === 'select') return { error: { message: 'orders read failed' } }
      return base(c)
    }
    const { processReceipt } = await import('@/lib/ingestion/process-receipt')
    const result = await processReceipt(RECEIPT)
    expect(result.status).toBe('ai_failed')
    noNewOrderOrItems()
    const upd = fake.calls.filter((c) => c.table === 'order_receipts' && c.op === 'update').at(-1)!.payload as {
      status: string
      next_retry_at: string | null
      error_message: string
    }
    expect(upd.status).toBe('ai_failed')
    expect(upd.next_retry_at).not.toBeNull()
    expect(upd.error_message).toMatch(/既存注文の読み込みに失敗/)
    expect(loggedText()).toMatch(/orders read failed/)
  })

  it('既存明細の読み込みに失敗したら明細を足さず、受信票を再試行待ち（ai_failed）にする', async () => {
    analyzeOrdersMock.mockResolvedValue({ is_order: true, orders: parsed, skip_reason: null, slip_no: null })
    scenario = (c) => {
      if (c.table === 'orders' && c.op === 'select') return { data: [{ id: ORDER, status: 'approved', note: null, destination_id: null }] }
      if (c.table === 'order_items' && c.op === 'select') return { error: { message: 'items read failed' } }
      return base(c)
    }
    const { processReceipt } = await import('@/lib/ingestion/process-receipt')
    const result = await processReceipt(RECEIPT)
    expect(result.status).toBe('ai_failed')
    noNewOrderOrItems()
    expect(fake.calls.some((c) => c.table === 'orders' && c.op === 'update')).toBe(false)
    expect(loggedText()).toMatch(/items read failed/)
  })

  it('未登録の納入先の自動登録に失敗したら、console.error と受信票の alerts に残す', async () => {
    analyzeOrdersMock.mockResolvedValue({
      is_order: true,
      orders: [{ ...parsed[0], destination_name: '新しい店' }],
      skip_reason: null,
      slip_no: null,
    })
    scenario = (c) => {
      if (c.table === 'delivery_destinations' && c.op === 'insert') return { error: { message: 'dest insert denied' } }
      if (c.table === 'orders' && c.op === 'insert') return { data: { id: ORDER } }
      if (c.table === 'order_items' && c.op === 'insert') return { data: [{ id: 'it-1', product_id: PROD, quantity: 20 }] }
      return base(c)
    }
    const { processReceipt } = await import('@/lib/ingestion/process-receipt')
    await processReceipt(RECEIPT)
    expect(loggedText()).toMatch(/dest insert denied/)
    const p = fake.calls.filter((c) => c.table === 'order_receipts' && c.op === 'update').at(-1)!.payload as {
      status: string
      raw_payload: { ingest_review_hold?: boolean; slip_data: { alerts: { message: string }[] } }
    }
    expect(p.status).toBe('pending_review')
    expect(p.raw_payload.ingest_review_hold).toBe(true)
    expect(p.raw_payload.slip_data.alerts.some((a) => /新しい店/.test(a.message) && /自動登録できませんでした/.test(a.message))).toBe(true)
  })
})

