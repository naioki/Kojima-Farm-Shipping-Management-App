import { describe, it, expect } from 'vitest'
import { splitPlacementClasses } from '@/components/ui/Input'

describe('Input の配置クラスの振り分け', () => {
  it('グリッド・フレックスでの置き方はラッパーへ、見た目は input へ', () => {
    expect(splitPlacementClasses('col-span-5 h-9 text-xs')).toEqual({ placement: 'col-span-5', rest: 'h-9 text-xs' })
    expect(splitPlacementClasses('bg-bg-card flex-1')).toEqual({ placement: 'flex-1', rest: 'bg-bg-card' })
    expect(splitPlacementClasses('sm:col-span-2 w-24')).toEqual({ placement: 'sm:col-span-2', rest: 'w-24' })
    expect(splitPlacementClasses(undefined)).toEqual({ placement: '', rest: '' })
  })
})
