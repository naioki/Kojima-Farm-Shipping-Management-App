import { describe, it, expect } from 'vitest'
import { summarizeReceiptError } from '@/components/admin/InboxReceiptCard'

describe('読み取り失敗の理由（日本語の要約）', () => {
  it('英語の例外は日本語の原因に言い換える', () => {
    expect(summarizeReceiptError('Gemini解析失敗: 429 Too Many Requests: quota exceeded')).toContain('利用回数の上限')
    expect(summarizeReceiptError('AIの読み取りに失敗しました（原因: fetch failed）')).toContain('通信エラー')
    expect(summarizeReceiptError('AIの読み取りに失敗しました（原因: Something odd happened）')).toBe(
      'AIの読み取りに失敗しました（原因: 不明なエラー）。「もう一度読み取る」を押してください',
    )
  })
  it('日本語の理由はそのまま出す', () => {
    expect(summarizeReceiptError('商品マスタの取得に失敗: 接続できません')).toBe('商品マスタの取得に失敗: 接続できません')
  })
})
