/**
 * 出荷一覧上部の進捗（目標・完成・残り・翌日分）と AI相談窓口の合計箱数の数え方（engineering.md §3）。
 * 青梗菜は品目全体で一律 Math.ceil(総パック数/20)、それ以外の品目は各明細の実際の入数で数えた箱数の合計。
 */
import { describe, expect, it } from 'vitest'
import { computeProgressBoxes, isBokChoyProduct } from '@/lib/field/progress-boxes'
import { buildDeterministicConciergeResponse } from '@/lib/concierge/schema'

describe('isBokChoyProduct', () => {
  it.each(['青梗菜', 'チンゲン菜', 'チンゲンサイ', 'ちんげん菜', 'ﾁﾝｹﾞﾝ菜'])('%s は青梗菜', (n) => {
    expect(isBokChoyProduct(n)).toBe(true)
  })
  it.each(['キュウリ', '小松菜', 'ほうれん草'])('%s は青梗菜ではない', (n) => {
    expect(isBokChoyProduct(n)).toBe(false)
  })
})

describe('computeProgressBoxes', () => {
  it('青梗菜は取引先別の入数（10入）にかかわらず総パック数 ÷ 20（切り上げ）', () => {
    const r = computeProgressBoxes([
      { productName: '青梗菜', qty: 30, packsPerCase: 10 },
      { productName: '青梗菜', qty: 15, packsPerCase: 10 },
    ])
    expect(r.totalPacks).toBe(45)
    expect(r.totalBoxes).toBe(3) // ceil(45/20)。10入で数えると 3+2=5箱になる
    expect(r.remainingBoxes).toBe(3)
  })

  it('キュウリ30入・60P は 2箱（÷20 の 3箱にしない）', () => {
    const r = computeProgressBoxes([{ productName: 'キュウリ', qty: 60, packsPerCase: 30 }])
    expect(r.totalBoxes).toBe(2)
  })

  it('キュウリは明細ごとの箱数の合計（カードの箱数の合計と一致）', () => {
    const lines = [
      { productName: 'キュウリ', qty: 45, packsPerCase: 30 },
      { productName: 'キュウリ', qty: 25, packsPerCase: 24 },
    ]
    const cardSum = lines.reduce((a, l) => a + Math.ceil(l.qty / l.packsPerCase), 0)
    expect(computeProgressBoxes(lines).totalBoxes).toBe(cardSum)
    expect(cardSum).toBe(4)
  })

  it('青梗菜とキュウリが混ざっていても、それぞれの規則で数えて合計する', () => {
    const r = computeProgressBoxes([
      { productName: '青梗菜', qty: 30, packsPerCase: 10 },
      { productName: 'キュウリ', qty: 60, packsPerCase: 30 },
    ])
    expect(r.totalBoxes).toBe(2 + 2)
    expect(r.totalPacks).toBe(90)
  })

  it('入数が不明（null・0）のときは既定 20', () => {
    expect(computeProgressBoxes([{ productName: 'キュウリ', qty: 41, packsPerCase: null }]).totalBoxes).toBe(3)
    expect(computeProgressBoxes([{ productName: 'キュウリ', qty: 41, packsPerCase: 0 }]).totalBoxes).toBe(3)
  })

  it('完成箱数は満杯の箱だけ、全数できたら総箱数にそろえる（残り＝目標−完成）', () => {
    const r = computeProgressBoxes([
      { productName: 'キュウリ', qty: 60, packsPerCase: 30, donePacks: 45 },
      { productName: '青梗菜', qty: 30, packsPerCase: 10, donePacks: 30 },
    ])
    expect(r.completedBoxes).toBe(1 + 2)
    expect(r.remainingBoxes).toBe(1)
    expect(r.completedPacks).toBe(75)
  })

  it('少量サンプルは青梗菜以外では箱に数えない（カードと同じ）', () => {
    const r = computeProgressBoxes([{ productName: 'キュウリ', qty: 5, packsPerCase: 30, isSmallSample: true }])
    expect(r.totalBoxes).toBe(0)
    expect(r.totalPacks).toBe(5)
  })
})

describe('AI相談窓口の合計箱数', () => {
  it('明日の注文の合計箱数は青梗菜 ÷20・キュウリは入数で数える', () => {
    const ctx = {
      todayStr: '2026-11-12',
      tomorrowStr: '2026-11-13',
      customers: [],
      destinations: [],
      products: [],
      currentSettings: {},
      tomorrowOrderSummary: [
        { customerName: 'A青果', destinationName: 'A青果', productName: '青梗菜', quantity: 30, packsPerCase: 10 },
        { customerName: 'B青果', destinationName: 'B青果', productName: 'キュウリ', quantity: 60, packsPerCase: 30 },
      ],
    }
    const r = buildDeterministicConciergeResponse('明日の注文状況を教えて', ctx as never)
    expect(r?.reply).toContain('合計 4箱（90パック）')
  })
})
