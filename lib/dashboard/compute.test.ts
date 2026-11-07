import { describe, expect, it } from 'vitest'
import {
  chooseYenUnit,
  computePackProgress,
  computeTodayShipment,
  computeUnbilled,
  dailyTrend,
  formatAxisTick,
  monthToDateRanges,
  pctChange,
  sumAmounts,
  sumInRange,
  sumIssuedInvoices,
} from './compute'

describe('monthToDateRanges（前月同期）', () => {
  it('今月1〜6日 と 前月1〜6日 を比べる', () => {
    const r = monthToDateRanges('2026-11-06')
    expect(r.cur).toEqual({ start: '2026-11-01', end: '2026-11-06' })
    expect(r.prev).toEqual({ start: '2026-10-01', end: '2026-10-06' })
    expect(r.curYm).toBe('2026-11')
    expect(r.prevYm).toBe('2026-10')
  })
  it('前月に同じ日が無いときは前月末で止める', () => {
    expect(monthToDateRanges('2026-03-31').prev).toEqual({ start: '2026-02-01', end: '2026-02-28' })
    expect(monthToDateRanges('2028-03-30').prev.end).toBe('2028-02-29')
  })
  it('1月は前年12月と比べる', () => {
    expect(monthToDateRanges('2027-01-15').prev).toEqual({ start: '2026-12-01', end: '2026-12-15' })
  })
})

describe('pctChange / sumAmounts', () => {
  it('比較元0は比べられない', () => {
    expect(pctChange(100, 0)).toBeNull()
    expect(pctChange(150, 100)).toBe(50)
  })
  it('文字列の金額も数値として足す（文字列連結にしない）', () => {
    expect(sumAmounts([{ line_total: '1000.50' }, { line_total: 2000 }, { line_total: null }])).toBe(3000.5)
  })
  it('期間内だけ合計する', () => {
    const rows = [
      { date: '2026-10-01', amount: 100 },
      { date: '2026-10-06', amount: 200 },
      { date: '2026-10-07', amount: 400 }, // 前月同期の外
      { date: null, amount: 800 },
    ]
    expect(sumInRange(rows, { start: '2026-10-01', end: '2026-10-06' })).toBe(300)
  })
})

describe('dailyTrend（出荷推移）', () => {
  it('出荷のない日も0で埋め、1日〜今日の全日を並べる', () => {
    const t = dailyTrend(
      [
        { date: '2026-11-02', amount: 1000 },
        { date: '2026-11-02', amount: '500' },
        { date: '2026-11-04', amount: 300 },
        { date: '2026-11-09', amount: 999 }, // 期間外（未来）
      ],
      { start: '2026-11-01', end: '2026-11-05' },
    )
    expect(t.map((p) => p.label)).toEqual(['11/1', '11/2', '11/3', '11/4', '11/5'])
    expect(t.map((p) => p.value)).toEqual([0, 1500, 0, 300, 0])
  })
})

describe('chooseYenUnit / formatAxisTick', () => {
  it('金額の大きさで単位を選ぶ', () => {
    expect(chooseYenUnit(800).label).toBe('円')
    expect(chooseYenUnit(8000).label).toBe('千円')
    expect(chooseYenUnit(22998).label).toBe('千円')
    expect(chooseYenUnit(3_500_000).label).toBe('万円')
  })
  it('目盛り', () => {
    expect(formatAxisTick(6500, 1000)).toBe('6.5')
    expect(formatAxisTick(25000, 1000)).toBe('25')
    expect(formatAxisTick(1234, 1)).toBe('1,234')
  })
})

describe('sumIssuedInvoices（請求金額）', () => {
  const r = { start: '2026-11-01', end: '2026-11-06' }
  it('下書き・無効は数えない。発行日が空なら作成日で数える', () => {
    const invs = [
      { status: 'finalized', issue_date: '2026-11-02', created_date: '2026-11-02', total_amount: 1000 },
      { status: 'sent', issue_date: null, created_date: '2026-11-03', total_amount: '2000' },
      { status: 'paid', issue_date: '2026-11-05', created_date: '2026-11-01', total_amount: 4000 },
      { status: 'draft', issue_date: '2026-11-02', created_date: '2026-11-02', total_amount: 8000 },
      { status: 'void', issue_date: '2026-11-02', created_date: '2026-11-02', total_amount: 16000 },
      { status: 'finalized', issue_date: '2026-10-31', created_date: '2026-11-01', total_amount: 32000 },
    ]
    expect(sumIssuedInvoices(invs, r)).toBe(7000)
  })
})

describe('computeUnbilled（未請求額）', () => {
  it('有効な請求書に載っていない明細の金額だけを足す', () => {
    const items = [
      { id: 'a', line_total: 1000 },
      { id: 'b', line_total: '2000' },
      { id: 'c', line_total: 4000 }, // 請求済み
      { id: 'd', line_total: 0 }, // 単価未設定は件数に入れない
    ]
    expect(computeUnbilled(items, new Set(['c']))).toEqual({ amount: 3000, count: 2 })
  })
})

describe('箱数基準の進捗', () => {
  it('明日分: % は完成箱数 ÷ 目標箱数（パック数基準ではない）', () => {
    const p = computePackProgress([
      { field_status: 'packed', quantity: 220, spec: null }, // 11箱 完成
      { field_status: 'not_started', quantity: 380, spec: null }, // 19箱
    ])
    expect(p.totalBoxes).toBe(30)
    expect(p.completedBoxes).toBe(11)
    expect(p.progressPct).toBe(37) // 11/30
    expect(p.completedItems).toBe(1)
  })
  it('部分完了は完成した箱だけ数える', () => {
    const p = computePackProgress([{ field_status: 'not_started', quantity: 50, shipped_qty: 30, spec: '24入' }])
    expect(p.totalBoxes).toBe(3)
    expect(p.completedBoxes).toBe(1)
    expect(p.completedPacks).toBe(30)
  })
  it('本日分: 進捗率 = (梱包完了＋出荷済み)箱 ÷ 全箱、カードの箱数と一致', () => {
    const s = computeTodayShipment([
      { field_status: 'not_started', quantity: 40, line_total: 100 },
      { field_status: 'packed', quantity: 20, line_total: 200 },
      { field_status: 'shipped', quantity: 20, line_total: 300 },
    ])
    expect([s.notStarted, s.packed, s.shipped]).toEqual([2, 1, 1])
    expect(s.totalBoxes).toBe(4)
    expect(s.doneBoxes).toBe(2)
    expect(s.progressPct).toBe(50)
    expect(s.amounts).toEqual({ notStarted: 100, packed: 200, shipped: 300 })
    expect(s.itemCounts).toEqual({ notStarted: 1, packed: 1, shipped: 1 })
  })
  it('0件は0%', () => {
    expect(computeTodayShipment([]).progressPct).toBe(0)
    expect(computePackProgress([]).progressPct).toBe(0)
  })
})
