import { describe, it, expect } from 'vitest'
import { buildSenderDateKey, decideReceiptDisposition, toDateKey } from './dedupe'

describe('buildSenderDateKey', () => {
  const d = new Date(2025, 0, 9) // 2025-01-09（ローカル）

  it('fax は FAX番号_YYYYMMDD', () => {
    expect(buildSenderDateKey('fax', '0479-12-3456', d)).toBe('0479-12-3456_20250109')
  })
  it('email は小文字化したアドレス_YYYYMMDD', () => {
    expect(buildSenderDateKey('email', 'Order@X.co.jp', d)).toBe('order@x.co.jp_20250109')
  })
  it('portal/manual は再送概念なし → null', () => {
    expect(buildSenderDateKey('portal', 'anything', d)).toBeNull()
    expect(buildSenderDateKey('manual', 'anything', d)).toBeNull()
  })
  it('識別子が無ければ null', () => {
    expect(buildSenderDateKey('fax', null, d)).toBeNull()
  })
})

describe('toDateKey', () => {
  it('ゼロ埋め YYYYMMDD', () => {
    expect(toDateKey(new Date(2025, 2, 5))).toBe('20250305')
  })
})

describe('decideReceiptDisposition（§3 判定）', () => {
  it('exact_hash 一致は最優先で duplicate（再送より優先＝二重計上しない）', () => {
    expect(
      decideReceiptDisposition({ exactHashMatch: true, senderDateKeyMatch: true }),
    ).toBe('duplicate')
  })
  it('sender_date_key 一致のみ → revision（差分モード）', () => {
    expect(
      decideReceiptDisposition({ exactHashMatch: false, senderDateKeyMatch: true }),
    ).toBe('revision')
  })
  it('いずれも無し → new', () => {
    expect(
      decideReceiptDisposition({ exactHashMatch: false, senderDateKeyMatch: false }),
    ).toBe('new')
  })
})
