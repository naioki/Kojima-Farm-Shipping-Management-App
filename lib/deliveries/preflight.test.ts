import { describe, it, expect } from 'vitest'
import { findPreflightIssues } from './preflight'

const base = { label: 'A ＞ 本店', product_name: 'チンゲン菜', quantity: 40 }
describe('出荷前の最終チェック', () => {
  it('パック済み・出荷済み・数量どおりは出さない', () => {
    expect(
      findPreflightIssues([
        { ...base, id: '1', field_status: 'packed', shipped_qty: null },
        { ...base, id: '2', field_status: 'shipped', shipped_qty: 40 },
      ]),
    ).toEqual([])
  })
  it('未パックと一部のみを拾う', () => {
    const r = findPreflightIssues([
      { ...base, id: '1', field_status: 'not_started', shipped_qty: null },
      { ...base, id: '2', field_status: 'packed', shipped_qty: 30 },
      { ...base, id: '3', field_status: null, shipped_qty: null, quantity: 0 },
    ])
    expect(r.map((x) => [x.id, x.kind, x.done])).toEqual([
      ['1', 'not_packed', 0],
      ['2', 'short', 30],
    ])
  })
})
