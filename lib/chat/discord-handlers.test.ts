import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ユースケース・actor 解決・設定取得はすべてモック（DB/HTTP には触れない）。
vi.mock('./use-cases', () => ({
  listPendingApprovals: vi.fn(),
  listRecentConfirmed: vi.fn(),
  approveAndPrint: vi.fn(),
  reprint: vi.fn(),
}))
vi.mock('./discord-actor', () => ({ resolveChatActorUserId: vi.fn() }))
vi.mock('@/lib/settings', () => ({ getSetting: vi.fn() }))

import { approveAndPrint, reprint } from './use-cases'
import { resolveChatActorUserId } from './discord-actor'
import { getSetting } from '@/lib/settings'
import {
  runApproveAndPrint,
  runReprint,
  runIngest,
  buildPreviewResponse,
  buildPrintCommandResponse,
  formatDateLabel,
} from './discord-handlers'
import type { PendingApprovalView } from './use-cases'

type EmbedPayload = { embeds: Array<{ title: string; description: string }> }
const embedOf = (res: { data?: Record<string, unknown> }) =>
  (res.data as unknown as EmbedPayload).embeds[0]!

beforeEach(() => {
  vi.clearAllMocks()
})

describe('runApproveAndPrint（同期・type:4 で結果 embed を返す）', () => {
  it('approve フローは approveAndPrint を正しい引数で呼び、成功 embed を返す', async () => {
    vi.mocked(resolveChatActorUserId).mockResolvedValue({ ok: true, userId: 'user-admin' })
    vi.mocked(approveAndPrint).mockResolvedValue({
      success: true,
      orderId: 'order-1',
      deliveryDate: '2026-07-15',
      jobId: 'job-123',
    })

    const res = await runApproveAndPrint('order-1', {})

    expect(approveAndPrint).toHaveBeenCalledWith('order-1', {}, 'user-admin')
    expect(res.type).toBe(4)
    expect(embedOf(res).title).toContain('✅')
  })

  it('日付指定ありの承認は deliveryDate を渡す', async () => {
    vi.mocked(resolveChatActorUserId).mockResolvedValue({ ok: true, userId: 'user-admin' })
    vi.mocked(approveAndPrint).mockResolvedValue({ success: true, orderId: 'order-1', deliveryDate: '2026-06-15' })

    await runApproveAndPrint('order-1', { deliveryDate: '2026-06-15' })

    expect(approveAndPrint).toHaveBeenCalledWith('order-1', { deliveryDate: '2026-06-15' }, 'user-admin')
  })

  it('ゲート拒否の日本語 error がそのまま error embed に載る', async () => {
    vi.mocked(resolveChatActorUserId).mockResolvedValue({ ok: true, userId: 'user-admin' })
    vi.mocked(approveAndPrint).mockResolvedValue({
      success: false,
      orderId: 'order-1',
      error: '納入先を選択してください',
    })

    const res = await runApproveAndPrint('order-1', {})

    expect(res.type).toBe(4)
    expect(embedOf(res).description).toBe('納入先を選択してください')
  })

  it('actor 解決失敗なら approveAndPrint を呼ばず日本語エラー embed を返す', async () => {
    vi.mocked(resolveChatActorUserId).mockResolvedValue({
      ok: false,
      error: '承認を実行できる管理者ユーザーが見つかりません。',
    })

    const res = await runApproveAndPrint('order-1', {})

    expect(approveAndPrint).not.toHaveBeenCalled()
    expect(embedOf(res).description).toContain('管理者ユーザーが見つかりません')
  })
})

