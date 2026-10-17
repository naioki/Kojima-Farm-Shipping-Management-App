import { describe, it, expect } from 'vitest'
import Decimal from 'decimal.js'
import { parseQuantity, decomposeByContainer } from './parse-quantity'

describe('parseQuantity — c記法（ケース＋端数）', () => {
  it('"15c2" は 15ケース+端数2 = 15*P/C + 2 を総数にする（P/C=8 → 122）', () => {
    const r = parseQuantity('15c2', { packsPerCase: 8 })
    expect(r.type).toBe('ok')
    if (r.type !== 'ok') return
    expect(r.total.toNumber()).toBe(122)
    expect(r.cases).toBe(15)
    expect(r.loose).toBe(2)
    expect(r.interpretation).toBe('cases')
  })

  it('"15c"（端数なし）は 15*P/C（P/C=10 → 150）', () => {
    const r = parseQuantity('15c', { packsPerCase: 10 })
    expect(r.type === 'ok' && r.total.toNumber()).toBe(150)
    expect(r.type === 'ok' && r.loose).toBe(0)
  })

  it('大文字C・全角でも解釈する（"１５Ｃ２" → 122）', () => {
    const r = parseQuantity('１５Ｃ２', { packsPerCase: 8 })
    expect(r.type === 'ok' && r.total.toNumber()).toBe(122)
  })

  it('P/C 未設定の c記法は誤推測せずエラー（要人間確認）', () => {
    const r = parseQuantity('15c2')
    expect(r.type).toBe('error')
    if (r.type === 'error') expect(r.reason).toBe('packs_per_case_required')
  })
})

describe('parseQuantity — x記法（★絶対ルール：x の後の数字＝合計個数）', () => {
  it('"x58" は合計58（箱数ではない）', () => {
    const r = parseQuantity('x58')
    expect(r.type).toBe('ok')
    if (r.type !== 'ok') return
    expect(r.total.toNumber()).toBe(58)
    expect(r.interpretation).toBe('x_total')
  })

  it('"3x58" でも掛け算せず合計58（174 にしない）', () => {
    const r = parseQuantity('3x58')
    expect(r.type === 'ok' && r.total.toNumber()).toBe(58)
  })

  it('全角"ｘ５８" も合計58', () => {
    const r = parseQuantity('ｘ５８')
    expect(r.type === 'ok' && r.total.toNumber()).toBe(58)
  })

  it('x記法は c記法より優先（"5x58" は c記法に取られない）', () => {
    const r = parseQuantity('5x58', { packsPerCase: 8 })
    expect(r.type === 'ok' && r.total.toNumber()).toBe(58)
  })
})

describe('parseQuantity — プレーン数値・削除・異常', () => {
  it('"10" はそのまま総数10', () => {
    const r = parseQuantity('10')
    expect(r.type === 'ok' && r.total.toNumber()).toBe(10)
    expect(r.type === 'ok' && r.interpretation).toBe('plain')
  })

  it('"0" は削除ではなく総数0（空欄と区別）', () => {
    const r = parseQuantity('0')
    expect(r.type).toBe('ok')
    expect(r.type === 'ok' && r.total.toNumber()).toBe(0)
  })

  it('空文字は削除指示', () => {
    expect(parseQuantity('').type).toBe('delete')
  })

  it('空白のみも削除指示', () => {
    expect(parseQuantity('   ').type).toBe('delete')
  })

  it('小数 "2.5" も許容', () => {
    const r = parseQuantity('2.5')
    expect(r.type === 'ok' && r.total.equals(new Decimal('2.5'))).toBe(true)
  })

  it('解釈不能文字列はエラー', () => {
    const r = parseQuantity('あ')
    expect(r.type).toBe('error')
    if (r.type === 'error') expect(r.reason).toBe('unparseable')
  })
})

describe('decomposeByContainer — 総数→コンテナ数＋端数', () => {
  it('総数122・容量20 → 6コンテナ＋端数2', () => {
    const b = decomposeByContainer(new Decimal(122), 20)
    expect(b).not.toBeNull()
    expect(b!.containers).toBe(6)
    expect(b!.remainder.toNumber()).toBe(2)
  })

  it('割り切れる場合は端数0', () => {
    const b = decomposeByContainer(new Decimal(60), 20)
    expect(b!.containers).toBe(3)
    expect(b!.remainder.toNumber()).toBe(0)
  })

  it('容量未設定なら null（総数のみ表示にフォールバック）', () => {
    expect(decomposeByContainer(new Decimal(10), null)).toBeNull()
    expect(decomposeByContainer(new Decimal(10), 0)).toBeNull()
  })
})
