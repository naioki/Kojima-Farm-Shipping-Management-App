import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PACKS_PER_CASE,
  formatPacksPerCase,
  packsPerCaseSourceLabel,
  positiveNumber,
  resolvePacksPerCase,
  splitPacksForCustomer,
  uniquePackValue,
} from './packs-per-case'

describe('resolvePacksPerCase（取引先別 → 荷姿 → 品目の標準 → 既定20）', () => {
  const all = {
    rule: { packs_per_case: 24 },
    packConfig: { base_per_selling: 30 },
    customerPacks: [{ base_per_selling: 25 }],
    sharedPacks: [{ base_per_selling: 15 }],
    product: { container_capacity: 50 },
  }

  it('取引先別ルールが最優先（荷姿の入数より上）', () => {
    expect(resolvePacksPerCase(all)).toEqual({ value: 24, source: 'customer_rule' })
  })

  it('ルールが無ければ明細の荷姿', () => {
    expect(resolvePacksPerCase({ ...all, rule: null })).toEqual({ value: 30, source: 'pack_config' })
  })

  it('明細に荷姿が無ければ 取引先専用 → 取引先共通 の順', () => {
    expect(resolvePacksPerCase({ ...all, rule: null, packConfig: null })).toEqual({ value: 25, source: 'pack_config' })
    expect(resolvePacksPerCase({ ...all, rule: null, packConfig: null, customerPacks: [] })).toEqual({
      value: 15,
      source: 'pack_config',
    })
  })

  it('荷姿も無ければ品目の標準、それも無ければ既定20', () => {
    expect(resolvePacksPerCase({ product: { container_capacity: 50 } })).toEqual({ value: 50, source: 'product' })
    expect(resolvePacksPerCase({})).toEqual({ value: DEFAULT_PACKS_PER_CASE, source: 'default' })
    expect(resolvePacksPerCase({ rule: null, packConfig: null, customerPacks: null, sharedPacks: null, product: null })).toEqual({
      value: 20,
      source: 'default',
    })
  })

  it('0・負値・空文字・数値でない値は未設定として次の段へ', () => {
    expect(
      resolvePacksPerCase({
        rule: { packs_per_case: 0 },
        packConfig: { base_per_selling: -5 },
        customerPacks: [{ base_per_selling: 'abc' }],
        sharedPacks: [{ base_per_selling: '' }],
        product: { container_capacity: 0 },
      }),
    ).toEqual({ value: 20, source: 'default' })
    expect(resolvePacksPerCase({ rule: { packs_per_case: -1 }, product: { container_capacity: 12 } })).toEqual({
      value: 12,
      source: 'product',
    })
  })

  it('DB の NUMERIC が文字列で来ても数値として扱う', () => {
    expect(resolvePacksPerCase({ rule: { packs_per_case: '24' } })).toEqual({ value: 24, source: 'customer_rule' })
    expect(resolvePacksPerCase({ packConfig: { base_per_selling: '20.000' } })).toEqual({ value: 20, source: 'pack_config' })
  })

  it('10未満の入数もそのまま使う（例: 1箱8入）', () => {
    expect(resolvePacksPerCase({ rule: { packs_per_case: 8 }, product: { container_capacity: 20 } })).toEqual({
      value: 8,
      source: 'customer_rule',
    })
  })

  it('同じ段に入数の違う荷姿が複数あると決められないので次の段へ', () => {
    expect(
      resolvePacksPerCase({
        customerPacks: [{ base_per_selling: 15 }, { base_per_selling: 25 }],
        sharedPacks: [{ base_per_selling: 30 }],
      }),
    ).toEqual({ value: 30, source: 'pack_config' })
    expect(
      resolvePacksPerCase({
        sharedPacks: [{ base_per_selling: 15 }, { base_per_selling: 25 }],
        product: { container_capacity: 50 },
      }),
    ).toEqual({ value: 50, source: 'product' })
  })

  it('入数が同じ荷姿が複数あるのは問題なし・非アクティブは数えない', () => {
    expect(resolvePacksPerCase({ sharedPacks: [{ base_per_selling: 20 }, { base_per_selling: '20.000' }] })).toEqual({
      value: 20,
      source: 'pack_config',
    })
    expect(
      resolvePacksPerCase({ sharedPacks: [{ base_per_selling: 20 }, { base_per_selling: 15, is_active: false }] }),
    ).toEqual({ value: 20, source: 'pack_config' })
  })

  it('明細で選ばれた荷姿は非アクティブでも使う（過去の注文の箱数を変えない）', () => {
    expect(resolvePacksPerCase({ packConfig: { base_per_selling: 24, is_active: false } })).toEqual({
      value: 24,
      source: 'pack_config',
    })
  })
})

describe('補助関数', () => {
  it('positiveNumber', () => {
    expect(positiveNumber(3)).toBe(3)
    expect(positiveNumber('3')).toBe(3)
    expect(positiveNumber(0)).toBeNull()
    expect(positiveNumber(null)).toBeNull()
    expect(positiveNumber(undefined)).toBeNull()
    expect(positiveNumber(Number.NaN)).toBeNull()
    expect(positiveNumber(Number.POSITIVE_INFINITY)).toBeNull()
  })

  it('uniquePackValue', () => {
    expect(uniquePackValue([])).toBeNull()
    expect(uniquePackValue(null)).toBeNull()
    expect(uniquePackValue([{ base_per_selling: 24 }])).toBe(24)
    expect(uniquePackValue([{ base_per_selling: 24 }, { base_per_selling: 20 }])).toBeNull()
  })

  it('表示ラベル', () => {
    expect(packsPerCaseSourceLabel('customer_rule')).toBe('取引先別の設定')
    expect(packsPerCaseSourceLabel('pack_config')).toBe('荷姿')
    expect(packsPerCaseSourceLabel('product')).toBe('品目の標準')
    expect(packsPerCaseSourceLabel('default')).toBe('既定')
    expect(formatPacksPerCase({ value: 24, source: 'customer_rule' })).toBe('24（取引先別の設定）')
  })

  it('splitPacksForCustomer は品目・取引先で振り分け、非アクティブを除く', () => {
    const packs = [
      { id: 'a', product_id: 'p1', customer_id: 'c1', base_per_selling: 24 },
      { id: 'b', product_id: 'p1', customer_id: null, base_per_selling: 20 },
      { id: 'c', product_id: 'p1', customer_id: 'c2', base_per_selling: 25 },
      { id: 'd', product_id: 'p2', customer_id: null, base_per_selling: 10 },
      { id: 'e', product_id: 'p1', customer_id: null, base_per_selling: 15, is_active: false },
    ]
    const r = splitPacksForCustomer(packs, 'c1', 'p1')
    expect(r.customerPacks.map((p) => p.id)).toEqual(['a'])
    expect(r.sharedPacks.map((p) => p.id)).toEqual(['b'])
    const none = splitPacksForCustomer(packs, null, 'p1')
    expect(none.customerPacks).toEqual([])
    expect(none.sharedPacks.map((p) => p.id)).toEqual(['b'])
  })
})
