import { describe, expect, it } from 'vitest'
import { applyRevisedItems, buildRows, syncRowsWithProps } from './approval-rows'
import type { PendingOrder, PendingOrderItem } from './pending-types'

const item = (id: string, quantity: number, version: number): PendingOrderItem => ({
  id, productId: null, productName: '青梗菜', quantity, unit: 'P', confidence: 0.9, version,
  packConfigId: null, packConfigOptions: [],
})
const order = (items: PendingOrderItem[]) => ({ id: 'o1', items }) as unknown as PendingOrder

describe('承認画面の編集行', () => {
  it('AI 修正の成功応答で version と数量が更新される', () => {
    const rows = buildRows([order([item('a', 20, 3), item('b', 10, 1)])]).o1!
    const next = applyRevisedItems(rows, [{ id: 'a', quantity: 40, version: 4 }])
    expect(next[0]).toMatchObject({ quantity: 40, draftQty: '40', version: 4 })
    expect(next[1]).toMatchObject({ quantity: 10, version: 1 })
  })

  it('新しい props で編集中でない行は props の値に同期され、編集中の行は入力も version も読んだときのまま（他の人の変更を黙って上書きしない）', () => {
    const prev = buildRows([order([item('a', 20, 3), item('b', 10, 1)])])
    prev.o1![1] = { ...prev.o1![1]!, draftQty: '15' }
    const next = syncRowsWithProps(prev, [order([item('a', 30, 5), item('b', 12, 2), item('c', 5, 1)])]).o1!
    expect(next[0]).toMatchObject({ quantity: 30, draftQty: '30', version: 5 })
    expect(next[1]).toMatchObject({ quantity: 10, draftQty: '15', version: 1 })
    expect(next[2]).toMatchObject({ id: 'c', version: 1 })
  })
})
