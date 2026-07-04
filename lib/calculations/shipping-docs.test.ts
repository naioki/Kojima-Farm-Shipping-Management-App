import { describe, expect, it } from 'vitest'
import {
  aggregateEntries,
  buildLabels,
  decomposeQty,
  fitFontSize,
  rearrangeCutAndStack,
  type ShippingDocEntry,
} from './shipping-docs'

const entry = (over: Partial<ShippingDocEntry>): ShippingDocEntry => ({
  destination: 'ヨーク 東道野辺',
  item: 'トマト',
  spec: 'スタンドパック',
  unitsPerBox: 15,
  unitLabel: '袋',
  boxLabel: 'ケース',
  boxes: 0,
  remainder: 0,
  totalQty: 0,
  ...over,
})

describe('decomposeQty', () => {
  it('総数を箱・端数に分解する', () => {
    expect(decomposeQty(140, 15)).toEqual({ boxes: 9, remainder: 5 })
    expect(decomposeQty(300, 40)).toEqual({ boxes: 7, remainder: 20 })
    expect(decomposeQty(45, 15)).toEqual({ boxes: 3, remainder: 0 })
  })
  it('入数不明（0）は箱0・端数=総数', () => {
    expect(decomposeQty(8, 0)).toEqual({ boxes: 0, remainder: 8 })
  })
})

describe('aggregateEntries（v4 shipping_sheet.py の移植）', () => {
  it('同一キーを合算し、端数が入数を超えたら箱に繰り上げる', () => {
    // 胡瓜バラ×複数注文: 2箱+30 と 1箱+40（入数50）→ 合計220 → 4箱+20
    const result = aggregateEntries([
      entry({ destination: '鎌ケ谷', item: '胡瓜', spec: 'バラ', unitsPerBox: 50, totalQty: 130 }),
      entry({ destination: '鎌ケ谷', item: '胡瓜', spec: 'バラ', unitsPerBox: 50, totalQty: 90 }),
    ])
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ boxes: 4, remainder: 20, totalQty: 220 })
  })

  it('規格が違えば合算しない', () => {
    const result = aggregateEntries([
      entry({ item: '胡瓜', spec: '3本P', unitsPerBox: 40, totalQty: 40 }),
      entry({ item: '胡瓜', spec: 'バラ', unitsPerBox: 50, totalQty: 50 }),
    ])
    expect(result).toHaveLength(2)
  })

  it('入数0の行はゼロ除算せずそのまま合算される', () => {
    const result = aggregateEntries([
      entry({ item: 'トマト', spec: '', unitsPerBox: 0, totalQty: 5 }),
      entry({ item: 'トマト', spec: '', unitsPerBox: 0, totalQty: 3 }),
    ])
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ boxes: 0, remainder: 8, totalQty: 8 })
  })
})

describe('buildLabels（v4 ocr_parser.py の移植）', () => {
  it('1箱=1枚、端数箱は最後の1枚だけ isFraction', () => {
    const labels = buildLabels([entry({ unitsPerBox: 15, boxes: 2, remainder: 5, totalQty: 35 })])
    expect(labels).toHaveLength(3)
    expect(labels[0]).toMatchObject({ quantityText: '15袋', sequence: '1/3', isFraction: false })
    expect(labels[1]).toMatchObject({ quantityText: '15袋', sequence: '2/3', isFraction: false })
    expect(labels[2]).toMatchObject({ quantityText: '5袋', sequence: '3/3', isFraction: true })
  })

  it('端数ゼロなら最後の箱（X/X）でも強調しない', () => {
    const labels = buildLabels([entry({ unitsPerBox: 15, boxes: 2, remainder: 0, totalQty: 30 })])
    expect(labels).toHaveLength(2)
    expect(labels[1]).toMatchObject({ sequence: '2/2', isFraction: false })
  })

  it('入数未登録（0）はラベルを作らない', () => {
    expect(buildLabels([entry({ unitsPerBox: 0, remainder: 8, totalQty: 8 })])).toHaveLength(0)
  })
})

describe('rearrangeCutAndStack（v4 pdf_generator.py の移植）', () => {
  it('2ページ分（9枚）: 裁断して重ねると元順になる配置', () => {
    const labels = Array.from({ length: 9 }, (_, i) => i)
    const out = rearrangeCutAndStack(labels)
    // pages=2: i=0→(slot0,page0)=idx0, i=1→(slot0,page1)=idx8, i=2→(slot1,page0)=idx1 …
    expect(out).toHaveLength(16)
    expect(out[0]).toBe(0) // page0 slot0
    expect(out[8]).toBe(1) // page1 slot0
    expect(out[1]).toBe(2) // page0 slot1
    expect(out[9]).toBe(3) // page1 slot1
    expect(out[4]).toBe(8) // page0 slot4（最後のラベル）
    expect(out[12]).toBeNull() // 空きスロット
  })

  it('1ページ以内はそのまま順番どおり', () => {
    const out = rearrangeCutAndStack([10, 20, 30])
    expect(out.slice(0, 3)).toEqual([10, 20, 30])
    expect(out).toHaveLength(8)
  })

  it('空入力は空配列', () => {
    expect(rearrangeCutAndStack([])).toEqual([])
  })
})

describe('fitFontSize', () => {
  it('短いテキストは最大サイズのまま', () => {
    expect(fitFontSize('寺崎', 40, 400)).toBe(40)
  })
  it('長いテキストは縮小され、最小8ptを下回らない', () => {
    const size = fitFontSize('ヨーク 東道野辺スーパーロング店舗名テスト', 40, 200)
    expect(size).toBeLessThan(40)
    expect(size).toBeGreaterThanOrEqual(8)
  })
})
