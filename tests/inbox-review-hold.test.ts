/**
 * 受信箱の自動同期（注文が承認済みなら受信票を approved に片付ける）が、取り込みで要確認にした受信票
 * （raw_payload.ingest_review_hold = true。lib/ingestion/review-hold.ts）を消さないことを固定する。
 * 印のある受信票は受信リストの「要確認」に出て、人が「却下」で片付ける。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase, type FakeCall, type FakeResult } from './support/fake-supabase'

let scenario: (c: FakeCall) => FakeResult | undefined = () => undefined
let fake = createFakeSupabase((c) => scenario(c) ?? { data: null })
let pendingOrders: { id: string }[] = []

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => fake.client }))
vi.mock('@/lib/orders/pending', () => ({ getPendingOrders: async () => pendingOrders }))

let errorSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  fake = createFakeSupabase((c) => scenario(c) ?? { data: null })
  pendingOrders = []
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => errorSpy.mockRestore())

const HELD = {
  id: 'rcpt-held',
  channel: 'fax',
  status: 'pending_review',
  received_at: '2026-11-12T01:00:00Z',
  sender_date_key: null,
  is_revision: true,
  ocr_confidence: 0.9,
  r2_key: null,
  raw_payload: {
    ingest_review_hold: true,
    slip_data: { items: [], alerts: [{ alert_type: '要確認', message: 'ほうれん草: 明細を注文に追加できませんでした' }] },
  },
  order_id: 'ord-shipped',
  customer_id: null,
  error_message: '取り込み中に一部の保存に失敗しました: ほうれん草: 明細を注文に追加できませんでした',
}

function inboxScenario(c: FakeCall): FakeResult | undefined {
  if (c.table === 'orders' && c.op === 'select' && c.columns === 'id, status') {
    return { data: [{ id: 'ord-shipped', status: 'shipped' }, { id: 'ord-ok', status: 'approved' }] }
  }
  if (c.table === 'order_receipts' && c.op === 'select') {
    // 同期の候補（印の列だけを読む）
    if (c.columns?.includes('raw_payload->ingest_review_hold')) {
      return { data: [{ id: 'rcpt-held', ingest_review_hold: true }, { id: 'rcpt-ok', ingest_review_hold: null }] }
    }
    // 要確認の印つきの受信票
    if (c.filters.some((f) => f.method === 'eq' && f.args[0] === 'raw_payload->>ingest_review_hold')) {
      return { data: [HELD] }
    }
    return { data: [] }
  }
  return undefined
}

describe('getInboxData：取り込みで要確認にした受信票', () => {
  it('自動同期で approved に戻さない（印の無い受信票だけ同期する）', async () => {
    scenario = inboxScenario
    const { getInboxData } = await import('@/lib/orders/inbox')
    await getInboxData()
    const syncs = fake.calls.filter(
      (c) => c.table === 'order_receipts' && c.op === 'update' && (c.payload as { status?: string }).status === 'approved',
    )
    expect(syncs).toHaveLength(1)
    const ids = syncs[0]!.filters.find((f) => f.method === 'in' && f.args[0] === 'id')?.args[1]
    expect(ids).toEqual(['rcpt-ok'])
  })

  it('印つきの受信票は受信リストの要確認に出る（承認待ちの注文カードに出ないため）', async () => {
    scenario = inboxScenario
    const { getInboxData } = await import('@/lib/orders/inbox')
    const data = await getInboxData()
    const held = data.receipts.find((r) => r.id === 'rcpt-held')
    expect(held?.reviewHold).toBe(true)
    expect(held?.errorMessage).toMatch(/明細を注文に追加できませんでした/)
    expect(data.counts.review).toBe(1)
  })

  it('注文が承認待ちなら注文カード側に出るので、受信リストには重ねて出さない', async () => {
    scenario = inboxScenario
    pendingOrders = [{ id: 'ord-shipped' }]
    const { getInboxData } = await import('@/lib/orders/inbox')
    const data = await getInboxData()
    expect(data.receipts.some((r) => r.id === 'rcpt-held')).toBe(false)
  })

  it('同期候補の読み込みに失敗したら同期しない（ログに残す）', async () => {
    scenario = (c) => {
      if (c.table === 'order_receipts' && c.op === 'select' && c.columns?.includes('raw_payload->ingest_review_hold')) {
        return { error: { message: 'read failed' } }
      }
      return inboxScenario(c)
    }
    const { getInboxData } = await import('@/lib/orders/inbox')
    await getInboxData()
    expect(
      fake.calls.some((c) => c.table === 'order_receipts' && c.op === 'update' && (c.payload as { status?: string }).status === 'approved'),
    ).toBe(false)
    expect(errorSpy.mock.calls.flat().join(' ')).toMatch(/read failed/)
  })
})

describe('hasIngestReviewHold', () => {
  it('印が true のときだけ真（文言では判定しない）', async () => {
    const { hasIngestReviewHold } = await import('@/lib/ingestion/review-hold')
    expect(hasIngestReviewHold({ ingest_review_hold: true })).toBe(true)
    expect(hasIngestReviewHold({ ingest_review_hold: 'true' })).toBe(false)
    expect(hasIngestReviewHold({})).toBe(false)
    expect(hasIngestReviewHold(null)).toBe(false)
    expect(hasIngestReviewHold([])).toBe(false)
  })
})

describe('POST /api/receipts/[id]/dismiss：印つきの受信票も人が片付けられる', () => {
  it('pending_review の受信票を dismissed にする', async () => {
    vi.doMock('@/lib/auth/api-guard', () => ({ requireAdminApi: async () => ({ ok: true, user: { id: 'u-1' } }) }))
    scenario = (c) => (c.table === 'order_receipts' && c.op === 'update' ? { data: [{ id: 'rcpt-held' }] } : undefined)
    const { POST } = await import('@/app/api/receipts/[id]/dismiss/route')
    const res = await POST(new Request('http://x', { method: 'POST' }), { params: { id: 'rcpt-held' } })
    expect(res.status).toBe(200)
    const upd = fake.calls.find((c) => c.table === 'order_receipts' && c.op === 'update')!
    expect(upd.payload).toEqual({ status: 'dismissed' })
    const allowed = upd.filters.find((f) => f.method === 'in' && f.args[0] === 'status')?.args[1] as string[]
    expect(allowed).toContain('pending_review')
  })
})
