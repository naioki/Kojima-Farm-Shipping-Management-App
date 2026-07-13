import { describe, it, expect, beforeEach, vi } from 'vitest'

// ユースケース・送信・actor 解決はすべてモック（DB/HTTP には触れない）。
vi.mock('./use-cases', () => ({
  listPendingApprovals: vi.fn(),
  listRecentConfirmed: vi.fn(),
  approveAndPrint: vi.fn(),
  reprint: vi.fn(),
  ingestEmailsForDate: vi.fn(),
}))
vi.mock('./discord-api', () => ({ sendFollowup: vi.fn(), postChannelMessage: vi.fn() }))
vi.mock('./discord-actor', () => ({ resolveChatActorUserId: vi.fn() }))

import { approveAndPrint, reprint } from './use-cases'
import { sendFollowup } from './discord-api'
import { resolveChatActorUserId } from './discord-actor'
import {
  runApproveAndPrint,
  runReprint,
  buildPreviewResponse,
  buildPrintCommandResponse,
  formatDateLabel,
} from './discord-handlers'
import type { PendingApprovalView } from './use-cases'

const APP = 'app-1'
const TOKEN = 'tok-1'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('runApproveAndPrint', () => {
  it('approve フローは approveAndPrint を正しい引数で呼び、成功を followup する', async () => {
    vi.mocked(resolveChatActorUserId).mockResolvedValue({ ok: true, userId: 'user-admin' })
    vi.mocked(approveAndPrint).mockResolvedValue({
      success: true,
      orderId: 'order-1',
      deliveryDate: '2026-07-15',
      jobId: 'job-123',
    })

    await runApproveAndPrint(APP, TOKEN, 'order-1', {})

    expect(approveAndPrint).toHaveBeenCalledWith('order-1', {}, 'user-admin')
    expect(sendFollowup).toHaveBeenCalledTimes(1)
    const [app, token, payload] = vi.mocked(sendFollowup).mock.calls[0]!
    expect(app).toBe(APP)
    expect(token).toBe(TOKEN)
    const embed = (payload as { embeds: Array<{ title: string }> }).embeds[0]!
    expect(embed.title).toContain('✅')
  })

  it('日付指定ありの承認は deliveryDate を渡す', async () => {
    vi.mocked(resolveChatActorUserId).mockResolvedValue({ ok: true, userId: 'user-admin' })
    vi.mocked(approveAndPrint).mockResolvedValue({ success: true, orderId: 'order-1', deliveryDate: '2026-06-15' })

    await runApproveAndPrint(APP, TOKEN, 'order-1', { deliveryDate: '2026-06-15' })

    expect(approveAndPrint).toHaveBeenCalledWith('order-1', { deliveryDate: '2026-06-15' }, 'user-admin')
  })

  it('ゲート拒否の日本語 error がそのまま followup に載る', async () => {
    vi.mocked(resolveChatActorUserId).mockResolvedValue({ ok: true, userId: 'user-admin' })
    vi.mocked(approveAndPrint).mockResolvedValue({
      success: false,
      orderId: 'order-1',
      error: '納入先を選択してください',
    })

    await runApproveAndPrint(APP, TOKEN, 'order-1', {})

    const [, , payload] = vi.mocked(sendFollowup).mock.calls[0]!
    const embed = (payload as { embeds: Array<{ description: string }> }).embeds[0]!
    expect(embed.description).toBe('納入先を選択してください')
  })

  it('actor 解決失敗なら approveAndPrint を呼ばず日本語エラーを followup', async () => {
    vi.mocked(resolveChatActorUserId).mockResolvedValue({
      ok: false,
      error: '承認を実行できる管理者ユーザーが見つかりません。',
    })

    await runApproveAndPrint(APP, TOKEN, 'order-1', {})

    expect(approveAndPrint).not.toHaveBeenCalled()
    const [, , payload] = vi.mocked(sendFollowup).mock.calls[0]!
    const embed = (payload as { embeds: Array<{ description: string }> }).embeds[0]!
    expect(embed.description).toContain('管理者ユーザーが見つかりません')
  })
})

describe('runReprint', () => {
  it('reprint を呼び失敗時は error を followup', async () => {
    vi.mocked(reprint).mockResolvedValue({ success: false, orderId: 'order-1', error: '納品日が未確定です' })
    await runReprint(APP, TOKEN, 'order-1', undefined)
    expect(reprint).toHaveBeenCalledWith('order-1', undefined)
    const [, , payload] = vi.mocked(sendFollowup).mock.calls[0]!
    const embed = (payload as { embeds: Array<{ description: string }> }).embeds[0]!
    expect(embed.description).toBe('納品日が未確定です')
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
  it('承認待ちは preview、確定済みは reprint ボタンになる', () => {
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
    expect(ids).toContain('ingest_pick')
  })
})

describe('formatDateLabel', () => {
  it('YYYY-MM-DD を MM/DD(曜) にする', () => {
    // 2026-07-13 は月曜。
    expect(formatDateLabel('2026-07-13')).toBe('07/13(月)')
  })
})
