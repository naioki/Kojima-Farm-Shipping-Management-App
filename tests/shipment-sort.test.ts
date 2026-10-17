import { describe, it, expect } from 'vitest'
import { rowStatusKey, sortIdsByStatus, statusRank } from '@/lib/field/shipment-sort'

describe('rowStatusKey（出荷一覧の4区分判定）', () => {
  it('shipped は常に出荷済み（できた数が少なくても中断にしない）', () => {
    expect(rowStatusKey('shipped', 5, 10)).toBe('shipped')
    expect(rowStatusKey('shipped', null, 10)).toBe('shipped')
  })

  it('できた数 < 受注 かつ 未出荷 は中断', () => {
    expect(rowStatusKey('not_started', 5, 10)).toBe('interrupted')
    expect(rowStatusKey('packed', 5, 10)).toBe('interrupted')
  })

  it('できた数が受注以上なら中断ではなく field_status に従う', () => {
    expect(rowStatusKey('packed', 10, 10)).toBe('packed')
    expect(rowStatusKey('not_started', null, 10)).toBe('not_started')
  })
})

describe('sortIdsByStatus（未着手→中断→梱包完了→出荷済み・安定）', () => {
  it('ステータス順に並び、同順位は元の順を保つ', () => {
    const status = new Map([
      ['a', 'shipped'],
      ['b', 'not_started'],
      ['c', 'packed'],
      ['d', 'not_started'],
      ['e', 'interrupted'],
    ] as const)
    expect(sortIdsByStatus(['a', 'b', 'c', 'd', 'e'], status)).toEqual(['b', 'd', 'e', 'c', 'a'])
  })

  it('未知の id は未着手扱いで先頭側に残る', () => {
    const status = new Map([['a', 'shipped']] as const)
    expect(sortIdsByStatus(['a', 'x'], status)).toEqual(['x', 'a'])
  })

  it('rank は 未着手0 → 出荷済み3 の昇順', () => {
    expect(statusRank('not_started')).toBeLessThan(statusRank('interrupted'))
    expect(statusRank('interrupted')).toBeLessThan(statusRank('packed'))
    expect(statusRank('packed')).toBeLessThan(statusRank('shipped'))
  })
})