describe('runReprint（同期・type:4）', () => {
  it('reprint を呼び失敗時は error embed を返す', async () => {
    vi.mocked(reprint).mockResolvedValue({ success: false, orderId: 'order-1', error: '納品日が未確定です' })
    const res = await runReprint('order-1', undefined)
    expect(reprint).toHaveBeenCalledWith('order-1', undefined)
    expect(embedOf(res).description).toBe('納品日が未確定です')
  })

  it('成功時は再印刷完了 embed を返す', async () => {
    vi.mocked(reprint).mockResolvedValue({
      success: true,
      orderId: 'order-1',
      deliveryDate: '2026-07-15',
      jobId: 'job-9',
    })
    const res = await runReprint('order-1', '2026-07-15')
    expect(res.type).toBe(4)
    expect(embedOf(res).title).toContain('🖨️')
  })
})

describe('runIngest（poll-email を self-invoke ＋即 ack）', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('CRON_SECRET があれば poll-email を x-cron-secret 付きで叩き、即 ack embed を返す', async () => {
    vi.mocked(getSetting).mockResolvedValue('secret-xyz')
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)

    const res = await runIngest('https://app.example.com')

    expect(getSetting).toHaveBeenCalledWith('CRON_SECRET')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://app.example.com/api/cron/poll-email')
    expect((init as RequestInit).method).toBe('GET')
    expect((init as { headers: Record<string, string> }).headers['x-cron-secret']).toBe('secret-xyz')
    expect(res.type).toBe(4)
    expect(embedOf(res).title).toContain('📥')
  })

  it('fetch が落ちても ack を返す（発火だけ担保・完走は待たない）', async () => {
    vi.mocked(getSetting).mockResolvedValue('secret-xyz')
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'))
    vi.stubGlobal('fetch', fetchMock)

    const res = await runIngest('https://app.example.com')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(embedOf(res).title).toContain('📥')
  })

  it('CRON_SECRET 未設定なら fetch せず error embed を返す', async () => {
    vi.mocked(getSetting).mockResolvedValue(null)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const res = await runIngest('https://app.example.com')

    expect(fetchMock).not.toHaveBeenCalled()
    expect(embedOf(res).description).toContain('CRON_SECRET')
  })
})

describe('buildPreviewResponse', () => {
  const base: PendingApprovalView = {
    orderId: 'order-1',
    customerName: 'ヨーク 東道野辺',
    deliveryDate: '2026-07-15',
    itemsSummary: 'トマト 15箱, 胡瓜 3箱',
    blockingReasons: [],
  }

  it('ブロックなしは承認ボタンのみ', () => {
    const res = buildPreviewResponse(base)
    const row = (res.data!.components as Array<{ components: Array<{ custom_id: string }> }>)[0]!
    expect(row.components.map((b) => b.custom_id)).toEqual(['approve:order-1'])
  })

  it('ブロックありは日付選択ボタンも出す', () => {
    const res = buildPreviewResponse({ ...base, deliveryDate: null, blockingReasons: ['納品日 未定'] })
    const row = (res.data!.components as Array<{ components: Array<{ custom_id: string }> }>)[0]!
    expect(row.components.map((b) => b.custom_id)).toEqual(['approve:order-1', 'approve_pick:order-1'])
  })
})

describe('buildPrintCommandResponse', () => {
  it('承認待ちは preview、確定済みは reprint、取込は単一 ingest ボタンになる', () => {
    const res = buildPrintCommandResponse(
      [
        {
          orderId: 'o1',
          customerName: 'ヨーク',
          deliveryDate: null,
          itemsSummary: 'トマト 5箱',
          blockingReasons: [],
        },
      ],
      [{ orderId: 'o2', deliveryDate: '2026-07-13', lineCount: 4 }],
    )
    const rows = res.data!.components as Array<{ components: Array<{ custom_id: string }> }>
    const ids = rows.flatMap((r) => r.components.map((b) => b.custom_id))
    expect(ids).toContain('preview:o1')
    expect(ids).toContain('reprint:o2:2026-07-13')
    expect(ids).toContain('ingest')
    expect(ids).not.toContain('ingest_pick')
  })
})

describe('formatDateLabel', () => {
  it('YYYY-MM-DD を MM/DD(曜) にする', () => {
    // 2026-07-13 は月曜。
    expect(formatDateLabel('2026-07-13')).toBe('07/13(月)')
  })
})
