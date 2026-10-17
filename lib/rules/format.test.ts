import { describe, it, expect } from 'vitest'
import { formatRuleChanges, summarizeRuleChanges } from './format'

describe('formatRuleChanges', () => {
  it('変わった規格項目だけを旧→新で返す', () => {
    const changes = formatRuleChanges(
      { packs_per_case: 12, spec: 'L', has_card: false, container_type: 'ケース' },
      { packs_per_case: 15, spec: '2L', has_card: true, container_type: 'ケース' },
    )
    expect(changes).toEqual([
      { field: 'packs_per_case', label: 'P/C', before: '12', after: '15' },
      { field: 'spec', label: '規格', before: 'L', after: '2L' },
      { field: 'has_card', label: 'カード', before: 'なし', after: 'あり' },
    ])
  })

  it('null/空は — で表示', () => {
    const changes = formatRuleChanges({ spec: null }, { spec: 'L' })
    expect(changes).toEqual([{ field: 'spec', label: '規格', before: '—', after: 'L' }])
  })

  it('端数ポリシーは日本語化', () => {
    const changes = formatRuleChanges({ fraction_policy: 'confirm' }, { fraction_policy: 'carry_over' })
    expect(changes[0]).toMatchObject({ label: '端数', before: '確認', after: '繰越' })
  })

  it('新規作成（old=null）は空項目を出さない', () => {
    const changes = formatRuleChanges(null, { packs_per_case: 10, spec: null, container_type: '' })
    expect(changes).toEqual([{ field: 'packs_per_case', label: 'P/C', before: '—', after: '10' }])
  })

  it('summarize は1行にまとめる', () => {
    const s = summarizeRuleChanges([
      { field: 'packs_per_case', label: 'P/C', before: '12', after: '15' },
      { field: 'spec', label: '規格', before: 'L', after: '2L' },
    ])
    expect(s).toBe('P/C 12→15 / 規格 L→2L')
  })
})
