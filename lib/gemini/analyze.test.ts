import { describe, it, expect } from 'vitest'
import {
  verifyAndNormalizeItem,
  buildAiRulesSection,
  ordersResultSchema,
  normalizeCustomerAndDestination,
  resolveOrangeFarmShippingDate,
  inferClientHintFromInput,
} from './analyze'
import { mergeSpecTagIntoRuleText } from '@/lib/ai/learning-loop'
import { highModelTryOrder, modelTryOrder, normalizeModelId } from './models'
import {
  generateOrderKey,
  determineContainerType,
  formatQuantityCaseText,
  toGoogleDrivePreviewUrl,
  toGoogleDriveViewUrl,
  determineUnitCount,
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
    expect(res.container_type).toBe('緑コン')
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

  it('自由入力（gemini3.5flashlite / gemini3.8flash 等のハイフン無し手入力含む）から2段階フォールバック順序を正しく構築する', () => {
    expect(normalizeModelId('gemini3.5flashlite')).toBe('gemini-3.5-flash-lite')
    expect(normalizeModelId('gemini3.8flash')).toBe('gemini-3.8-flash')
    const mainOrder = modelTryOrder('gemini3.5flashlite')
    expect(mainOrder[0]).toBe('gemini-3.5-flash-lite')
    expect(mainOrder).toContain('gemini-2.5-flash-lite')
    const highOrder = highModelTryOrder('gemini3.8flash')
    expect(highOrder[0]).toBe('gemini-3.8-flash')
    expect(highOrder).toContain('gemini-2.5-flash')
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

  it('マトリクス表の決定論的バリデータ: 表頭日付 valid_header_dates 外の幻覚スライド注文を安全に除外できるスキーマ構造', () => {
    const rawAiOutput = {
      is_order: true,
      valid_header_dates: ['2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29'],
      orders: [
        {
          customer_name: '農事組合法人 房総食料センター',
          destination_name: 'BOX用',
          delivery_date: '2026-10-24',
          items: [{ raw_name: 'チンゲンサイ', product_name: 'チンゲン菜', quantity: '59', unit: 'P', confidence: 0.95 }],
        },
        {
          customer_name: '農事組合法人 房総食料センター',
          destination_name: 'BOX用',
          delivery_date: '2026-10-30', // 表頭ヘッダーに存在しないスライド幻覚日
          items: [{ raw_name: 'チンゲンサイ', product_name: 'チンゲン菜', quantity: '204', unit: 'P', confidence: 0.8 }],
        },
      ],
    }

    const parsed = ordersResultSchema.parse(rawAiOutput)
    expect(parsed.valid_header_dates).toEqual([
      '2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29',
    ])

    const validDatesSet = new Set(parsed.valid_header_dates)
    const validOrders = parsed.orders.filter(
      (o) => o.delivery_date && validDatesSet.has(o.delivery_date),
    )
    expect(validOrders).toHaveLength(1)
    expect(validOrders[0]?.delivery_date).toBe('2026-10-24')
    expect(validOrders[0]?.items[0]?.quantity).toBe('59')
  })

  it('コンテナ・納品先ごとの動的入数カスケード (小コン30 / 大コン20 / ちばセット入数変更20 / NSK24 / 標準20)', () => {
    // 1. 小コン 30
    expect(determineUnitCount('房総食料センター', '小コン 30')).toBe(30)
    // 2. 大コン 20
    expect(determineUnitCount('房総食料センター', '大コン: 20')).toBe(20)
    // 3. ちばセット（入数変更によりデフォルト20、明示30指定時は30）
    expect(determineUnitCount('房総食料センター', 'ちばセット用')).toBe(20)
    expect(determineUnitCount('房総食料センター', 'ちばセット用 (入数30)')).toBe(30)
    // 4. NSK
    expect(determineUnitCount('株式会社農業総合研究所（NSK）', null)).toBe(24)
    // 5. デフォルトチンゲン菜
    expect(determineUnitCount('一般取引先', null)).toBe(20)
  })

  it('セル単位の約表記単独判定: 約がついたセルのみ confidence が下がり、隣接セルには伝播しない', () => {
    const approxItem = verifyAndNormalizeItem(
      {
        raw_name: 'チンゲン菜',
        product_name: 'チンゲン菜',
        quantity: '約280',
        unit: 'P',
        confidence: 0.95,
      },
      '農事組合法人 房総食料センター',
    )
    expect(approxItem.quantity).toBe('280')
    expect(approxItem.confidence).toBeLessThanOrEqual(0.55)
    expect(approxItem.needs_review_reason).toContain('約表記')

    const exactItem = verifyAndNormalizeItem(
      {
        raw_name: 'チンゲン菜',
        product_name: 'チンゲン菜',
        quantity: '59',
        unit: 'P',
        confidence: 0.95,
      },
      '農事組合法人 房総食料センター',
    )
    expect(exactItem.quantity).toBe('59')
    expect(exactItem.confidence).toBe(0.95)
    expect(exactItem.needs_review_reason).toBeNull()
  })

  it('和郷園の「らでぃっしゅ 岩槻ST」が「パルシステム 岩槻」に誤吸収されず、「茶コン」「らでぃっしゅぼーや 岩槻ST」として独立保持される（マテハン列ヘッダー混入も自動除去）', () => {
    const std = normalizeCustomerAndDestination({
      customerName: '和郷園',
      destinationName: 'らでぃっしゅ 岩槻ST',
      spec: '200g',
    })
    expect(std.customerName).toBe('農事組合法人 和郷園')
    expect(std.destinationName).toBe('らでぃっしゅぼーや 岩槻ST')

    const item = verifyAndNormalizeItem(
      {
        raw_name: 'チンゲン菜',
        product_name: 'チンゲン菜',
        quantity: '220+0 (11-0)',
        unit: 'P',
        confidence: 0.95,
        spec: '200g',
        container_type: 'マテハン', // AIが列ヘッダー名を返した場合でも茶コンに補正される
      },
      std.customerName,
      { destinationName: std.destinationName, deliveryDate: '2026-10-31' },
    )
    expect(item.quantity).toBe('220')
    expect(item.container_type).toBe('茶コン')
    expect(item.order_key).toBe('和郷園|2026-10-31|らでぃっしゅぼーや岩槻st|チンゲン菜|200g')
  })

  it('和郷園の「パルシステム 相模センター」にAIがマテハンを返しても「青コン」に決定論補正される', () => {
    const item = verifyAndNormalizeItem(
      {
        raw_name: 'エコ・チンゲン菜',
        product_name: 'チンゲン菜',
        quantity: '400+0 (20-0)',
        unit: 'P',
        confidence: 0.95,
        spec: '2〜3株',
        container_type: 'マテハン',
      },
      '農事組合法人 和郷園',
      { destinationName: 'パルシステム 相模センター', deliveryDate: '2026-10-31' },
    )
    expect(item.container_type).toBe('青コン')
  })

  it("NSK週間表（5945.jpg）: 社名印字がなく『小島裕美』『4関東顧客向け/5北海道/6関西』『入数24』のみでもNSKと特定し、200gUP/200g・シール有無・買値除去・赤字・欄外内訳を正確に処理する", () => {
    // 1. 4関東顧客向け（200gUP・シールあり・1,440P＝60箱・買値¥78除去）
    const kantoStd = normalizeCustomerAndDestination({
      customerName: "小島裕美",
      destinationName: "4関東顧客向け",
      spec: "200gUP",
      packsPerCase: 24,
    })
    expect(kantoStd.customerName).toBe("株式会社農業総合研究所（NSK）")
    expect(kantoStd.destinationName).toBe("4関東顧客向け")
    expect(kantoStd.spec).toBe("200gUP (入数24)")

    const kantoItem = verifyAndNormalizeItem(
      {
        raw_name: "チンゲンサイ",
        product_name: "チンゲンサイ",
        quantity: "1,440",
        unit: "P",
        confidence: 0.98,
        spec: "200gUP",
        packs_per_case: 24,
        has_seal: true,
        note: "シールあり（生産者11:小島裕美 / 買値¥78）",
      },
      kantoStd.customerName,
      { destinationName: kantoStd.destinationName, deliveryDate: "2026-11-03" },
    )
    expect(kantoItem.quantity).toBe("1440")
    expect(kantoItem.cases).toBe(60)
    expect(kantoItem.spec).toBe("200gUP (入数24)")
    expect(kantoItem.has_seal).toBe(true)
    expect(kantoItem.note).not.toContain("買値")
    expect(kantoItem.note).not.toContain("78")

    // 2. 5北海道（200g・シールなし・720P＝30箱・赤字記載・買値¥75除去）
    const hokkaidoStd = normalizeCustomerAndDestination({
      customerName: null,
      destinationName: "5北海道",
      spec: "200g",
      packsPerCase: 24,
    })
    expect(hokkaidoStd.customerName).toBe("株式会社農業総合研究所（NSK）")
    expect(hokkaidoStd.destinationName).toBe("5北海道")
    expect(hokkaidoStd.spec).toBe("200g (入数24)")

    const hokkaidoItem = verifyAndNormalizeItem(
      {
        raw_name: "チンゲンサイ",
        product_name: "チンゲンサイ",
        quantity: "720",
        unit: "P",
        confidence: 0.95,
        spec: "200g",
        packs_per_case: 24,
        has_seal: false,
        is_handwritten_modified: true,
        note: "※表で赤字記載（変更箇所） / 買値¥75",
      },
      hokkaidoStd.customerName,
      { destinationName: hokkaidoStd.destinationName, deliveryDate: "2026-11-02" },
    )
    expect(hokkaidoItem.quantity).toBe("720")
    expect(hokkaidoItem.cases).toBe(30)
    expect(hokkaidoItem.spec).toBe("200g (入数24)")
    expect(hokkaidoItem.has_seal).toBe(false)
    expect(hokkaidoItem.seal_text).toBe("シールなし")
    expect(hokkaidoItem.note).toContain("赤字記載")
    expect(hokkaidoItem.note).not.toContain("買値")
    expect(hokkaidoItem.note).not.toContain("75")
  })
})

describe('v5.1.13 Sample (@75 x 2pk), Container, and Card Normalization', () => {
  it('rescues AI @75 x 2pk unit-price multiplication into 2 sample packs (0 cases, 2 remainder)', () => {
    const item = verifyAndNormalizeItem(
      {
        raw_name: 'チンゲン菜 @75 x 2pk',
        product_name: 'チンゲン菜',
        quantity: '150',
        cases: 75,
        packs_per_case: 2,
        unit: 'P',
        confidence: 0.9,
      },
      '農事組合法人 和郷園',
      { destinationName: 'ちばコープ グリンBOXサンプル戸田' },
    )
    expect(item.quantity).toBe('2')
    expect(item.cases).toBe(0)
    expect(item.remainder_packs).toBe(2)
    expect(item.packs_per_case).toBe(20)
    expect(item.has_card).toBe(false)
    expect(item.container_type).toBe('茶コン')
  })

  it('preserves non-Chibacoop sample destinations like 東北サンネット (サンプル)', () => {
    const norm = normalizeCustomerAndDestination({
      customerName: '農事組合法人 和郷園',
      destinationName: '東北サンネット',
      spec: '那須荷上げ 11/4 サンプル依頼書 2pk',
    })
    expect(norm.customerName).toBe('農事組合法人 和郷園')
    expect(norm.destinationName).toContain('東北サンネット')
    expect(norm.destinationName).toContain('サンプル')
    expect(norm.destinationName).not.toContain('ちばコープ')
  })

  it('オレンジファームの着日（木曜・土曜）を水曜・金曜出荷へ決定論的に変換し、マスの数字（50箱・40箱）を×25パック（1250P・1000P）に換算する', () => {
    // 1. 11/5(木)着 → 11/4(水)出荷
    const thuRes = resolveOrangeFarmShippingDate('2026-11-05')
    expect(thuRes.deliveryDate).toBe('2026-11-04')
    expect(thuRes.arrivalNote).toContain('2026-11-05(木)')
    expect(thuRes.arrivalNote).toContain('2026-11-04(水)')

    // 2. 11/7(土)着 → 11/6(金)出荷
    const satRes = resolveOrangeFarmShippingDate('2026-11-07')
    expect(satRes.deliveryDate).toBe('2026-11-06')
    expect(satRes.arrivalNote).toContain('2026-11-07(土)')
    expect(satRes.arrivalNote).toContain('2026-11-06(金)')

    // 3. 既にAI側で水曜（2026-11-04）に変換済みの場合は二重引き算しない
    const wedRes = resolveOrangeFarmShippingDate('2026-11-04')
    expect(wedRes.deliveryDate).toBe('2026-11-04')
    expect(wedRes.arrivalNote).toBeNull()

    // 4. マスの数字 50（コンテナ数）がそのまま quantity:"50" で来ても 50箱×25入＝1250P に正規化される
    const item50 = verifyAndNormalizeItem(
      {
        raw_name: 'チンゲン菜',
        product_name: 'チンゲン菜',
        quantity: '50',
        unit: 'P',
        confidence: 0.95,
        spec: '25入',
        packs_per_case: 25,
        is_handwritten_modified: true,
        note: '手書きで 0→50 に修正あり',
      },
      '株式会社オレンジファーム',
      { deliveryDate: '2026-11-04' },
    )
    expect(item50.packs_per_case).toBe(25)
    expect(item50.cases).toBe(50)
    expect(item50.box_count).toBe(50)
    expect(item50.quantity).toBe('1250')
    expect(item50.spec).toBe('25入 (入数25)')
    expect(item50.container_type).toBe('緑コン')
    expect(item50.note).toContain('50')

    // 5. AIが既に 50×25=1250 として返した場合も二重掛け算せず 50箱＝1250P を維持する
    const item1250 = verifyAndNormalizeItem(
      {
        raw_name: 'チンゲン菜',
        product_name: 'チンゲン菜',
        quantity: '1250',
        cases: 50,
        box_count: 50,
        unit: 'P',
        confidence: 0.95,
        spec: '25入',
        packs_per_case: 25,
        is_case_input: true,
        is_handwritten_modified: true,
      },
      '株式会社オレンジファーム',
      { deliveryDate: '2026-11-04' },
    )
    expect(item1250.cases).toBe(50)
    expect(item1250.box_count).toBe(50)
    expect(item1250.quantity).toBe('1250')
  })

  it('省トークン自動絞り込み（inferClientHintFromInput）と超圧縮タグ更新（mergeSpecTagIntoRuleText）が正しく動作する', () => {
    expect(inferClientHintFromInput('オレンジファーム 明日 50箱')).toBe('株式会社オレンジファーム')
    expect(inferClientHintFromInput('株式会社勘兵衛 イオンタウン向け 5 C/S')).toBe('株式会社勘兵衛')
    expect(inferClientHintFromInput('和郷園と勘兵衛の両方')).toBeNull()
    expect(inferClientHintFromInput('')).toBeNull()

    const initialRule = '発信元オレンジファーム。容器は『青コン』。[標準仕様: 25入 / 青コン / シール有 / カード無]'
    const afterContainer = mergeSpecTagIntoRuleText(initialRule, 'container', '緑コン')
    expect(afterContainer).toContain('容器は『緑コン』')
    expect(afterContainer).toContain('[標準仕様: 25入 / 緑コン / シール有 / カード無]')

    const afterSeal = mergeSpecTagIntoRuleText(afterContainer, 'has_seal', 'シールなし')
    expect(afterSeal).toContain('[標準仕様: 25入 / 緑コン / シール無 / カード無]')
  })
})
