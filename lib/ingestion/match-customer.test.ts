import { describe, expect, it } from 'vitest'
import { matchEmailCustomer, type CustomerIdentifiers } from './match-customer'

const customers: CustomerIdentifiers[] = [
  { id: 'york', channelIdentifiers: { subject_keywords: ['ヨーク'] } },
  { id: 'sunday', channelIdentifiers: { email: ['order@sunday.example.jp'] } },
  { id: 'terasaki', channelIdentifiers: null },
]

describe('matchEmailCustomer（マスタ駆動の取引先マッチング）', () => {
  it('送信元アドレス完全一致（大文字小文字・空白を無視）', () => {
    expect(matchEmailCustomer(' Order@Sunday.example.jp ', null, customers)).toBe('sunday')
  })

  it('件名キーワード一致（転送メール運用: Fwd: 7/3ヨーク）', () => {
    expect(matchEmailCustomer('boss@gmail.example.com', 'Fwd: 7/3ヨーク', customers)).toBe('york')
  })

  it('送信元一致が件名より優先される', () => {
    expect(matchEmailCustomer('order@sunday.example.jp', 'Fwd: 7/3ヨーク', customers)).toBe('sunday')
  })

  it('どれにも一致しない → null（未紐付けで人間確認）', () => {
    expect(matchEmailCustomer('unknown@example.com', '注文です', customers)).toBeNull()
    expect(matchEmailCustomer(null, null, customers)).toBeNull()
  })

  it('同一アドレスが複数取引先に登録されていたら誤紐付けせず null', () => {
    const dup: CustomerIdentifiers[] = [
      { id: 'a', channelIdentifiers: { email: ['x@example.com'] } },
      { id: 'b', channelIdentifiers: { email: ['x@example.com'] } },
    ]
    expect(matchEmailCustomer('x@example.com', null, dup)).toBeNull()
  })

  it('件名キーワードが複数取引先に一致したら null', () => {
    const dup: CustomerIdentifiers[] = [
      { id: 'a', channelIdentifiers: { subject_keywords: ['注文'] } },
      { id: 'b', channelIdentifiers: { subject_keywords: ['注文'] } },
    ]
    expect(matchEmailCustomer(null, 'ご注文', dup)).toBeNull()
  })
})
