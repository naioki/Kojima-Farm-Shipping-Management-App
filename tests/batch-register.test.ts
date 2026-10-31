import { describe, it, expect } from 'vitest'
import { matchDestination, resolveBatchDate, createBatchModePlanner } from '@/lib/field/batch-register'

const pool = [
  { id: 'a', label: 'パルシステム 岩槻' },
  { id: 'b', label: 'パルシステム 相模センター' },
  { id: 'c', label: 'らでぃっしゅぼーや 岩槻ST' },
]

describe('matchDestination', () => {
  it('カナ表記ゆれ・空白差を吸収して一致する', () => {
    expect(matchDestination('ラディッシュボーヤ岩槻ST', pool)?.id).toBe('c')
    expect(matchDestination('パルシステム　相模センター', pool)?.id).toBe('b')
  })
  it('完全一致を部分一致より優先する（岩槻STがパル岩槻に吸収されない）', () => {
    expect(matchDestination('パルシステム岩槻', pool)?.id).toBe('a')
  })
  it('2文字以下の短い名前では部分一致しない', () => {
    expect(matchDestination('岩槻', pool)).toBeUndefined()
  })
  it('未登録の納入先は undefined を返す（null 納入先で保存させない）', () => {
    expect(matchDestination('生協 新センター', pool)).toBeUndefined()
  })
  it('名前が空なら候補1件のときだけ採用', () => {
    expect(matchDestination('', pool.slice(0, 1))?.id).toBe('a')
    expect(matchDestination('', pool)).toBeUndefined()
  })
  it('動的に自動作成された納入先（5北海道等）が後続行のプールから正しく再利用される', () => {
    const dynamicPool = [...pool, { id: 'd_hokkaido', label: '5北海道' }]
    expect(matchDestination('5北海道', dynamicPool)?.id).toBe('d_hokkaido')
    expect(matchDestination('5 北海道', dynamicPool)?.id).toBe('d_hokkaido')
  })
})

describe('resolveBatchDate', () => {
  it('過去日でも伝票の日付をそのまま使う', () => {
    expect(resolveBatchDate('2026-10-01', '2026-10-31')).toBe('2026-10-01')
  })
  it('日付が無い/不正なときだけ fallback', () => {
    expect(resolveBatchDate(null, '2026-10-31')).toBe('2026-10-31')
    expect(resolveBatchDate('10/31', '2026-10-31')).toBe('2026-10-31')
  })
})

describe('createBatchModePlanner', () => {
  it('同一キー2件目以降は increase、別店舗・別日は set', () => {
    const plan = createBatchModePlanner()
    const base = { customerId: 'x', productId: 'p', destinationId: 'a', date: '2026-10-31' }
    expect(plan(base)).toBe('set')
    expect(plan(base)).toBe('increase')
    expect(plan({ ...base, destinationId: 'b' })).toBe('set')
    expect(plan({ ...base, date: '2026-11-01' })).toBe('set')
  })
})
