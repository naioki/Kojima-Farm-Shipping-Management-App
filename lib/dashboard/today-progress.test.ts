import { describe, it, expect } from 'vitest'
import { computeTodayProgress, type ProgressItem, type ProgressDelivery } from './today-progress'
import { deliveryUnitKey } from '@/lib/deliveries/unit'

const item = (
  customerId: string,
  destinationId: string | null,
  fieldStatus: string | null,
  lineTotal = 0,
): ProgressItem => ({ customerId, destinationId, fieldStatus, lineTotal })

const delivery = (
  customerId: string,
  destinationId: string | null,
  status: string,
): ProgressDelivery => ({ customerId, destinationId, status })

describe('deliveryUnitKey', () => {
  it('納入先なしは空文字で表す（null と undefined を混ぜない）', () => {
    expect(deliveryUnitKey('c1', null)).toBe('c1:')
    expect(deliveryUnitKey('c1', undefined)).toBe('c1:')
  })

  it('納入先が違えば別のキーになる', () => {
    expect(deliveryUnitKey('c1', 'd1')).not.toBe(deliveryUnitKey('c1', 'd2'))
  })
})

describe('明細単位の集計', () => {
  it('field_status ごとに数え、金額も積む', () => {
    const { items } = computeTodayProgress({
      items: [
        item('c1', null, 'shipped', 100),
        item('c1', null, 'packed', 200),
        item('c1', null, 'not_started', 300),
        item('c1', null, null, 400),
      ],
      deliveries: [],
    })
    expect(items.total).toBe(4)
    expect(items.shipped).toBe(1)
    expect(items.packed).toBe(1)
    expect(items.notStarted).toBe(2) // null は未着手扱い
    expect(items.amounts.shipped).toBe(100)
    expect(items.amounts.notStarted).toBe(700)
  })

  it('対象0件でも 0% で、ゼロ除算しない', () => {
    const { items } = computeTodayProgress({ items: [], deliveries: [] })
    expect(items.total).toBe(0)
    expect(items.pct).toBe(0)
  })

  it('進捗率は出荷済みの割合', () => {
    const { items } = computeTodayProgress({
      items: [item('c1', null, 'shipped'), item('c1', null, 'shipped'), item('c1', null, 'packed'), item('c1', null, null)],
      deliveries: [],
    })
    expect(items.pct).toBe(50)
  })
})

describe('配送先単位の集計', () => {
  it('deliveries 行が無い配送先も母数に入れる（朝いちばんに100%と出さない）', () => {
    // これが以前の食い違いの元。明細はあるが deliveries が0行の時点で
    // 「完了率」を deliveries だけで出すと 0/0 になり、経営が誤読する
    const { deliveries } = computeTodayProgress({
      items: [item('c1', 'd1', null), item('c2', null, null)],
      deliveries: [],
    })
    expect(deliveries.total).toBe(2)
    expect(deliveries.planned).toBe(2)
    expect(deliveries.delivered).toBe(0)
    expect(deliveries.pct).toBe(0)
  })

  it('状態ごとに数える', () => {
    const { deliveries } = computeTodayProgress({
      items: [],
      deliveries: [
        delivery('c1', 'd1', 'delivered'),
        delivery('c2', null, 'loaded'),
        delivery('c3', null, 'planned'),
      ],
    })
    expect(deliveries.total).toBe(3)
    expect(deliveries.delivered).toBe(1)
    expect(deliveries.loaded).toBe(1)
    expect(deliveries.planned).toBe(1)
    expect(deliveries.pct).toBe(33)
  })

  it('同じ配送先の明細が何行あっても配送先は1件として数える', () => {
    const { deliveries, items } = computeTodayProgress({
      items: [item('c1', 'd1', null), item('c1', 'd1', null), item('c1', 'd1', null)],
      deliveries: [],
    })
    expect(items.total).toBe(3) // 明細は3
    expect(deliveries.total).toBe(1) // 配送先は1
  })
})

describe('明細と配送の食い違い検出', () => {
  it('納品完了なのに未出荷の明細が残っていたら知らせる', () => {
    // 出荷一覧側の記録漏れ。売上・請求の集計から落ちる
    const { mismatches } = computeTodayProgress({
      items: [item('c1', 'd1', 'shipped'), item('c1', 'd1', 'packed')],
      deliveries: [delivery('c1', 'd1', 'delivered')],
    })
    expect(mismatches).toEqual([
      { key: 'c1:d1', kind: 'delivered_but_not_shipped', itemCount: 1 },
    ])
  })

  it('全部出荷済みなのに納品完了になっていなければ知らせる', () => {
    // 配送側の記録漏れ。誤配送クレーム時の証跡が残らない
    const { mismatches } = computeTodayProgress({
      items: [item('c1', 'd1', 'shipped'), item('c1', 'd1', 'shipped')],
      deliveries: [delivery('c1', 'd1', 'loaded')],
    })
    expect(mismatches).toEqual([
      { key: 'c1:d1', kind: 'shipped_but_not_delivered', itemCount: 2 },
    ])
  })

  it('両方そろっていれば食い違いなし', () => {
    const { mismatches } = computeTodayProgress({
      items: [item('c1', 'd1', 'shipped')],
      deliveries: [delivery('c1', 'd1', 'delivered')],
    })
    expect(mismatches).toEqual([])
  })

  it('作業途中（未出荷あり・未納品）は食い違いにしない', () => {
    // まだ作業中なだけ。ここで警告を出すと日中ずっと警告が出っぱなしになる
    const { mismatches } = computeTodayProgress({
      items: [item('c1', 'd1', 'shipped'), item('c1', 'd1', 'not_started')],
      deliveries: [delivery('c1', 'd1', 'planned')],
    })
    expect(mismatches).toEqual([])
  })

  it('配送先ごとに独立して判定する', () => {
    const { mismatches } = computeTodayProgress({
      items: [
        item('c1', 'd1', 'packed'), // 納品済みなのに未出荷
        item('c2', null, 'shipped'), // 出荷済みなのに未納品
      ],
      deliveries: [delivery('c1', 'd1', 'delivered'), delivery('c2', null, 'planned')],
    })
    expect(mismatches).toHaveLength(2)
    expect(mismatches.map((m) => m.kind).sort()).toEqual([
      'delivered_but_not_shipped',
      'shipped_but_not_delivered',
    ])
  })

  it('明細が無い配送先は食い違い判定の対象外', () => {
    // 明細が消された配送先で「出荷済み0件＝全部出荷済み」と誤判定しないこと
    const { mismatches } = computeTodayProgress({
      items: [],
      deliveries: [delivery('c1', 'd1', 'loaded')],
    })
    expect(mismatches).toEqual([])
  })

  it('納入先違いを同一視しない', () => {
    const { mismatches, deliveries } = computeTodayProgress({
      items: [item('c1', 'd1', 'shipped'), item('c1', 'd2', 'packed')],
      deliveries: [delivery('c1', 'd1', 'delivered')],
    })
    expect(deliveries.total).toBe(2)
    // d1 は整合、d2 は作業中なので食い違いなし
    expect(mismatches).toEqual([])
  })
})
