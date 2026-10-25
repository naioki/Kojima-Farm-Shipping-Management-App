import { describe, expect, it } from 'vitest'
import { extractActionableNote, extractChangeDiffBadge } from './clean-note'
import { collapseStrikethroughSplitOrders, type ParsedOrder } from '@/lib/gemini/analyze'

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

describe('extractChangeDiffBadge', () => {
  it('旧数値→新数値の変更履歴バッジを抽出する', () => {
    expect(extractChangeDiffBadge('手書き修正（165→150P） / 入数変更です。')).toBe('165→150P')
    expect(extractChangeDiffBadge('数量変更:10/25 15:41 204→201P')).toBe('204→201P')
  })

  it('変更表記がない場合は null を返す', () => {
    expect(extractChangeDiffBadge('空コンテナ20個持参')).toBeNull()
  })
})

describe('collapseStrikethroughSplitOrders', () => {
  it('同一出荷日で二重線旧数値（約表記）と手書き確定値が2列に分裂した場合、手書き確定値1件に統合する', () => {
    const splitOrders: ParsedOrder[] = [
      {
        customer_name: '農事組合法人 房総食料センター',
        destination_name: 'BOX用',
        delivery_date: '2026-10-27',
        slip_no: '2126',
        note: null,
        items: [
          {
            raw_name: 'チンゲン菜',
            product_name: 'チンゲン菜',
            quantity: '170',
            unit: 'P',
            confidence: 0.5,
            is_approximate: true,
            is_handwritten_modified: false,
            needs_review_reason: '約表記（暫定値・要確認）',
          },
        ],
      },
      {
        customer_name: '農事組合法人 房総食料センター',
        destination_name: 'ちばセット用',
        delivery_date: '2026-10-27',
        slip_no: '2126',
        note: null,
        items: [
          {
            raw_name: 'チンゲン菜',
            product_name: 'チンゲン菜',
            quantity: '157',
            unit: 'P',
            confidence: 0.95,
            is_approximate: false,
            is_handwritten_modified: true,
            note: '手書き修正（157点）',
          },
        ],
      },
    ]

    const result = collapseStrikethroughSplitOrders(splitOrders)
    expect(result).toHaveLength(1)
    expect(result[0]?.destination_name).toBe('ちばセット用')
    expect(result[0]?.items[0]?.quantity).toBe('157')
    expect(result[0]?.items[0]?.note).toContain('170→157P')
  })
})
