import { describe, it, expect } from 'vitest'
import {
  progressKey,
  parseProgress,
  serializeProgress,
  reconcileProgress,
  staleKeys,
} from './check-progress'

describe('progressKey', () => {
  it('日付と配送単位ごとに別のキーになる', () => {
    const a = progressKey('2026-07-31', 'cust1:dest1')
    const b = progressKey('2026-07-31', 'cust1:dest2')
    const c = progressKey('2026-08-01', 'cust1:dest1')
    expect(new Set([a, b, c]).size).toBe(3)
  })

  it('納入先なし（キーが空）でも成立する', () => {
    expect(progressKey('2026-07-31', 'cust1:')).toContain('cust1:')
  })
})

describe('parseProgress / serializeProgress', () => {
  it('往復して同じ集合に戻る', () => {
    const ids = new Set(['a', 'b', 'c'])
    expect(parseProgress(serializeProgress(ids))).toEqual(ids)
  })

  it('未保存（null）は空集合', () => {
    expect(parseProgress(null)).toEqual(new Set())
  })

  it('壊れた値でも例外を投げず未チェック扱い（現場の画面を落とさない）', () => {
    // 保存が壊れているときに「全部チェック済み」に化けるほうが危険なので空に倒す
    expect(parseProgress('{壊れたJSON')).toEqual(new Set())
    expect(parseProgress('null')).toEqual(new Set())
    expect(parseProgress('{"a":1}')).toEqual(new Set())
    expect(parseProgress('"abc"')).toEqual(new Set())
  })

  it('配列内の文字列以外は捨てる', () => {
    expect(parseProgress('["a",1,null,"b",{}]')).toEqual(new Set(['a', 'b']))
  })
})

describe('reconcileProgress', () => {
  it('いま画面にある明細のチェックだけ残す', () => {
    const saved = new Set(['a', 'b', 'c'])
    expect(reconcileProgress(saved, ['a', 'c'])).toEqual(new Set(['a', 'c']))
  })

  it('消えた明細のチェックは落とす（全部チェック済みに化けさせない）', () => {
    // 事務所が明細を削除したのに古いチェックが残ると、未確認の行があるのに
    // 「ぜんぶ かくにん できました」になってしまう
    const saved = new Set(['a', 'b'])
    const reconciled = reconcileProgress(saved, ['a', 'new'])
    expect(reconciled.has('b')).toBe(false)
    expect(reconciled.has('new')).toBe(false)
    expect(reconciled).toEqual(new Set(['a']))
  })

  it('保存が空なら空のまま', () => {
    expect(reconcileProgress(new Set(), ['a', 'b'])).toEqual(new Set())
  })
})

describe('staleKeys', () => {
  it('当日以外の保存キーだけを掃除対象にする', () => {
    const keys = [
      'kojima:delivery-check:2026-07-30:c1:d1',
      'kojima:delivery-check:2026-07-31:c1:d1',
      'kojima:delivery-check:2026-07-31:c2:',
      'other-app-key',
    ]
    expect(staleKeys(keys, '2026-07-31')).toEqual(['kojima:delivery-check:2026-07-30:c1:d1'])
  })

  it('無関係なキーには触らない', () => {
    expect(staleKeys(['theme', 'token'], '2026-07-31')).toEqual([])
  })

  it('日付の前方一致で誤爆しない', () => {
    // '2026-07-3' が '2026-07-31' を巻き込まないこと（区切りの : まで見る）
    const keys = ['kojima:delivery-check:2026-07-31:c1:d1']
    expect(staleKeys(keys, '2026-07-3')).toEqual(keys)
  })
})
