import { describe, it, expect } from 'vitest'
import { foldKana } from '@/lib/normalize/kana'
import { normalizeForMatch } from '@/lib/matching/name-match'

describe('foldKana', () => {
  it('ひらがなをカタカナへ統一する', () => {
    expect(foldKana('らでぃっしゅ')).toBe('ラディッシュ')
  })
  it('品目名の照合でも表記ゆれを同一視する', () => {
    expect(normalizeForMatch('ちんげんさい')).toBe(normalizeForMatch('チンゲンサイ'))
  })
})
