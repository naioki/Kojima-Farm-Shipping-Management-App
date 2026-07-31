import { describe, it, expect } from 'vitest'
import { FIELD_STATUS_STYLE, fieldStatusStyle } from './status-style'
import { rowStatusKey, type RowStatusKey } from './shipment-sort'
import { FIELD_STATUS_META } from './tap-loop'
import type { FieldStatus } from '@/types/database'

const ALL_KEYS: RowStatusKey[] = ['not_started', 'interrupted', 'packed', 'shipped']
const FIELD_STATUSES: FieldStatus[] = ['not_started', 'packed', 'shipped']

describe('FIELD_STATUS_STYLE', () => {
  it('4区分すべてに配色がある（画面が状態を表現できない穴を作らない）', () => {
    for (const k of ALL_KEYS) {
      expect(FIELD_STATUS_STYLE[k], k).toBeDefined()
      expect(FIELD_STATUS_STYLE[k].label).not.toBe('')
    }
  })

  it('状態ごとに文字色が重複しない（隣り合う状態が同じ色に見えない）', () => {
    const texts = ALL_KEYS.map((k) => FIELD_STATUS_STYLE[k].text)
    expect(new Set(texts).size).toBe(ALL_KEYS.length)
  })

  it('進捗の意味づけどおりの色を持つ（梱包完了=青／出荷済=緑）', () => {
    // ここが入れ替わると「緑＝終わった」の直感が壊れ、梱包しただけの荷を出荷済みと誤読する
    expect(FIELD_STATUS_STYLE.packed.text).toContain('trust')
    expect(FIELD_STATUS_STYLE.shipped.text).toContain('harvest')
    expect(FIELD_STATUS_STYLE.interrupted.text).toContain('warning')
  })

  it('ラベルは tap-loop のメタと一致する（同じ状態を別名で呼ばない）', () => {
    for (const s of FIELD_STATUSES) {
      expect(FIELD_STATUS_STYLE[s].label, s).toBe(FIELD_STATUS_META[s].label)
    }
  })
})

describe('fieldStatusStyle', () => {
  it('FieldStatus の3状態をそのまま引ける', () => {
    for (const s of FIELD_STATUSES) {
      expect(fieldStatusStyle(s)).toBe(FIELD_STATUS_STYLE[s])
    }
  })

  it('rowStatusKey の結果と組み合わせて中断も引ける', () => {
    // できた数(20) < 受注(50) かつ未出荷 → 中断（黄）
    const key = rowStatusKey('packed', 20, 50)
    expect(key).toBe('interrupted')
    expect(FIELD_STATUS_STYLE[key].text).toContain('warning')
  })

  it('出荷済みは、できた数が受注未満でも出荷済みの色（緑）を保つ', () => {
    const key = rowStatusKey('shipped', 20, 50)
    expect(FIELD_STATUS_STYLE[key]).toBe(FIELD_STATUS_STYLE.shipped)
  })
})
