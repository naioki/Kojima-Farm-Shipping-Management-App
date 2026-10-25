import { describe, it, expect } from 'vitest'
import {
  rowStatusKey,
  sortIdsByStatus,
  statusRank,
  comparePackItems,
  getPackGroupInfo,
  parseDeparturePriority,
  cleanShippingRouteName,
  resolveDefaultRouteInfo,
  normalizeDestinationGroupName,
  type PackSortableItem,
} from '@/lib/field/shipment-sort'

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

describe('comparePackItems (3つのソートモードの検証)', () => {
  it('mode: time（早い便順）: 出発時刻順に並び、時刻未定は一番後ろになる', () => {
    const items: PackSortableItem[] = [
      { itemId: '1', customerName: '和郷園', destinationName: '定期便', departureTime: '18:00' },
      { itemId: '2', customerName: '農業総研', destinationName: '翌午前便', departureTime: '翌午前' },
      { itemId: '3', customerName: '勘兵衛', destinationName: '未定便', departureTime: null },
      { itemId: '4', customerName: 'NSK', destinationName: '16時便', departureTime: '16:00' },
    ]

    const sorted = [...items].sort((a, b) => comparePackItems(a, b, 'time'))
    expect(sorted[0]?.destinationName).toBe('16時便') // 16:00 (NSK・当日16時迄)
    expect(sorted[1]?.destinationName).toBe('定期便') // 18:00 (和郷園・当日18時迄)
    expect(sorted[2]?.destinationName).toBe('翌午前便') // 翌午前 (農業総研・翌午前中迄)
    expect(sorted[3]?.destinationName).toBe('未定便') // 未定は最後
  })

  it('mode: destination（出荷先順）: 取引先＋納品先ごとに完全にまとまる', () => {
    const items: PackSortableItem[] = [
      { itemId: '1', customerName: '和郷園', destinationName: '岩槻' },
      { itemId: '2', customerName: '房総食料センター', destinationName: 'BOX用' },
      { itemId: '3', customerName: '和郷園', destinationName: '岩槻' },
      { itemId: '4', customerName: '房総食料センター', destinationName: 'ちばセット用' },
      { itemId: '5', customerName: '和郷園', destinationName: '戸田' },
    ]

    const sorted = [...items].sort((a, b) => comparePackItems(a, b, 'destination'))
    // 和郷園__岩槻 が連続して並ぶ
    const iwatsukiIndices = sorted.map((it, idx) => (it.destinationName === '岩槻' ? idx : -1)).filter((x) => x >= 0)
    expect(iwatsukiIndices[1]! - iwatsukiIndices[0]!).toBe(1)
  })

  it('mode: container（コンテナ順）: コンテナ種別ごとにまとまり、内部は納品先順に並ぶ', () => {
    const items: PackSortableItem[] = [
      { itemId: '1', customerName: '和郷園', destinationName: '岩槻', initialContainer: '青コン' },
      { itemId: '2', customerName: '農業総研', destinationName: '4関東', initialContainer: '折コン' },
      { itemId: '3', customerName: '和郷園', destinationName: '戸田', initialContainer: '茶コン' },
      { itemId: '4', customerName: '和郷園', destinationName: '川越', initialContainer: '青コン' },
    ]

    const sorted = [...items].sort((a, b) => comparePackItems(a, b, 'container'))
    // 青コンがまとまっているか
    const blueIndices = sorted.map((it, idx) => (it.initialContainer === '青コン' ? idx : -1)).filter((x) => x >= 0)
    expect(blueIndices.length).toBe(2)
    expect(blueIndices[1]! - blueIndices[0]!).toBe(1)
  })

  it('どのモードでも管理者の当日手動ソート（dailyPackSortOrder）は最優先される', () => {
    const items: PackSortableItem[] = [
      { itemId: '1', customerName: '和郷園', destinationName: '定期便', departureTime: '06:00', dailyPackSortOrder: null },
      { itemId: '2', customerName: '勘兵衛', destinationName: '緊急手動先頭', departureTime: '14:00', dailyPackSortOrder: 10 },
    ]

    for (const mode of ['time', 'destination', 'container'] as const) {
      const sorted = [...items].sort((a, b) => comparePackItems(a, b, mode))
      expect(sorted[0]?.itemId).toBe('2') // dailyPackSortOrder = 10 が最優先
    }
  })
})

describe('getPackGroupInfo (ヘッダー情報の生成)', () => {
  it('time モード: 便時刻スロットのヘッダーが生成される', () => {
    const item: PackSortableItem = { itemId: '1', customerName: '和郷園', departureTime: '06:00' }
    const info = getPackGroupInfo(item, 'time')
    expect(info.title).toContain('06:00迄に出荷')
    expect(info.groupKey).toBe('time:06:00')

    const unsetItem: PackSortableItem = { itemId: '2', customerName: '和郷園', departureTime: null }
    const unsetInfo = getPackGroupInfo(unsetItem, 'time')
    expect(unsetInfo.title).toContain('時間指定なし')
    expect(unsetInfo.groupKey).toBe('time:unset')
  })

  it('container モード: コンテナ名のヘッダーが生成される', () => {
    const item: PackSortableItem = { itemId: '1', customerName: '和郷園', initialContainer: '青コン' }
    const info = getPackGroupInfo(item, 'container')
    expect(info.title).toContain('青コン')
    expect(info.groupKey).toBe('container:青コン')
  })

  it('destination モード: 納品先名のヘッダーが生成される', () => {
    const item: PackSortableItem = { itemId: '1', customerName: '和郷園', destinationName: '岩槻' }
    const info = getPackGroupInfo(item, 'destination')
    expect(info.title).toContain('和郷園 ➜ 岩槻')
    expect(info.groupKey).toBe('dest:和郷園__岩槻')
  })

  it('parseDeparturePriority / cleanShippingRouteName / resolveDefaultRouteInfo の検証', () => {
    expect(parseDeparturePriority('16:00')).toBeLessThan(parseDeparturePriority('18:00'))
    expect(parseDeparturePriority('18:00')).toBeLessThan(parseDeparturePriority('翌午前'))
    expect(parseDeparturePriority('翌午前')).toBeLessThan(parseDeparturePriority(null))

    expect(cleanShippingRouteName('18:00発 11:30発 岩槻便')).toBe('岩槻便')
    expect(cleanShippingRouteName('翌午前発 農業総研便')).toBe('農業総研便')

    const wagou = resolveDefaultRouteInfo({ customerName: '株式会社和郷園', destName: '岩槻' })
    expect(wagou.departureTime).toBe('18:00')

    const nsk = resolveDefaultRouteInfo({ customerName: 'NSK', destName: 'センター' })
    expect(nsk.departureTime).toBe('16:00')

    const nosoken = resolveDefaultRouteInfo({ customerName: '株式会社農業総合研究所（NSK）', destName: '4関東' })
    expect(nosoken.departureTime).toBe('翌午前')

    expect(normalizeDestinationGroupName('和郷園', 'パルシステム 岩槻')).toBe('岩槻')
    expect(normalizeDestinationGroupName('和郷園', 'ちばコープ グリーンボックス(戸田)')).toBe('戸田')
  })
})
