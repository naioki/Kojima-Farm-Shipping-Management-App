import { describe, it, expect } from 'vitest'
import { collapseOutbox, toPatchPayload, isConflict, calcBackoffMs, type OutboxEntry } from './outbox'

const e = (itemId: string, fieldStatus: OutboxEntry['fieldStatus'], version: number, ts: number): OutboxEntry => ({
  itemId,
  fieldStatus,
  version,
  ts,
})

describe('collapseOutbox — 同一itemは最終状態に畳み込み（fieldStatus + shippedQty マージ対応）', () => {
  it('同じ item の連打は ts 最大のみ残し、途中数(shippedQty)とステータスを統合する', () => {
    const out = collapseOutbox([
      { itemId: 'a', shippedQty: 40, version: 1, ts: 100 },
      { itemId: 'a', fieldStatus: 'packed', version: 1, ts: 200 },
      e('b', 'packed', 1, 150),
    ])
    expect(out).toHaveLength(2)
    const a = out.find((x) => x.itemId === 'a')!
    expect(a.fieldStatus).toBe('packed')
    expect(a.shippedQty).toBe(40)
  })

  it('ts 昇順で返す（送信順の安定化）', () => {
    const out = collapseOutbox([e('b', 'packed', 1, 300), e('a', 'packed', 1, 100)])
    expect(out.map((x) => x.itemId)).toEqual(['a', 'b'])
  })
})

describe('toPatchPayload', () => {
  it('指定された field_status / shipped_qty と version を取り出す', () => {
    expect(toPatchPayload(e('a', 'shipped', 3, 1))).toEqual({ field_status: 'shipped', version: 3 })
    expect(toPatchPayload({ itemId: 'a', shippedQty: 60, version: 2, ts: 10 })).toEqual({
      shipped_qty: 60,
      version: 2,
    })
  })
})

describe('isConflict', () => {
  it('version 不一致は競合', () => {
    expect(isConflict(e('a', 'packed', 2, 1), 3)).toBe(true)
    expect(isConflict(e('a', 'packed', 3, 1), 3)).toBe(false)
  })
})

describe('calcBackoffMs — 指数バックオフ', () => {
  it('リトライ回数に応じて指数増加し上限30秒で頭打ちになる', () => {
    expect(calcBackoffMs(0)).toBe(1000)
    expect(calcBackoffMs(1)).toBe(2000)
    expect(calcBackoffMs(2)).toBe(4000)
    expect(calcBackoffMs(10)).toBe(30000)
  })
})
