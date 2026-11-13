/**
 * cleanShippingRouteName: 便名に重ねて書かれた出発時刻だけを除き、時刻で始まる便名そのものは削らない。
 */
import { describe, expect, it } from 'vitest'
import { cleanShippingRouteName, resolveDefaultRouteInfo } from '@/lib/field/shipment-sort'

describe('cleanShippingRouteName：時刻で始まる便名はそのまま', () => {
  it.each(['17時便', '16時便', '11:30便', '当日便', '翌午前便', '2時間便', '12時30分便', '岩槻便', '1便', 'NSK便', '16時台便', '17時便（岩槻）', '16時半便', '16時頃便', '11時AM便', '3時PM便', '11時am便'])(
    '%s',
    (name) => {
      expect(cleanShippingRouteName(name)).toBe(name)
    },
  )
})

describe('cleanShippingRouteName：重ねて書かれた時刻だけを除く（従来どおり）', () => {
  it.each([
    ['16:30 岩槻便', '岩槻便'],
    ['当日16:30迄 岩槻便', '岩槻便'],
    ['⏰ 当日18:00迄 岩槻便', '岩槻便'],
    ['11:30発 岩槻便', '岩槻便'],
    ['11:30発岩槻便', '岩槻便'],
    ['18:00発 11:30発 岩槻便', '岩槻便'],
    ['翌午前発 農業総研便', '農業総研便'],
    ['16時発 17時便', '17時便'],
    ['当日 18:00迄・岩槻便', '岩槻便'],
  ])('%s → %s', (input, expected) => {
    expect(cleanShippingRouteName(input)).toBe(expected)
  })
})

describe('cleanShippingRouteName：区切りなしで時刻の直後に便名が続く表記も時刻を除く', () => {
  it.each([
    ['16:30岩槻便', '岩槻便'],
    ['16時NSK便', 'NSK便'],
    ['当日16:30岩槻便', '岩槻便'],
    ['⏰ 16:30岩槻便', '岩槻便'],
    ['翌午前農業総研便', '農業総研便'],
    ['12時30分岩槻便', '岩槻便'],
  ])('%s → %s', (input, expected) => {
    expect(cleanShippingRouteName(input)).toBe(expected)
  })

  it.each(['当日 18:00迄に出荷', '翌午前迄に出荷', '11:30発', '一般配送・時間未指定', '時間指定なし（一般便）', '', null, undefined])(
    '時刻だけ・便名なしの表記は null（%s）',
    (input) => {
      expect(cleanShippingRouteName(input)).toBeNull()
    },
  )
})

describe('resolveDefaultRouteInfo が便名を削らない', () => {
  it('納入先の便名「16時便」が見出しにそのまま出る', () => {
    const r = resolveDefaultRouteInfo({
      destName: 'A店',
      customerName: 'テスト青果',
      override: { departureTime: '16:00', shippingRouteName: '16時便' },
    })
    expect(r.shippingRouteName).toBe('16時便')
    expect(r.title).toBe('当日 16:00迄（16時便）')
  })
})
