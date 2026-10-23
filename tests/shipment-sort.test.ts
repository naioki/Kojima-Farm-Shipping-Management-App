import { describe, it, expect } from 'vitest'
import { rowStatusKey, sortIdsByStatus, statusRank, comparePackItems, type PackSortableItem } from '@/lib/field/shipment-sort'

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

describe('comparePackItems (収穫・パックボード同一出荷先集約＆便順優先ソート)', () => {
  it('同一出荷先（取引先＋納品先）がバラバラに混ざっていても綺麗にまとまる', () => {
    const items: PackSortableItem[] = [
      { itemId: '1', customerName: '和郷園', destinationName: '岩槻' },
      { itemId: '2', customerName: '房総食料センター', destinationName: 'BOX用' },
      { itemId: '3', customerName: '和郷園', destinationName: '岩槻' },
      { itemId: '4', customerName: '房総食料センター', destinationName: 'ちばセット用' },
      { itemId: '5', customerName: '和郷園', destinationName: '戸田' },
    ]

    const sorted = [...items].sort(comparePackItems)
    const groupedKeys = sorted.map((it) => `${it.customerName}__${it.destinationName}`)

    // 和郷園__岩槻 が2件連続
    const iwatsukiIndices = sorted.map((it, idx) => (it.destinationName === '岩槻' ? idx : -1)).filter((x) => x >= 0)
    expect(iwatsukiIndices[1]! - iwatsukiIndices[0]!).toBe(1)
  })

  it('早朝便（departureTime）がある出荷先が先に並ぶ', () => {
    const items: PackSortableItem[] = [
      { itemId: '1', customerName: '和郷園', destinationName: '定期便', departureTime: '11:30' },
      { itemId: '2', customerName: '農業総研', destinationName: '早朝便', departureTime: '06:00' },
      { itemId: '3', customerName: '勘兵衛', destinationName: '未定便', departureTime: null },
    ]

    const sorted = [...items].sort(comparePackItems)
    expect(sorted[0]?.destinationName).toBe('早朝便')
    expect(sorted[1]?.destinationName).toBe('定期便')
    expect(sorted[2]?.destinationName).toBe('未定便')
  })

  it('管理者が手動で並び替えた行（dailyPackSortOrder）は最優先される', () => {
    const items: PackSortableItem[] = [
      { itemId: '1', customerName: '和郷園', destinationName: '定期便', departureTime: '06:00', dailyPackSortOrder: null },
      { itemId: '2', customerName: '勘兵衛', destinationName: '緊急手動先頭', departureTime: '14:00', dailyPackSortOrder: 10 },
    ]

    const sorted = [...items].sort(comparePackItems)
    expect(sorted[0]?.itemId).toBe('2') // dailyPackSortOrder = 10 が最優先
    expect(sorted[1]?.itemId).toBe('1')
  })
})
