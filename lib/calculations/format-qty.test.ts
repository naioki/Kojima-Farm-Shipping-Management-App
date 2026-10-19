import { describe, it, expect } from 'vitest'
import { formatQty } from '@/lib/calculations/format-qty'

describe('formatQty（端数は一応1コンテナ表記）', () => {
  it('荷姿ありで端数がある場合、ケース数＋端数1コンテナ＋計箱数を返す', () => {
    // 250パック、1ケース20パック -> 12ケース＋端数1コンテナ(10P) 計13箱
    const res = formatQty(250, null, { base: 20, unit: 'ケース' })
    expect(res).toBe('250 / 12ケース＋端数1コンテナ(10P) 計13箱')
  })

  it('荷姿ありで割り切れる場合、ケース数のみを返す', () => {
    // 200パック、1ケース20パック -> 10ケース
    const res = formatQty(200, null, { base: 20, unit: 'ケース' })
    expect(res).toBe('200 / 10ケース')
  })

  it('荷姿ありで1ケース未満の端数のみの場合、端数1コンテナを返す', () => {
    // 15パック、1ケース20パック -> 端数1コンテナ(15P)
    const res = formatQty(15, null, { base: 20, unit: 'ケース' })
    expect(res).toBe('15 / 端数1コンテナ(15P)')
  })

  it('旧コンテナ容量フォールバックでも端数がある場合は端数1コンテナを表記する', () => {
    // 50パック、容量20 -> 2c＋端数1コンテナ(10P) 計3箱
    const res = formatQty(50, 20, null)
    expect(res).toBe('50 / 2c＋端数1コンテナ(10P) 計3箱')
  })

  it('容量未設定・0以下の場合は総数のみ返す', () => {
    const res = formatQty(100, null, null)
    expect(res).toBe('100')
  })
})
