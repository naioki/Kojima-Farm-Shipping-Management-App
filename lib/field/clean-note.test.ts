import { describe, expect, it } from 'vitest'
import { extractActionableNote } from './clean-note'

describe('extractActionableNote', () => {
  it('AIメタ情報（伝票No・規格・数量表記・容器・箱数）を除外し、手書き修正や入数変更のみを残す', () => {
    const raw = `伝票No: 2126
入数変更です。
規格:200g (入数30) / 数量表記:総数150点（5ケース＋端数0点） / 容器:小コン / 箱数:5箱 / 手書き修正（150点） / 【要返答】入数変更です。`
    expect(extractActionableNote(raw)).toBe('入数変更です。 / 手書き修正（150点）')
  })

  it('純粋なメタ情報のみの場合は空文字を返す', () => {
    const raw = `伝票No: 3339
規格:2〜3株 / 数量表記:総数494点（24ケース＋端数14点） / 容器:青コン / 箱数:25箱`
    expect(extractActionableNote(raw)).toBe('')
  })

  it('現場の手動メモ（空コンテナ持参など）はそのまま残す', () => {
    expect(extractActionableNote('空コンテナ20個持参 / 手前に積むこと')).toBe(
      '空コンテナ20個持参 / 手前に積むこと',
    )
  })
})
