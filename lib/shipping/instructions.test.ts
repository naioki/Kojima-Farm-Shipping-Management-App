import { describe, it, expect } from 'vitest'
import { buildShippingInstruction } from './instructions'

describe('buildShippingInstruction — 荷姿展開', () => {
  it('P/C で ケース＋端数に分解し総数を集計', () => {
    const ins = buildShippingInstruction('トマト', [
      {
        customerName: 'マルショク',
        quantity: 30,
        rule: { packsPerCase: 20, containerType: '化粧箱', labelSpec: 'Oisix', tapeColor: '黄', fractionPolicy: 'loose' },
      },
      {
        customerName: 'サンデー',
        quantity: 20,
        rule: { packsPerCase: 20, containerType: '標準箱', labelSpec: '農園独自', tapeColor: '透明', fractionPolicy: 'loose' },
      },
    ])
    expect(ins.total.toNumber()).toBe(50)
    expect(ins.lines[0]).toMatchObject({ cases: 1, loose: 10, needsConfirm: false })
    expect(ins.lines[1]).toMatchObject({ cases: 1, loose: 0, needsConfirm: false })
  })

  it('端数ポリシー confirm で端数が出ると人間確認フラグ', () => {
    const ins = buildShippingInstruction('トマト', [
      {
        customerName: 'Wagoen組合',
        quantity: 25,
        rule: { packsPerCase: 20, fractionPolicy: 'confirm' },
      },
    ])
    expect(ins.lines[0]!.loose).toBe(5)
    expect(ins.lines[0]!.needsConfirm).toBe(true)
  })

  it('P/C 不明は分解せず人間確認', () => {
    const ins = buildShippingInstruction('ネギ', [
      { customerName: '仲介A', quantity: 12, rule: { fractionPolicy: 'loose' } },
    ])
    expect(ins.lines[0]!.cases).toBeNull()
    expect(ins.lines[0]!.needsConfirm).toBe(true)
  })
})
