import { describe, it, expect } from 'vitest'
import { parseMasterEmails, canEditRules } from './permission'

describe('parseMasterEmails', () => {
  it('カンマ・改行・セミコロンで分割し正規化', () => {
    expect(parseMasterEmails('A@x.com, b@x.com\nC@x.com;d@x.com')).toEqual([
      'a@x.com',
      'b@x.com',
      'c@x.com',
      'd@x.com',
    ])
  })
  it('空・null は空配列', () => {
    expect(parseMasterEmails('')).toEqual([])
    expect(parseMasterEmails(null)).toEqual([])
    expect(parseMasterEmails(undefined)).toEqual([])
  })
  it('余分な区切り・空白を除去', () => {
    expect(parseMasterEmails(' , a@x.com , , ')).toEqual(['a@x.com'])
  })
})

describe('canEditRules', () => {
  it('ロックOFFなら誰でも可（管理者前提）', () => {
    expect(canEditRules({ lock: false, masterEmails: ['a@x.com'], userEmail: 'b@x.com' })).toBe(true)
  })
  it('ロックON＋マスター未指定なら可（総ロックアウト回避）', () => {
    expect(canEditRules({ lock: true, masterEmails: [], userEmail: 'b@x.com' })).toBe(true)
  })
  it('ロックON＋マスターに含まれる人は可（大文字小文字無視）', () => {
    expect(canEditRules({ lock: true, masterEmails: ['a@x.com'], userEmail: 'A@x.com' })).toBe(true)
  })
  it('ロックON＋マスター外は不可', () => {
    expect(canEditRules({ lock: true, masterEmails: ['a@x.com'], userEmail: 'b@x.com' })).toBe(false)
  })
  it('ロックON＋メール不明は不可', () => {
    expect(canEditRules({ lock: true, masterEmails: ['a@x.com'], userEmail: null })).toBe(false)
  })
})
