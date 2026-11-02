import { describe, it, expect } from 'vitest'
import {
  extractActionableNote,
  extractChangeDiffBadge,
  formatCleanSpecBadge,
  mergeUserMemoWithSystemTokens,
} from './clean-note'

describe('extractActionableNote', () => {
  it('システム自動メタ文字列・★新規追加・便名単体を除外し、現場への実質的な伝達事項のみを残す', () => {
    const raw =
      '伝票No: 1024 / 規格: 200gUP / 容器: 農業総研専用折りたたみコンテナ / 箱数: 60 / ★新規追加 / 数量変更: 120→150P / 手書き修正（150点） / NSK便'
    expect(extractActionableNote(raw)).toBe('')
  })

  it('実際の現場指示や店舗内訳メモはそのまま保持する', () => {
    expect(extractActionableNote('空コンテナ20個持参 / 手前に積むこと')).toBe(
      '空コンテナ20個持参 / 手前に積むこと',
    )
    expect(extractActionableNote('★新規追加 / 内訳: ライフ近畿40箱 / サンプラザ20箱')).toBe(
      '内訳: ライフ近畿40箱 / サンプラザ20箱',
    )
  })
})

describe('mergeUserMemoWithSystemTokens', () => {
  it('現場メモを更新・クリアしてもシステム履歴トークン（数量変更・★新規追加）を破壊せず保持する', () => {
    const existing = '★新規追加 / 数量変更:100→120P / 旧メモ'
    expect(mergeUserMemoWithSystemTokens(existing, '新しい現場メモ')).toBe(
      '★新規追加 / 数量変更:100→120P / 新しい現場メモ',
    )
    expect(mergeUserMemoWithSystemTokens(existing, '')).toBe(
      '★新規追加 / 数量変更:100→120P',
    )
  })
})

describe('formatCleanSpecBadge', () => {
  it('規格バッジから冗長な (入数20) 等を除去して純粋な規格名を返す', () => {
    expect(formatCleanSpecBadge('2〜3株 (入数20)')).toBe('2〜3株')
    expect(formatCleanSpecBadge('200gUP (入数24)')).toBe('200gUP')
    expect(formatCleanSpecBadge('入数20')).toBe('標準規格')
  })
})

describe('extractChangeDiffBadge', () => {
  it('矢印による数量変更・入数変更・★新規追加を抽出する', () => {
    expect(extractChangeDiffBadge('数量変更: 165→150P')).toBe('165→150P')
    expect(extractChangeDiffBadge('入数 30→20')).toBe('入数 30→20')
    expect(extractChangeDiffBadge('★新規追加')).toBe('新規追加')
  })
})
