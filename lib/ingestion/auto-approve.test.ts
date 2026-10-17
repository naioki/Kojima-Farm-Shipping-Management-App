import { describe, it, expect } from 'vitest'
import { decideReceiptApproval, parseThreshold, isAutoApproveOn, type AutoApproveInput } from './auto-approve'

const base: AutoApproveInput = {
  enabled: true,
  threshold: 1.0,
  items: [{ confidence: 1.0, productMatched: true }],
  customerMatched: true,
  deliveryDateKnown: true,
}

describe('decideReceiptApproval — 安全側ガード', () => {
  it('全条件を満たせば自動承認', () => {
    expect(decideReceiptApproval(base)).toEqual({ action: 'auto_approve', reason: 'all_checks_passed' })
  })

  it('無効なら常に人手', () => {
    expect(decideReceiptApproval({ ...base, enabled: false }).action).toBe('manual_review')
  })

  it('明細が空なら人手', () => {
    expect(decideReceiptApproval({ ...base, items: [] }).reason).toBe('no_items')
  })

  it('取引先未紐付けは人手', () => {
    expect(decideReceiptApproval({ ...base, customerMatched: false }).reason).toBe('customer_unmatched')
  })

  it('納品日不明は人手', () => {
    expect(decideReceiptApproval({ ...base, deliveryDateKnown: false }).reason).toBe('delivery_date_unknown')
  })

  it('1つでも確信度がしきい値未満なら人手', () => {
    const d = decideReceiptApproval({
      ...base,
      items: [{ confidence: 1.0, productMatched: true }, { confidence: 0.9, productMatched: true }],
    })
    expect(d.reason).toBe('low_confidence')
  })

  it('confidence が null（未採点）は人手', () => {
    expect(decideReceiptApproval({ ...base, items: [{ confidence: null, productMatched: true }] }).reason).toBe('low_confidence')
  })

  it('品目未一致は人手', () => {
    expect(decideReceiptApproval({ ...base, items: [{ confidence: 1.0, productMatched: false }] }).reason).toBe('product_unmatched')
  })

  it('しきい値を下げると 0.95 でも自動承認', () => {
    const d = decideReceiptApproval({
      ...base,
      threshold: 0.95,
      items: [{ confidence: 0.96, productMatched: true }],
    })
    expect(d.action).toBe('auto_approve')
  })
})

describe('parseThreshold / isAutoApproveOn', () => {
  it('未設定は 1.0', () => {
    expect(parseThreshold(null)).toBe(1.0)
    expect(parseThreshold('')).toBe(1.0)
  })
  it('範囲外はクランプ', () => {
    expect(parseThreshold('1.5')).toBe(1)
    expect(parseThreshold('-0.2')).toBe(0)
    expect(parseThreshold('0.9')).toBe(0.9)
  })
  it('on 判定は大文字小文字無視', () => {
    expect(isAutoApproveOn('on')).toBe(true)
    expect(isAutoApproveOn('ON')).toBe(true)
    expect(isAutoApproveOn('off')).toBe(false)
    expect(isAutoApproveOn(null)).toBe(false)
  })
})
