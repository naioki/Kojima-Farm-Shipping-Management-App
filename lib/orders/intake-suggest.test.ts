import { describe, it, expect } from 'vitest'
import { inputKindOf, suggestIntakeChannel } from './intake-suggest'

describe('受注経路の推定', () => {
  it('入力の種類', () => {
    expect(inputKindOf(null)).toBe('text')
    expect(inputKindOf({ mimeType: 'image/jpeg', fileName: 'IMG_1.jpg' })).toBe('image')
    expect(inputKindOf({ mimeType: 'application/pdf', fileName: 'fax.pdf' })).toBe('pdf')
    expect(inputKindOf({ mimeType: '', fileName: '注文.xlsx' })).toBe('sheet')
  })
  it('テキスト→LINE、画像→紙、PDF/Excel→推定しない', () => {
    expect(suggestIntakeChannel('text')).toBe('line')
    expect(suggestIntakeChannel('image')).toBe('paper')
    expect(suggestIntakeChannel('pdf')).toBeNull()
    expect(suggestIntakeChannel('sheet')).toBeNull()
  })
})
