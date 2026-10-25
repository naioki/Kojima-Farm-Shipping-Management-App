import { describe, it, expect } from 'vitest'
import {
  getThaiContainer,
  getContainerColorEmoji,
  getThaiBag,
  getBagEmoji,
  getThaiTape,
  getTapeColorEmoji,
  getThaiSpec,
  getThaiDepartureTime,
  THAI_LABELS,
} from '@/lib/field/thai-dict'

describe('Thai Translation & Helpers (lib/field/thai-dict.ts)', () => {
  it('correctly returns Thai translation for known container names', () => {
    expect(getThaiContainer('青コン')).toBe('ลังน้ำเงิน')
    expect(getThaiContainer('茶コン')).toBe('ลังน้ำตาล')
    expect(getThaiContainer('段ボール')).toBe('กล่องกระดาษ')
    expect(getThaiContainer('農業総研専用折りたたみコンテナ')).toBe('ลังพับNSK')
    expect(getThaiContainer(null)).toBeNull()
    expect(getThaiContainer('未定義コンテナ')).toBeNull()
  })

  it('correctly returns Thai translation for bag types', () => {
    expect(getThaiBag('印刷袋')).toBe('ถุงพิมพ์ลาย')
    expect(getThaiBag('無地袋')).toBe('ถุงใสไม่มีลาย')
    expect(getThaiBag('防曇袋')).toBe('ถุงกันฝ้า')
    expect(getThaiBag(null)).toBeNull()
  })

  it('correctly returns Thai translation for tape colors', () => {
    expect(getThaiTape('赤テープ')).toBe('เทปแดง')
    expect(getThaiTape('緑テープ')).toBe('เทปเขียว')
    expect(getThaiTape('青テープ')).toBe('เทปน้ำเงิน')
    expect(getThaiTape(null)).toBeNull()
  })

  it('correctly builds Thai spec tokens from master specs and packs per case', () => {
    // 20入 2〜3株
    const res1 = getThaiSpec('2〜3株(入数20)', 20)
    expect(res1).toContain('20 ถุง/ลัง')
    expect(res1).toContain('2-3 ต้น/ถุง')

    // 200g
    const res2 = getThaiSpec('200g', 24)
    expect(res2).toContain('24 ถุง/ลัง')
    expect(res2).toContain('200 กรัม')

    // Only packs
    const res3 = getThaiSpec(null, 20)
    expect(res3).toBe('20 ถุง/ลัง')

    // null / empty
    expect(getThaiSpec(null, null)).toBeNull()
  })

  it('contains expected critical labels for actions and warnings', () => {
    expect(THAI_LABELS.packDone).toBe('เสร็จแล้ว')
    expect(THAI_LABELS.loadDone).toBe('ขึ้นรถเรียบร้อย')
    expect(THAI_LABELS.undo).toBe('กดยกเลิก')
    expect(THAI_LABELS.notCompletedWarn).toContain('ยังแพ็คไม่เสร็จ')
    expect(THAI_LABELS.quantityMismatchWarn).toContain('จำนวนยังไม่ครบ')
  })

  it('correctly translates departure times into Thai', () => {
    expect(getThaiDepartureTime('16:00')).toBe('วันนี้ 16:00')
    expect(getThaiDepartureTime('18:00')).toBe('วันนี้ 18:00')
    expect(getThaiDepartureTime('翌午前')).toBe('ส่งพรุ่งนี้เช้า')
    expect(getThaiDepartureTime('翌09:00')).toBe('พรุ่งนี้ 09:00')
    expect(getThaiDepartureTime(null)).toBeNull()
  })

  it('correctly returns intuitive color emojis for containers, bags, and tapes', () => {
    expect(getContainerColorEmoji('青コン')).toBe('🟦')
    expect(getContainerColorEmoji('茶コン')).toBe('🟫')
    expect(getContainerColorEmoji('農業総研専用折りたたみコンテナ')).toBe('🟩')
    expect(getBagEmoji('印刷袋')).toBe('🖨️')
    expect(getBagEmoji('無地袋')).toBe('📄')
    expect(getTapeColorEmoji('赤テープ')).toBe('🔴')
    expect(getTapeColorEmoji('緑テープ')).toBe('🟢')
  })
})
