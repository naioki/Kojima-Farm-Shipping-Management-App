import { describe, expect, it } from 'vitest'
import { matchRevisedLines, RevisionMismatchError } from './revise-match'

const db = (id: string, product_name: string) => ({ id, product_name })

describe('AI 修正の明細の照合（解析の品目名の正規化を考慮）', () => {
  it('DB が「青梗菜」で AI が正規化後の「チンゲン菜」を返しても通る（主力品目で止まらない）', () => {
    const out = matchRevisedLines([db('a', '青梗菜'), db('b', 'キュウリ')], [
      { line_key: 'b', product_name: 'キュウリ' },
      { line_key: 'a', product_name: 'チンゲン菜', raw_name: '青梗菜' },
    ])
    expect(out.map((p) => p.db.id)).toEqual(['a', 'b'])
  })

  it('DB が「チンゲン菜200g」で AI が「チンゲン菜」を返しても通る', () => {
    expect(() => matchRevisedLines([db('a', 'チンゲン菜200g')], [{ line_key: 'a', product_name: 'チンゲン菜' }])).not.toThrow()
  })

  it('同じ注文にチンゲン菜系が2行あるときは、元の表記まで一致しないと止める（取り違えを見逃さない）', () => {
    const lines = [db('a', '青梗菜'), db('b', 'チンゲン菜200g')]
    expect(() =>
      matchRevisedLines(lines, [
        { line_key: 'a', product_name: 'チンゲン菜', raw_name: 'チンゲン菜200g' },
        { line_key: 'b', product_name: 'チンゲン菜', raw_name: '青梗菜' },
      ]),
    ).toThrow(RevisionMismatchError)
    expect(() =>
      matchRevisedLines(lines, [
        { line_key: 'a', product_name: 'チンゲン菜', raw_name: '青梗菜' },
        { line_key: 'b', product_name: 'チンゲン菜', raw_name: 'チンゲン菜200g' },
      ]),
    ).not.toThrow()
  })

  it('別の品目に変わっていれば止める', () => {
    expect(() => matchRevisedLines([db('a', 'キュウリ')], [{ line_key: 'a', product_name: 'キュウリ平箱' }])).toThrow(
      RevisionMismatchError,
    )
    expect(() => matchRevisedLines([db('a', '青梗菜')], [{ line_key: 'a', product_name: '小松菜' }])).toThrow(RevisionMismatchError)
  })

  it('取り消し（明細が減った）ときのエラー文で、削除ボタンを案内する', () => {
    expect(() => matchRevisedLines([db('a', 'キュウリ'), db('b', '小松菜')], [{ line_key: 'a', product_name: 'キュウリ' }])).toThrow(
      /削除ボタン/,
    )
  })
  it('品目名が空なら一致させない（空を「チンゲン菜」とみなさない）', () => {
    expect(() => matchRevisedLines([db('a', '青梗菜')], [{ line_key: 'a' }])).toThrow(RevisionMismatchError)
    expect(() => matchRevisedLines([db('a', '')], [{ line_key: 'a', product_name: 'チンゲン菜' }])).toThrow(RevisionMismatchError)
  })
})
