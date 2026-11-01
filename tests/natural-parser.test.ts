import { describe, it, expect } from 'vitest'
import {
  findBestMatchingCustomer,
  findBestMatchingDestination,
  parseRelativeDateFromText,
  parseQuantityFromNaturalText,
  parseNaturalOrderTextDeterministic,
} from '@/lib/orders/natural-parser'

describe('natural-parser unit tests', () => {
  const dummyCustomers = [
    { id: 'c1', name: '株式会社農業総合研究所（NSK）' },
    { id: 'c2', name: '農事組合法人 和郷園' },
    { id: 'c3', name: '農事組合法人 房総食料センター' },
    { id: 'c4', name: '寺崎' },
    { id: 'c5', name: '株式会社ヨーク' },
  ]

  const dummyDestinations = [
    { id: 'd1', customer_id: 'c2', code: '4関東顧客向け', full_name: '4関東顧客向け', aliases: ['関東向け'] },
    { id: 'd2', customer_id: 'c2', code: '5北海道', full_name: '5北海道', aliases: ['北海道ST'] },
    { id: 'd3', customer_id: 'c1', code: '岩槻', full_name: '岩槻センター', aliases: ['岩槻ST'] },
  ]

  const dummyProducts = [
    { id: 'p1', name: '青梗菜', unit: 'P' },
    { id: 'p2', name: '小松菜', unit: 'P' },
  ]

  describe('findBestMatchingCustomer', () => {
    it('略称 NSK から正式名を解決できる', () => {
      const hit = findBestMatchingCustomer('NSK出荷分', dummyCustomers)
      expect(hit?.id).toBe('c1')
    })

    it('和郷園から正式名を解決できる', () => {
      const hit = findBestMatchingCustomer('和郷園', dummyCustomers)
      expect(hit?.id).toBe('c2')
    })

    it('寺崎を解決できる', () => {
      const hit = findBestMatchingCustomer('寺崎様', dummyCustomers)
      expect(hit?.id).toBe('c4')
    })

    it('存在しない取引先は null を返す', () => {
      const hit = findBestMatchingCustomer('存在しない架空取引先', dummyCustomers)
      expect(hit).toBeNull()
    })
  })

  describe('findBestMatchingDestination', () => {
    it('納入先コードやフルネームで一致する', () => {
      const hit = findBestMatchingDestination('4関東顧客向け', dummyDestinations, 'c2')
      expect(hit?.id).toBe('d1')
    })

    it('別名から納入先を解決できる', () => {
      const hit = findBestMatchingDestination('岩槻ST', dummyDestinations, 'c1')
      expect(hit?.id).toBe('d3')
    })
  })

  describe('parseRelativeDateFromText', () => {
    const baseDate = '2026-11-02'

    it('「明日」を基準日の翌日に解決する', () => {
      const res = parseRelativeDateFromText('明日納品分', baseDate)
      expect(res.deliveryDate).toBe('2026-11-03')
      expect(res.dateExpression).toBe('明日')
    })

    it('「明後日」を2日後に解決する', () => {
      const res = parseRelativeDateFromText('明後日納品', baseDate)
      expect(res.deliveryDate).toBe('2026-11-04')
    })

    it('「11/5」などの日付表記を解決する', () => {
      const res = parseRelativeDateFromText('11/5 発送分', baseDate)
      expect(res.deliveryDate).toBe('2026-11-05')
    })
  })

  describe('parseQuantityFromNaturalText', () => {
    it('ケース数を正しくパック換算する (20入)', () => {
      const res = parseQuantityFromNaturalText('10ケース', 20)
      expect(res.cases).toBe(10)
      expect(res.totalPacks).toBe(200)
      expect(res.isCaseInput).toBe(true)
    })

    it('ケース+端数を正しく換算する', () => {
      const res = parseQuantityFromNaturalText('5c+4P', 20)
      expect(res.cases).toBe(5)
      expect(res.totalPacks).toBe(104)
      expect(res.quantityRaw).toBe('5c+4P')
    })

    it('パック指定を正しく解釈する', () => {
      const res = parseQuantityFromNaturalText('120パック', 20)
      expect(res.cases).toBe(6)
      expect(res.totalPacks).toBe(120)
      expect(res.isCaseInput).toBe(false)
    })
  })

  describe('parseNaturalOrderTextDeterministic', () => {
    it('Gemini未呼び出し時でもプレーンテキストから決定論的に注文オブジェクトを生成できる', () => {
      const text = `
        11/3 和郷園 4関東顧客向け チンゲン菜 10ケース
        11/4 寺崎 チンゲン菜 5c
      `
      const result = parseNaturalOrderTextDeterministic(text, {
        customers: dummyCustomers,
        destinations: dummyDestinations,
        products: dummyProducts,
      })

      expect(result.is_order).toBe(true)
      expect(result.orders.length).toBe(2)
      expect(result.orders[0]?.customer_name).toContain('和郷園')
      expect(result.orders[0]?.destination_name).toBe('4関東顧客向け')
      expect(result.orders[0]?.delivery_date).toBe('2026-11-03')
      expect(result.orders[0]?.items[0]?.quantity).toBe('10c')
    })
  })
})
