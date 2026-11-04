import { describe, it, expect } from 'vitest'
import {
  isDriverDeliveryNoteCustomer,
  resolveDefaultIssuerPreset,
  resolveIssuerCompanyName,
  resolvePrintedDeliveryDate,
  formatDeliveryNoteItemQty,
} from '@/lib/delivery-notes/driver-note'

describe('driver-note helper rules', () => {
  describe('isDriverDeliveryNoteCustomer', () => {
    it('recognizes Kanbei and Orange Farm as driver delivery note customers', () => {
      expect(isDriverDeliveryNoteCustomer('株式会社勘兵衛')).toBe(true)
      expect(isDriverDeliveryNoteCustomer('株式会社オレンジファーム')).toBe(true)
      expect(isDriverDeliveryNoteCustomer('株式会社エヌ・エス・ケー')).toBe(false)
    })
  })

  describe('resolveDefaultIssuerPreset & resolveIssuerCompanyName', () => {
    it('defaults Kanbei and Orange Farm to iplus (株式会社アイプラス) and others to kojima (小島農園)', () => {
      expect(resolveDefaultIssuerPreset('株式会社勘兵衛')).toBe('iplus')
      expect(resolveIssuerCompanyName('iplus', '小島農園')).toBe('株式会社アイプラス')

      expect(resolveDefaultIssuerPreset('株式会社オレンジファーム')).toBe('iplus')
      expect(resolveDefaultIssuerPreset('和郷園')).toBe('kojima')
      expect(resolveIssuerCompanyName('kojima', '小島農園')).toBe('小島農園')
    })
  })

  describe('resolvePrintedDeliveryDate', () => {
    it('prints the single FAX arrival date for Orange Farm instead of shipping date', () => {
      // Explicit note
      expect(
        resolvePrintedDeliveryDate('株式会社オレンジファーム', '2026-11-04', [
          'FAX着日:11/5(木) / 水曜朝集荷 / 50コン(1250P)',
        ]),
      ).toBe('2026-11-05')

      // Fallback from Wed (2026-11-04) -> Thu (2026-11-05)
      expect(resolvePrintedDeliveryDate('株式会社オレンジファーム', '2026-11-04', [])).toBe('2026-11-05')
      // Fallback from Fri (2026-11-06) -> Sat (2026-11-07)
      expect(resolvePrintedDeliveryDate('株式会社オレンジファーム', '2026-11-06', [])).toBe('2026-11-07')
    })

    it('keeps delivery_date unchanged for other customers', () => {
      expect(resolvePrintedDeliveryDate('株式会社勘兵衛', '2026-11-05', [])).toBe('2026-11-05')
    })
  })

  describe('formatDeliveryNoteItemQty', () => {
    it('calculates container box count and total pack quantity clearly', () => {
      const orange = formatDeliveryNoteItemQty({
        customerName: '株式会社オレンジファーム',
        productName: 'チンゲン菜',
        quantity: 1250,
        unit: '袋',
        spec: '25入',
      })
      expect(orange.displayName).toBe('チンゲン菜（25入）')
      expect(orange.boxCountText).toBe('50箱')
      expect(orange.totalQtyText).toBe('1,250袋')

      const kanbei = formatDeliveryNoteItemQty({
        customerName: '株式会社勘兵衛',
        productName: 'チンゲン菜',
        quantity: 400,
        unit: '袋',
        spec: '20入',
      })
      expect(kanbei.displayName).toBe('チンゲン菜（20入）')
      expect(kanbei.boxCountText).toBe('20箱')
      expect(kanbei.totalQtyText).toBe('400袋')
    })
  })
})
