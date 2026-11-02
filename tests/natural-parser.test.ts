import { describe, it, expect } from 'vitest'
import {
  findBestMatchingCustomer,
  findBestMatchingDestination,
  parseRelativeDateFromText,
  parseQuantityFromNaturalText,
  parseNaturalOrderTextDeterministic,
} from '@/lib/orders/natural-parser'

describe('natural-parser: findBestMatchingCustomer & findBestMatchingDestination', () => {
  const customers = [
    { id: 'c1', name: '株式会社 勘兵衛' },
    { id: 'c2', name: '農事組合法人 和郷園' },
    { id: 'c3', name: '農事組合法人 房総食料センター' },
    { id: 'c4', name: '農業総合研究所' },
  ]

  const destinations = [
    { id: 'd1', customer_id: 'c1', code: 'イオンタウン', full_name: 'イオンタウン向け', aliases: [] },
    { id: 'd2', customer_id: 'c2', code: '岩槻', full_name: 'パルシステム 岩槻', aliases: ['パルシステム岩槻'] },
    { id: 'd3', customer_id: 'c2', code: 'らでぃっしゅ岩槻', full_name: 'らでぃっしゅぼーや 岩槻ST', aliases: ['ラディッシュ岩槻ST'] },
    { id: 'd4', customer_id: 'c3', code: 'BOX用', full_name: 'BOX用', aliases: [] },
  ]

  it('法人格・空白・括弧差を吸収して取引先を正確に照合する（「農」「合」「社」が文字クラスで消えない）', () => {
    expect(findBestMatchingCustomer('株式会社勘兵衛', customers)?.id).toBe('c1')
    expect(findBestMatchingCustomer('勘兵衛', customers)?.id).toBe('c1')
    expect(findBestMatchingCustomer('農事組合法人和郷園', customers)?.id).toBe('c2')
    expect(findBestMatchingCustomer('房総食料センター', customers)?.id).toBe('c3')
    expect(findBestMatchingCustomer('株式会社農業総合研究所（NSK）', customers)?.id).toBe('c4')
    expect(findBestMatchingCustomer('NSK', customers)?.id).toBe('c4')
  })

  it('宛名「アイプラス」「小島農園」は受託側のため取引先として誤マッチしない', () => {
    expect(findBestMatchingCustomer('アイプラス', customers)).toBeUndefined()
    expect(findBestMatchingCustomer('小島農園', customers)).toBeUndefined()
  })

  it('ひらがな・カタカナ・空白差を吸収して納入先を照合する', () => {
    expect(findBestMatchingDestination('パルシステム岩槻', destinations, 'c2')?.id).toBe('d2')
    expect(findBestMatchingDestination('ラディッシュボーヤ岩槻ST', destinations, 'c2')?.id).toBe('d3')
    expect(findBestMatchingDestination('イオンタウン向け', destinations, 'c1')?.id).toBe('d1')
  })
})

describe('natural-parser: parseRelativeDateFromText & parseQuantityFromNaturalText', () => {
  it('今日・明日・明後日・日付文字列を正しく解決する', () => {
    expect(parseRelativeDateFromText('明日 勘兵衛 5ケース', '2026-11-01').deliveryDate).toBe('2026-11-02')
    expect(parseRelativeDateFromText('明後日 房総食料 84P', '2026-11-01').deliveryDate).toBe('2026-11-03')
    expect(parseRelativeDateFromText('今日 寺崎 50P', '2026-11-01').deliveryDate).toBe('2026-11-01')
    expect(parseRelativeDateFromText('11/15 和郷園 200P', '2026-11-01').deliveryDate).toBe('2026-11-15')
  })

  it('ケース表記・c記法・和郷園式・パック表記を正しく総数換算する', () => {
    expect(parseQuantityFromNaturalText('チンゲン菜 5ケース', 20)).toMatchObject({
      totalPacks: 100,
      cases: 5,
      remainderPacks: 0,
      isCaseInput: true,
    })
    expect(parseQuantityFromNaturalText('20c追加', 20)).toMatchObject({
      totalPacks: 400,
      cases: 20,
      remainderPacks: 0,
      isCaseInput: true,
    })
    expect(parseQuantityFromNaturalText('300+0 (15-0)', 20)).toMatchObject({
      totalPacks: 300,
      cases: 15,
      remainderPacks: 0,
    })
    expect(parseQuantityFromNaturalText('96パック シールあり', 24)).toMatchObject({
      totalPacks: 96,
      cases: 4,
      remainderPacks: 0,
    })
  })
})

describe('natural-parser: parseNaturalOrderTextDeterministic', () => {
  it('クイック注文サンプル文から決定論的に注文構造を生成できる', () => {
    const res = parseNaturalOrderTextDeterministic(
      '明日 勘兵衛 イオンタウン向け チンゲン菜 5ケース',
      undefined,
      '2026-11-01',
    )
    expect(res.is_order).toBe(true)
    expect(res.orders).toHaveLength(1)
    expect(res.orders[0]?.customer_name).toBe('株式会社勘兵衛')
    expect(res.orders[0]?.destination_name).toBe('イオンタウン向け')
    expect(res.orders[0]?.delivery_date).toBe('2026-11-02')
    expect(res.orders[0]?.items[0]?.quantity).toBe('100')
    expect(res.orders[0]?.items[0]?.cases).toBe(5)
  })
})
