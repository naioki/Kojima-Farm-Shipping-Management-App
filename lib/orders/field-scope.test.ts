import { describe, it, expect } from 'vitest'
import {
  FIELD_VISIBLE_STATUSES,
  FIELD_APPROVED_STATUSES,
  isApprovedForField,
  isAwaitingApproval,
  isCancelled,
} from './field-scope'
import type { OrderStatus } from '@/types/database'

const ALL: OrderStatus[] = ['pending_review', 'approved', 'shipped', 'invoiced', 'cancelled']

describe('現場に出す注文の絞り込み', () => {
  it('キャンセルはどの現場画面にも出さない', () => {
    expect(FIELD_VISIBLE_STATUSES).not.toContain('cancelled')
    expect(isCancelled('cancelled')).toBe(true)
  })

  it('キャンセル以外はすべて現場に出す（未承認も承認待ちとして見せる）', () => {
    for (const s of ALL.filter((s) => s !== 'cancelled')) {
      expect(FIELD_VISIBLE_STATUSES, s).toContain(s)
    }
  })

  it('承認済みは approved だけでなく、その先に進んだ状態も含む', () => {
    // 出荷済み・請求済みの注文が「未承認」に落ちると、当日の帳票から消えてしまう
    expect(isApprovedForField('approved')).toBe(true)
    expect(isApprovedForField('shipped')).toBe(true)
    expect(isApprovedForField('invoiced')).toBe(true)
  })

  it('未承認・キャンセルは承認済みに含めない（印刷・積込に載せない）', () => {
    expect(isApprovedForField('pending_review')).toBe(false)
    expect(isApprovedForField('cancelled')).toBe(false)
  })

  it('承認待ちの判定は pending_review だけ', () => {
    for (const s of ALL) {
      expect(isAwaitingApproval(s), s).toBe(s === 'pending_review')
    }
  })

  it('承認済みと承認待ちは重ならない（どちらの枠に出すか一意に決まる）', () => {
    for (const s of ALL) {
      expect(isApprovedForField(s) && isAwaitingApproval(s), s).toBe(false)
    }
  })

  it('null / undefined / 未知の値は承認済みにしない（安全側に倒す）', () => {
    for (const v of [null, undefined, '', 'draft', 'unknown']) {
      expect(isApprovedForField(v), String(v)).toBe(false)
      expect(isCancelled(v), String(v)).toBe(false)
    }
  })

  it('承認済み一覧は現場に出す一覧の部分集合', () => {
    for (const s of FIELD_APPROVED_STATUSES) {
      expect(FIELD_VISIBLE_STATUSES).toContain(s)
    }
  })
})
