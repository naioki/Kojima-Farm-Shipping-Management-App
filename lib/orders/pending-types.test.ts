import { describe, it, expect } from 'vitest'
import {
  resolvePendingDestination,
  extractDestinationHint,
  quantityAnomalyFor,
  itemsMissingPack,
  type DestinationCandidate,
} from './pending-types'

const wagoDests: DestinationCandidate[] = [
  { id: 'd-iwatsuki', code: 'パルシステム岩槻', full_name: 'パルシステム 岩槻センター', aliases: ['岩槻'] },
  { id: 'd-noda', code: 'パルシステム野田', full_name: 'パルシステム 野田センター', aliases: [] },
]

describe('承認待ちの納入先判定（承認APIと同じ規則）', () => {
  it('登録済みの納入先があればそれで確定', () => {
    expect(
      resolvePendingDestination({ destinationId: 'x', destinations: wagoDests, noteText: null, productNames: [] }),
    ).toEqual({ destinationId: 'x', needsDestination: false })
  })

  it('取引先に納入先が無ければ判定不要', () => {
    expect(
      resolvePendingDestination({ destinationId: null, destinations: [], noteText: '納入先: どこか', productNames: [] }),
    ).toEqual({ destinationId: null, needsDestination: false })
  })

  it('納入先が1件だけならその1件（承認時に自動で付く）', () => {
    expect(
      resolvePendingDestination({ destinationId: null, destinations: [wagoDests[0]!], noteText: null, productNames: [] }),
    ).toEqual({ destinationId: 'd-iwatsuki', needsDestination: false })
  })

  it('メモにマスタの名前があれば確定（全角半角・ひらがなカタカナの違いは吸収）', () => {
    expect(
      resolvePendingDestination({
        destinationId: null,
        destinations: wagoDests,
        noteText: '納入先(OCR): ﾊﾟﾙｼｽﾃﾑ野田',
        productNames: ['青梗菜'],
      }).destinationId,
    ).toBe('d-noda')
  })

  it('メモの文字がマスタと照合できなければ「未定」（メモがあるだけで確定扱いにしない）', () => {
    expect(
      resolvePendingDestination({
        destinationId: null,
        destinations: wagoDests,
        noteText: '納入先(OCR): パルシステム 浦和',
        productNames: ['青梗菜'],
      }),
    ).toEqual({ destinationId: null, needsDestination: true })
  })

  it('2文字以下の別名では吸収しない（誤吸収防止）', () => {
    const dests: DestinationCandidate[] = [
      { id: 'a', code: null, full_name: 'ヨーク 東道野辺', aliases: ['東'] },
      { id: 'b', code: null, full_name: 'ヨーク 五香', aliases: [] },
    ]
    expect(
      resolvePendingDestination({ destinationId: null, destinations: dests, noteText: '東京行き', productNames: [] }),
    ).toEqual({ destinationId: null, needsDestination: true })
  })

  it('「納入先を指定しない」取引先は未定でも止めない', () => {
    expect(
      resolvePendingDestination({
        destinationId: null,
        destinations: wagoDests,
        noteText: null,
        productNames: [],
        skipsGate: true,
      }),
    ).toEqual({ destinationId: null, needsDestination: false })
  })
})

describe('メモの納入先の文字（参考表示）', () => {
  it('「納入先(OCR): ○○」と【納入先：○○】を取り出す', () => {
    expect(extractDestinationHint('納入先(OCR): パルシステム 岩槻\n伝票No 12')).toBe('パルシステム 岩槻')
    expect(extractDestinationHint('特記【お届け先：五香】')).toBe('五香')
    expect(extractDestinationHint('特記事項なし')).toBeNull()
    expect(extractDestinationHint(null)).toBeNull()
  })
})

describe('画面で数量を直したあとの「いつもと違う」判定', () => {
  it('いつも30前後なら 300 は多すぎ、8 は少なすぎ、40 は普通', () => {
    expect(quantityAnomalyFor(300, 30)).toBe('high')
    expect(quantityAnomalyFor(8, 30)).toBe('low')
    expect(quantityAnomalyFor(40, 30)).toBeNull()
  })
  it('いつもの数量が無ければ判定しない', () => {
    expect(quantityAnomalyFor(300, null)).toBeNull()
  })
})

describe('荷姿の選び忘れ', () => {
  it('荷姿の登録がある品目で未選択のものだけを全部返す', () => {
    expect(
      itemsMissingPack([
        { productName: '青梗菜', packConfigId: null, packConfigOptions: [{ id: 'p', label: '20入' }] },
        { productName: '春菊', packConfigId: null, packConfigOptions: [{ id: 'q', label: '20入' }] },
        { productName: 'ほうれん草', packConfigId: 'r', packConfigOptions: [{ id: 'r', label: '20入' }] },
        { productName: '小松菜', packConfigId: null, packConfigOptions: [] },
      ]),
    ).toEqual(['青梗菜', '春菊'])
  })
})
