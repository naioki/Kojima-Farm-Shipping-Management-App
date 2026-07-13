import { describe, it, expect, beforeEach, vi } from 'vitest'

// server 専用の依存はすべてモックし、DB には実接続しない。
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/orders/approve', () => ({ approveOrder: vi.fn() }))
vi.mock('@/lib/shipping-docs/queue', () => ({ enqueuePrintJob: vi.fn() }))
vi.mock('@/lib/orders/pending', () => ({ getPendingOrders: vi.fn(), pendingReasons: vi.fn() }))

import { createAdminClient } from '@/lib/supabase/admin'
import { approveOrder } from '@/lib/orders/approve'
import { enqueuePrintJob } from '@/lib/shipping-docs/queue'
import { getPendingOrders, pendingReasons } from '@/lib/orders/pending'
import type { PendingOrder } from '@/lib/orders/pending'
import { listPendingApprovals, approveAndPrint } from './use-cases'

// maybeSingle で終わる Supabase クエリチェーンの最小モック。
function singleChain(result: { data: unknown; error: unknown }) {
  const c: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'not', 'order', 'limit', 'in', 'gte', 'lt']) {
    c[m] = vi.fn(() => c)
  }
  c.maybeSingle = vi.fn(async () => result)
  return c
}

function adminWithRole(role: string | null) {
  const usersChain = singleChain({ data: role ? { role } : null, error: null })
  return { from: vi.fn(() => usersChain) }
}

function pendingOrderFixture(overrides: Partial<PendingOrder> = {}): PendingOrder {
  return {
    id: 'order-1',
    source: 'email',
    deliveryDate: '2026-07-15',
    customerId: 'cust-1',
    customerName: 'ヨーク',
    customerColor: null,
    destinationName: '東道野辺',
    minConfidence: 0.5,
    needsDeliveryDate: false,
    needsDestination: true,
    destinationOptions: [{ id: 'd1', label: '東道野辺' }],
    staffApprovable: false,
    items: [
      {
        id: 'i1',
        productId: 'p1',
        productName: 'トマト',
        quantity: 15,
        unit: '箱',
        confidence: 0.9,
        version: 1,
        packConfigId: 'pc1',
        packConfigOptions: [],
      },
      {
        id: 'i2',
        productId: 'p2',
        productName: '胡瓜',
        quantity: 3,
        unit: '箱',
        confidence: 0.5,
        version: 1,
        packConfigId: 'pc2',
        packConfigOptions: [],
      },
    ],
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('approveAndPrint', () => {
  it('(a) 承認ゲートで弾かれたら日本語 error を返し、印刷は投入しない', async () => {
    vi.mocked(createAdminClient).mockReturnValue(adminWithRole('admin') as never)
    vi.mocked(approveOrder).mockResolvedValue({ ok: false, status: 400, error: '納入先を選択してください' })

    const res = await approveAndPrint('order-1', {}, 'user-admin')

    expect(res.success).toBe(false)
    expect(res.error).toBe('納入先を選択してください')
    expect(res.orderId).toBe('order-1')
    expect(enqueuePrintJob).not.toHaveBeenCalled()
  })

  it('承認成功なら印刷キューへ投入し jobId を返す', async () => {
    vi.mocked(createAdminClient).mockReturnValue(adminWithRole('admin') as never)
    vi.mocked(approveOrder).mockResolvedValue({ ok: true, tasksCreated: 2, deliveryDate: '2026-07-15' })
    vi.mocked(enqueuePrintJob).mockResolvedValue({ ok: true, id: 'job-1' })

    const res = await approveAndPrint('order-1', {}, 'user-admin')

    expect(res.success).toBe(true)
    expect(res.jobId).toBe('job-1')
    expect(res.deliveryDate).toBe('2026-07-15')
    expect(enqueuePrintJob).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ date: '2026-07-15', docType: 'sheet', requestedBy: 'user-admin' }),
    )
  })

  it('実行者ロールが admin/staff でなければ権限エラー', async () => {
    vi.mocked(createAdminClient).mockReturnValue(adminWithRole(null) as never)

    const res = await approveAndPrint('order-1', {}, 'unknown-user')

    expect(res.success).toBe(false)
    expect(res.error).toBe('権限がありません')
    expect(approveOrder).not.toHaveBeenCalled()
  })
})

describe('listPendingApprovals', () => {
  it('(b) blockingReasons と 取引先＞納入先表記を正しく載せる', async () => {
    vi.mocked(getPendingOrders).mockResolvedValue([pendingOrderFixture()])
    vi.mocked(pendingReasons).mockReturnValue(['のうにゅうさき みてい', 'AI じしんなし'])

    const res = await listPendingApprovals()

    expect(res.success).toBe(true)
    if (!res.success) return
    expect(res.items).toHaveLength(1)
    const item = res.items[0]!
    // formatSupplyDestination は実物を使用（取引先＞納入先＝スペース区切り）
    expect(item.customerName).toBe('ヨーク 東道野辺')
    expect(item.deliveryDate).toBe('2026-07-15')
    expect(item.itemsSummary).toBe('トマト 15箱, 胡瓜 3箱')
    expect(item.blockingReasons).toEqual(['のうにゅうさき みてい', 'AI じしんなし'])
  })

  it('納入先なしの取引先は取引先名のみ（寺崎など）', async () => {
    vi.mocked(getPendingOrders).mockResolvedValue([
      pendingOrderFixture({ customerName: '寺崎', destinationName: null }),
    ])
    vi.mocked(pendingReasons).mockReturnValue([])

    const res = await listPendingApprovals()
    expect(res.success).toBe(true)
    if (!res.success) return
    expect(res.items[0]!.customerName).toBe('寺崎')
  })

  it('(c) 例外時は success:false を返す（握りつぶさない）', async () => {
    vi.mocked(getPendingOrders).mockRejectedValue(new Error('DB down'))

    const res = await listPendingApprovals()

    expect(res.success).toBe(false)
    if (res.success) return
    expect(res.error).toBe('DB down')
  })
})
