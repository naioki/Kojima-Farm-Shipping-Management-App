import { describe, it, expect } from 'vitest'
import { guideStorageKey, SHIPMENTS_TOUR } from './tours'

describe('guideStorageKey', () => {
  it('key と version から一意なlocalStorageキーを生成する', () => {
    expect(guideStorageKey({ key: 'shipments', version: 1 })).toBe('guide:shipments:v1')
  })

  it('version を上げるとキーが変わる（再表示のトリガーになる）', () => {
    const v1 = guideStorageKey({ key: 'shipments', version: 1 })
    const v2 = guideStorageKey({ key: 'shipments', version: 2 })
    expect(v1).not.toBe(v2)
  })

  it('key が違えばキーも違う（ツアー同士が衝突しない）', () => {
    expect(guideStorageKey({ key: 'shipments', version: 1 })).not.toBe(
      guideStorageKey({ key: 'order-box', version: 1 }),
    )
  })
})

describe('SHIPMENTS_TOUR', () => {
  it('ステップが1つ以上あり、target が重複しない', () => {
    expect(SHIPMENTS_TOUR.steps.length).toBeGreaterThan(0)
    const targets = SHIPMENTS_TOUR.steps.map((s) => s.target)
    expect(new Set(targets).size).toBe(targets.length)
  })
})
