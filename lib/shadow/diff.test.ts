import { describe, expect, it } from 'vitest'
import { buildCanonicalizer, compareShadowLines, formatShadowReport } from './diff'

const canon = buildCanonicalizer([
  { name: 'キュウリ', aliases: ['胡瓜', 'きゅうり'] },
  { name: 'トマト', aliases: [] },
  { name: 'ネギ', aliases: ['長ネギ'] },
])

describe('compareShadowLines（v4×新アプリの突合）', () => {
  it('完全一致 → 差分ゼロ', () => {
    const v4 = [
      { store: '東道野辺', item: '胡瓜', totalQty: 90 },
      { store: '東道野辺', item: 'トマト', totalQty: 140 },
    ]
    const app = [
      { store: '東道野辺', item: 'キュウリ', totalQty: 90 },
      { store: '東道野辺', item: 'トマト', totalQty: 140 },
    ]
    const r = compareShadowLines(v4, app, canon)
    expect(r.diffs).toHaveLength(0)
    expect(r.matched).toBe(2)
  })

  it('品目名の表記差（胡瓜/キュウリ・長ネギ/ネギ）は別名で吸収する', () => {
    const r = compareShadowLines(
      [{ store: '五香', item: '長ネギ', totalQty: 50 }],
      [{ store: '五香', item: 'ネギ', totalQty: 50 }],
      canon,
    )
    expect(r.diffs).toHaveLength(0)
  })

  it('数量不一致・片側欠落を種類別に報告する', () => {
    const r = compareShadowLines(
      [
        { store: '八柱', item: 'トマト', totalQty: 100 },
        { store: '八柱', item: '胡瓜', totalQty: 30 },
      ],
      [
        { store: '八柱', item: 'トマト', totalQty: 95 },
        { store: '鎌ケ谷', item: 'トマト', totalQty: 10 },
      ],
      canon,
    )
    const kinds = r.diffs.map((d) => d.kind).sort()
    expect(kinds).toEqual(['missing_in_app', 'missing_in_v4', 'qty_mismatch'])
  })

  it('同一キーは合算してから比較する（複数明細の分割差を誤検知しない）', () => {
    const r = compareShadowLines(
      [{ store: '青葉台', item: 'トマト', totalQty: 140 }],
      [
        { store: '青葉台', item: 'トマト', totalQty: 100 },
        { store: '青葉台', item: 'トマト', totalQty: 40 },
      ],
      canon,
    )
    expect(r.diffs).toHaveLength(0)
  })

  it('数量を解釈できなかった行は unparsed_in_app として報告する', () => {
    const r = compareShadowLines(
      [{ store: '夏見台', item: 'トマト', totalQty: 30 }],
      [{ store: '夏見台', item: 'トマト', totalQty: null }],
      canon,
    )
    expect(r.diffs[0]?.kind).toBe('unparsed_in_app')
  })
})

describe('formatShadowReport', () => {
  it('差分ゼロは ✅、差分ありは ⚠️ と明細', () => {
    expect(formatShadowReport('2026-07-05', { matched: 5, diffs: [] })).toContain('✅')
    const withDiff = formatShadowReport('2026-07-05', {
      matched: 1,
      diffs: [{ kind: 'qty_mismatch', store: '東道野辺', item: 'トマト', v4Qty: 140, appQty: 130 }],
    })
    expect(withDiff).toContain('⚠️')
    expect(withDiff).toContain('東道野辺 / トマト: v4=140 / 新=130')
  })
})
