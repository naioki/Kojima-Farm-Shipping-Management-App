import { describe, it, expect } from 'vitest'
import { normalizeOrgName } from '@/lib/normalize/org-name'

describe('normalizeOrgName（取引先・納入先の正規化名）', () => {
  it('法人格の表記ゆれを吸収する（株式会社/（株）/(株)）', () => {
    const want = '小島農園'
    expect(normalizeOrgName('株式会社小島農園')).toBe(want)
    expect(normalizeOrgName('（株）小島農園')).toBe(want)
    expect(normalizeOrgName('(株)小島農園')).toBe(want)
    expect(normalizeOrgName('小島農園（株）')).toBe(want)
  })

  it('全角/半角・大文字小文字を統一する', () => {
    expect(normalizeOrgName('ＹＯＲＫ')).toBe('york')
    expect(normalizeOrgName('York')).toBe('york')
    expect(normalizeOrgName('ｱｵｷ')).toBe(normalizeOrgName('アオキ'))
  })

  it('空白（半角・全角）を除去する', () => {
    expect(normalizeOrgName('寺崎 青果')).toBe('寺崎青果')
    expect(normalizeOrgName('寺崎　青果')).toBe('寺崎青果')
    expect(normalizeOrgName('  寺崎青果  ')).toBe('寺崎青果')
  })

  it('空白を挟んだ法人格も吸収する（空白除去→法人格除去の順）', () => {
    expect(normalizeOrgName('株式 会社 小島農園')).toBe('小島農園')
    expect(normalizeOrgName('（株） 小島 農園')).toBe('小島農園')
  })

  it('有限会社・合同会社などの他の法人格も除去する', () => {
    expect(normalizeOrgName('有限会社みどり')).toBe('みどり')
    expect(normalizeOrgName('みどり合同会社')).toBe('みどり')
  })

  it('null/undefined/空文字は空文字を返す', () => {
    expect(normalizeOrgName(null)).toBe('')
    expect(normalizeOrgName(undefined)).toBe('')
    expect(normalizeOrgName('')).toBe('')
    expect(normalizeOrgName('　 ')).toBe('')
  })

  it('異なる会社は衝突しない', () => {
    expect(normalizeOrgName('東海コープ')).not.toBe(normalizeOrgName('関西コープ'))
  })
})
