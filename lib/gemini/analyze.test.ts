import { describe, it, expect } from 'vitest'
import { verifyAndNormalizeItem, buildAiRulesSection } from './analyze'
import { modelTryOrder } from './models'
import {
  generateOrderKey,
  determineContainerType,
  formatQuantityCaseText,
  toGoogleDrivePreviewUrl,
  toGoogleDriveViewUrl,
} from '@/lib/pipeline/schemas'
import type { AiRule } from '@/types/database'

describe('ARCHITECTURE.md Ver 4.1 & 指示書 v2.3 チンゲン菜検算・正規化テスト', () => {
  it('和郷園のマトリクス表記 "300+0 (15-0)" から先頭数値 300P・15ケース・入数20・15箱・固定書式・注文キーを算出する', () => {
    const res = verifyAndNormalizeItem(
      {
        raw_name: '青梗菜',
        product_name: '青梗菜',
        quantity: '300+0 (15-0)',
        unit: 'P',
        confidence: 0.95,
        spec: '2~3株 (入数20)',
      },
      '農事組合法人 和郷園',
      { destinationName: 'パルシステム 岩槻', deliveryDate: '2026-10-16' },
    )
    expect(res.product_name).toBe('チンゲン菜')
    expect(res.quantity).toBe('300')
    expect(res.packs_per_case).toBe(20)
    expect(res.cases).toBe(15)
    expect(res.remainder_packs).toBe(0)
    expect(res.box_count).toBe(15)
    expect(res.container_type).toBe('青コン')
    expect(res.quantity_case_text).toBe('総数300点（15ケース＋端数0点）')
    expect(res.order_key).toBe('和郷園|2026-10-16|パルシステム岩槻|チンゲン菜|2〜3株(入数20)')
  })

  it('和郷園のOCR文字潰れ（「口一天」「列述(戸田)」）を「ちばコープ グリーンボックス(戸田)」「茶コン」に自動補正する', () => {
    const res = verifyAndNormalizeItem(
      {
        raw_name: 'チンゲンサイ',
        product_name: 'チンゲンサイ',
        quantity: '56+0 (2-16)',
        unit: 'P',
        confidence: 0.9,
      },
      '和郷園',
      { destinationName: '口一天(戸田)', deliveryDate: '2026-10-16' },
    )
    expect(res.quantity).toBe('56')
    expect(res.cases).toBe(2)
    expect(res.remainder_packs).toBe(16)
    expect(res.box_count).toBe(3)
    expect(res.container_type).toBe('茶コン')
    expect(res.quantity_case_text).toBe('総数56点（2ケース＋端数16点）')
    expect(res.order_key).toBe('和郷園|2026-10-16|ちばコープグリーンボックス(戸田)|チンゲン菜|2〜3株(入数20)')
  })

  it('株式会社勘兵衛のケース表記（2 C/S）を入数20で総40P・2箱に自動換算する', () => {
    const res = verifyAndNormalizeItem(
      {
        raw_name: 'チンゲン菜',
        product_name: 'チンゲン菜',
        quantity: '2',
        unit: 'C/S',
        confidence: 0.92,
      },
      '株式会社勘兵衛',
      { destinationName: 'イオンタウン向け', deliveryDate: '2026-10-16' },
    )
    expect(res.quantity).toBe('40')
    expect(res.packs_per_case).toBe(20)
    expect(res.cases).toBe(2)
    expect(res.remainder_packs).toBe(0)
    expect(res.box_count).toBe(2)
    expect(res.quantity_case_text).toBe('総数40点（2ケース＋端数0点）')
  })

  it('農業総合研究所（NSK）は入数24・農業総研専用折りたたみコンテナでケース数と端数を自動換算し、端数切り上げで箱数を算出する', () => {
    const res = verifyAndNormalizeItem(
      {
        raw_name: 'チンゲンサイ',
        product_name: 'チンゲン菜',
        quantity: '50',
        unit: 'P',
        confidence: 0.95,
      },
      '株式会社農業総合研究所（NSK）',
      { destinationName: '4関東顧客向け', deliveryDate: '2026-10-16' },
    )
    expect(res.packs_per_case).toBe(24)
    expect(res.cases).toBe(2)
    expect(res.remainder_packs).toBe(2)
    expect(res.box_count).toBe(3)
    expect(res.container_type).toBe('農業総研専用折りたたみコンテナ')
    expect(res.quantity_case_text).toBe('総数50点（2ケース＋端数2点）')
  })

  it('房総食料センターの「約 80」表記は確信度を0.55以下に引き下げて要確認理由を付与する', () => {
    const res = verifyAndNormalizeItem(
      {
        raw_name: 'チンゲン菜',
        product_name: 'チンゲン菜',
        quantity: '約 80',
        unit: 'P',
        confidence: 0.9,
      },
      '農事組合法人 房総食料センター',
    )
    expect(res.quantity).toBe('80')
    expect(res.confidence).toBeLessThanOrEqual(0.55)
    expect(res.needs_review_reason).toContain('約表記')
  })

  it('Kojima-FAX の Google Drive URL (/view) を埋め込みプレビュー URL (/preview) に変換する', () => {
    const viewUrl = 'https://drive.google.com/file/d/1yIM9vKZJAWOB0hiiYHjLG1Fo30D9RrIu/view?usp=drivesdk'
    expect(toGoogleDrivePreviewUrl(viewUrl)).toBe(
      'https://drive.google.com/file/d/1yIM9vKZJAWOB0hiiYHjLG1Fo30D9RrIu/preview',
    )
    expect(toGoogleDriveViewUrl('drive:1yIM9vKZJAWOB0hiiYHjLG1Fo30D9RrIu')).toBe(
      'https://drive.google.com/file/d/1yIM9vKZJAWOB0hiiYHjLG1Fo30D9RrIu/view',
    )
  })

  it('generateOrderKey と determineContainerType と formatQuantityCaseText が ARCHITECTURE.md 通りに動作する', () => {
    expect(
      generateOrderKey({
        clientName: '農事組合法人 和郷園',
        deliveryDate: '2026-10-14',
        destination: 'パルシステム 岩槻',
        itemName: '青梗菜',
        spec: '2~3株 (入数２０)',
      }),
    ).toBe('和郷園|2026-10-14|パルシステム岩槻|チンゲン菜|2〜3株(入数20)')
    expect(determineContainerType('農事組合法人 和郷園', 'パルシステム 岩槻')).toBe('青コン')
    expect(determineContainerType('農事組合法人 和郷園', 'ちばコープ 戸田')).toBe('茶コン')
    expect(determineContainerType('株式会社農業総合研究所', '関東')).toBe('農業総研専用折りたたみコンテナ')
    expect(formatQuantityCaseText(300, 15, 0)).toBe('総数300点（15ケース＋端数0点）')
  })

  it('自由入力・カンマ区切りの GEMINI_MODEL 指定からフォールバック順序を正しく構築する', () => {
    const order = modelTryOrder('gemini-2.5-pro, gemini-3-flash-preview')
    expect(order[0]).toBe('gemini-2.5-pro')
    expect(order[1]).toBe('gemini-3-flash-preview')
    expect(order).toContain('gemini-2.5-flash')
  })

  it('buildAiRulesSection が取引先ごとにルールを整形する', () => {
    const rules: AiRule[] = [
      {
        id: '1',
        client_name: '株式会社勘兵衛',
        rule_text: 'ケース数×20を総パック数とする',
        is_active: true,
        priority: 1,
        category: 'parsing',
        source: 'seed_v2.3',
        created_at: '',
        updated_at: '',
      },
    ]
    const section = buildAiRulesSection(rules)
    expect(section).toContain('株式会社勘兵衛')
    expect(section).toContain('ケース数×20を総パック数とする')
  })
})
