import { describe, it, expect } from 'vitest'
import { groupByCategory, UNGROUPED_LABEL } from './group'

describe('groupByCategory（品目グループの表示まとめ）', () => {
  it('同一 category をまとめ、出現順を保つ', () => {
    const r = groupByCategory([
      { id: 1, category: 'トマト' },
      { id: 2, category: 'キュウリ' },
      { id: 3, category: 'トマト' },
    ])
    expect(r.map((g) => g.group)).toEqual(['トマト', 'キュウリ'])
    expect(r[0]!.items.map((i) => i.id)).toEqual([1, 3])
  })

  it('未分類（null/空白）は末尾の「その他」に集約', () => {
    const r = groupByCategory([
      { id: 1, category: null },
      { id: 2, category: 'トマト' },
      { id: 3, category: '  ' },
    ])
    expect(r.map((g) => g.group)).toEqual(['トマト', UNGROUPED_LABEL])
    expect(r[1]!.items.map((i) => i.id)).toEqual([1, 3])
  })

  it('全て未分類なら「その他」1グループ', () => {
    const r = groupByCategory([{ id: 1 }, { id: 2, category: '' }])
    expect(r).toHaveLength(1)
    expect(r[0]!.group).toBe(UNGROUPED_LABEL)
  })
})
