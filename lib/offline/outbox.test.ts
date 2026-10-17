import { describe, it, expect } from 'vitest'
import { collapseOutbox, toPatchPayload, isConflict, type OutboxEntry } from './outbox'

const e = (itemId: string, fieldStatus: OutboxEntry['fieldStatus'], version: number, ts: number): OutboxEntry => ({
  itemId,
  fieldStatus,
  version,
  ts,
})

describe('collapseOutbox — 同一itemは最終状態に畳み込み', () => {
  it('同じ item の連打は ts 最大のみ残す', () => {
    const out = collapseOutbox([
      e('a', 'packed', 1, 100),
      e('a', 'shipped', 2, 200),
      e('b', 'packed', 1, 150),
    ])
    expect(out).toHaveLength(2)
    const a = out.find((x) => x.itemId === 'a')!
    expect(a.fieldStatus).toBe('shipped')
  })

  it('ts 昇順で返す（送信順の安定化）', () => {
    const out = collapseOutbox([e('b', 'packed', 1, 300), e('a', 'packed', 1, 100)])
    expect(out.map((x) => x.itemId)).toEqual(['a', 'b'])
  })
})

describe('toPatchPayload', () => {
  it('field_status と version を取り出す', () => {
    expect(toPatchPayload(e('a', 'shipped', 3, 1))).toEqual({ field_status: 'shipped', version: 3 })
  })
})

describe('isConflict', () => {
  it('version 不一致は競合', () => {
    expect(isConflict(e('a', 'packed', 2, 1), 3)).toBe(true)
    expect(isConflict(e('a', 'packed', 3, 1), 3)).toBe(false)
  })
})
