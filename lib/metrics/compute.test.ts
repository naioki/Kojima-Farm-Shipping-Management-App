import { describe, it, expect } from 'vitest'
import { weekStartJst, recentWeeks, median, computeWeeklyMetrics, channelOf, type MetricsInput } from './compute'

describe('weekStartJst', () => {
  it('日本時間の月曜はじまり', () => {
    expect(weekStartJst('2026-11-04')).toBe('2026-11-02') // 水 → 月
    expect(weekStartJst('2026-11-08')).toBe('2026-11-02') // 日 → 前の月
    expect(weekStartJst('2026-11-09')).toBe('2026-11-09') // 月
  })
  it('UTC では日曜でも日本時間で月曜なら翌週', () => {
    expect(weekStartJst('2026-11-08T16:00:00Z')).toBe('2026-11-09') // JST 11/9 01:00
  })
})

describe('recentWeeks / median / channelOf', () => {
  it('古い順に n 週', () => {
    expect(recentWeeks('2026-11-04', 3)).toEqual(['2026-10-19', '2026-10-26', '2026-11-02'])
  })
  it('中央値', () => {
    expect(median([])).toBeNull()
    expect(median([5, 1, 3])).toBe(3)
    expect(median([1, 2, 3, 4])).toBe(2.5)
  })
  it('手入力で経路未指定は不明', () => {
    expect(channelOf({ source: 'manual', intake_channel: null })).toBe('unknown')
    expect(channelOf({ source: 'manual', intake_channel: 'phone' })).toBe('phone')
    expect(channelOf({ source: 'fax', intake_channel: null })).toBe('fax')
  })
})

describe('computeWeeklyMetrics', () => {
  const base: MetricsInput = {
    weeks: ['2026-11-02'],
    orders: [],
    receipts: [],
    items: [],
    audits: [],
    deliveryIssues: [],
    opsEvents: [],
    deliveryNotes: [],
    invoices: [],
  }

  it('処理時間: 受信→承認（受信ログ優先）と 承認→全明細出荷', () => {
    const [w] = computeWeeklyMetrics({
      ...base,
      orders: [
        { id: 'o1', source: 'fax', intake_channel: 'fax', created_at: '2026-11-03T00:10:00Z', approved_at: '2026-11-03T00:30:00Z' },
      ],
      receipts: [{ order_id: 'o1', received_at: '2026-11-03T00:00:00Z' }],
      items: [
        { order_id: 'o1', shipped_at: '2026-11-03T02:30:00Z' },
        { order_id: 'o1', shipped_at: '2026-11-03T01:30:00Z' },
      ],
    })
    expect(w!.intakeToApproveMin).toBe(30)
    expect(w!.approveToShipMin).toBe(120)
    expect(w!.faxApprovedInApp).toBe(1)
    expect(w!.channels.fax).toBe(1)
  })

  it('一部未出荷の注文は出荷時間に含めない／手入力は受信→承認に含めない', () => {
    const [w] = computeWeeklyMetrics({
      ...base,
      orders: [
        { id: 'o2', source: 'manual', intake_channel: 'phone', created_at: '2026-11-03T00:00:00Z', approved_at: '2026-11-03T00:00:00Z' },
      ],
      items: [
        { order_id: 'o2', shipped_at: '2026-11-03T01:00:00Z' },
        { order_id: 'o2', shipped_at: null },
      ],
    })
    expect(w!.intakeToApproveN).toBe(0)
    expect(w!.approveToShipN).toBe(0)
    expect(w!.phoneLineEntered).toBe(1)
  })

  it('ミス件数・事務時間・アプリ完結件数', () => {
    const t = '2026-11-03T03:00:00Z'
    const [w] = computeWeeklyMetrics({
      ...base,
      audits: [
        { entity_type: 'order_items', action: 'UPDATE', changed_fields: ['quantity', 'version'], new_values: {}, created_at: t },
        { entity_type: 'order_items', action: 'UPDATE', changed_fields: ['field_status'], new_values: {}, created_at: t },
        { entity_type: 'delivery_notes', action: 'UPDATE', changed_fields: ['items'], new_values: {}, created_at: t },
        { entity_type: 'invoices', action: 'UPDATE', changed_fields: ['status'], new_values: { status: 'void' }, created_at: t },
      ],
      deliveryIssues: [{ created_at: t }],
      opsEvents: [
        { path: '/admin/orders', active_ms: 90_000, created_at: t },
        { path: '/field/shipments', active_ms: 60_000, created_at: t },
      ],
      deliveryNotes: [{ issued_at: t }],
      invoices: [
        { created_at: t, status: 'draft' },
        { created_at: t, status: 'void' },
      ],
      actionEvents: [
        { name: 'concierge_feedback', meta: { rating: 'up' }, created_at: t },
        { name: 'concierge_feedback', meta: { rating: 'down' }, created_at: t },
        { name: 'concierge_execute', meta: {}, created_at: t },
        { name: 'concierge_undo', meta: {}, created_at: t },
      ],
    })
    expect(w!.qtyCorrections).toBe(1)
    expect(w!.noteRevisions).toBe(1)
    expect(w!.invoiceVoids).toBe(1)
    expect(w!.deliveryIssues).toBe(1)
    expect(w!.officeMin).toBe(2) // 1.5分 → 四捨五入
    expect(w!.fieldMin).toBe(1)
    expect(w!.appDeliveryNotes).toBe(1)
    expect(w!.appInvoices).toBe(1)
    expect([w!.conciergeUp, w!.conciergeDown, w!.conciergeExecuted, w!.conciergeUndone]).toEqual([1, 1, 1, 1])
  })
})
