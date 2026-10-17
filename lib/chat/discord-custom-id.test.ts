import { describe, it, expect } from 'vitest'
import {
  parseCustomId,
  buildCustomId,
  parseAllowedUsers,
  isUserAllowed,
} from './discord-custom-id'

describe('parseCustomId / buildCustomId', () => {
  it('action と引数へ分解する', () => {
    expect(parseCustomId('approve:order-1')).toEqual({ action: 'approve', args: ['order-1'] })
    expect(parseCustomId('approve_on:order-1:2026-06-15')).toEqual({
      action: 'approve_on',
      args: ['order-1', '2026-06-15'],
    })
    expect(parseCustomId('reprint:11111111-2222-3333-4444-555555555555:2026-07-13')).toEqual({
      action: 'reprint',
      args: ['11111111-2222-3333-4444-555555555555', '2026-07-13'],
    })
  })

  it('引数なし action', () => {
    expect(parseCustomId('ingest_pick')).toEqual({ action: 'ingest_pick', args: [] })
  })

  it('build と parse は往復する（UUID・日付は ":" を含まないので安全）', () => {
    const id = buildCustomId('approve_on', '11111111-2222-3333-4444-555555555555', '2026-06-15')
    expect(id).toBe('approve_on:11111111-2222-3333-4444-555555555555:2026-06-15')
    const parsed = parseCustomId(id)
    expect(parsed.action).toBe('approve_on')
    expect(parsed.args).toEqual(['11111111-2222-3333-4444-555555555555', '2026-06-15'])
  })

  it('custom_id は Discord 上限100文字に収まる', () => {
    const id = buildCustomId('approve_on', '11111111-2222-3333-4444-555555555555', '2026-06-15')
    expect(id.length).toBeLessThanOrEqual(100)
  })
})

describe('parseAllowedUsers', () => {
  it('カンマ区切りを配列へ・空白/空要素を除去', () => {
    expect(parseAllowedUsers('111, 222 ,333')).toEqual(['111', '222', '333'])
    expect(parseAllowedUsers('  111  ')).toEqual(['111'])
    expect(parseAllowedUsers('111,,222')).toEqual(['111', '222'])
  })
  it('未設定・空は空配列', () => {
    expect(parseAllowedUsers(null)).toEqual([])
    expect(parseAllowedUsers(undefined)).toEqual([])
    expect(parseAllowedUsers('')).toEqual([])
    expect(parseAllowedUsers('  ,  ')).toEqual([])
  })
})

describe('isUserAllowed', () => {
  it('許可リストが空なら全員許可', () => {
    expect(isUserAllowed([], '999')).toBe(true)
    expect(isUserAllowed([], null)).toBe(true)
  })
  it('非空リストは含まれるユーザーのみ許可', () => {
    expect(isUserAllowed(['111', '222'], '222')).toBe(true)
    expect(isUserAllowed(['111', '222'], '333')).toBe(false)
  })
  it('非空リスト下で userId 不明は拒否', () => {
    expect(isUserAllowed(['111'], null)).toBe(false)
    expect(isUserAllowed(['111'], undefined)).toBe(false)
  })
})
