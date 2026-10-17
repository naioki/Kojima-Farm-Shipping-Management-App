import { describe, it, expect } from 'vitest'
import { parseDocType, docTypeMeta, DELIVERY_DOC_TYPES } from './doc-type'

describe('parseDocType', () => {
  it('既知値はそのまま', () => {
    expect(parseDocType('delivery')).toBe('delivery')
    expect(parseDocType('order_confirmation')).toBe('order_confirmation')
  })
  it('未知値・null は fallback（既定 delivery）', () => {
    expect(parseDocType('xxx')).toBe('delivery')
    expect(parseDocType(null)).toBe('delivery')
    expect(parseDocType(undefined)).toBe('delivery')
  })
  it('fallback を明示できる', () => {
    expect(parseDocType(null, 'order_confirmation')).toBe('order_confirmation')
  })
})

describe('docTypeMeta', () => {
  it('納品書は納品の文言', () => {
    expect(docTypeMeta('delivery')).toEqual({
      title: '納品書',
      lead: '下記のとおり納品いたしました。',
      dateLabel: '納品日',
    })
  })
  it('ご注文確認書は受注の文言・納品予定日', () => {
    const m = docTypeMeta('order_confirmation')
    expect(m.title).toBe('ご注文確認書')
    expect(m.dateLabel).toBe('納品予定日')
    expect(m.lead).toContain('ご注文を承りました')
  })
})

describe('DELIVERY_DOC_TYPES', () => {
  it('2種類', () => {
    expect(DELIVERY_DOC_TYPES).toHaveLength(2)
  })
})
