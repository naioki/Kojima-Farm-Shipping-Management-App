import { describe, it, expect } from 'vitest'
import { parseAmountMode, amountVisibility, amountModeLabel, DELIVERY_AMOUNT_MODES } from './amount-mode'

describe('parseAmountMode', () => {
  it('既知の値はそのまま返す', () => {
    expect(parseAmountMode('full')).toBe('full')
    expect(parseAmountMode('blank')).toBe('blank')
    expect(parseAmountMode('none')).toBe('none')
  })

  it('未知値・null・空は fallback（既定 none＝金額なし。誤った金額を印字しない安全側）', () => {
    expect(parseAmountMode('xxx')).toBe('none')
    expect(parseAmountMode(null)).toBe('none')
    expect(parseAmountMode(undefined)).toBe('none')
    expect(parseAmountMode('')).toBe('none')
  })

  it('fallback を明示できる', () => {
    expect(parseAmountMode(null, 'full')).toBe('full')
    expect(parseAmountMode('bad', 'blank')).toBe('blank')
  })
})

describe('amountVisibility', () => {
  it('full は全部表示・全部埋める', () => {
    expect(amountVisibility('full')).toEqual({
      showAmountCols: true,
      fillAmounts: true,
      showTaxCol: true,
      showTotals: true,
      fillTotals: true,
    })
  })

  it('blank は列は出すが金額・合計は空欄（税率は印字）', () => {
    const v = amountVisibility('blank')
    expect(v.showAmountCols).toBe(true)
    expect(v.fillAmounts).toBe(false)
    expect(v.showTaxCol).toBe(true)
    expect(v.showTotals).toBe(true)
    expect(v.fillTotals).toBe(false)
  })

  it('none は金額系の列・合計を一切出さない', () => {
    expect(amountVisibility('none')).toEqual({
      showAmountCols: false,
      fillAmounts: false,
      showTaxCol: false,
      showTotals: false,
      fillTotals: false,
    })
  })
})

describe('amountModeLabel / DELIVERY_AMOUNT_MODES', () => {
  it('3モードのラベルが取れる', () => {
    expect(amountModeLabel('full')).toBe('金額あり')
    expect(amountModeLabel('blank')).toBe('金額は後から手書き')
    expect(amountModeLabel('none')).toBe('金額なし')
  })

  it('選択肢は3つ', () => {
    expect(DELIVERY_AMOUNT_MODES).toHaveLength(3)
  })
})
