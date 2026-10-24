import { describe, it, expect } from 'vitest'
import { buildClarificationQuestions } from '@/lib/orders/clarifications'
import type { ParsedOrder } from '@/lib/gemini/analyze'

describe('buildClarificationQuestions', () => {
  const dummyCustomers = [
    { id: 'cust-1', name: '株式会社 勘兵衛' },
    { id: 'cust-2', name: '農事組合法人 和郷園' },
  ]

  const dummyDestinations = [
    { id: 'dest-1', customer_id: 'cust-1', code: 'イオン幕張', full_name: 'イオンタウン幕張店' },
    { id: 'dest-2', customer_id: 'cust-2', code: '岩槻', full_name: 'パルシステム岩槻センター' },
  ]

  const dummyProducts = [
    { id: 'prod-1', name: 'チンゲン菜' },
    { id: 'prod-2', name: '小松菜' },
  ]

  it('日付が未指定または過去日の場合に【出荷日 (When)】質問カードが生成されること', () => {
    const orders: ParsedOrder[] = [
      {
        customer_name: '株式会社 勘兵衛',
        destination_name: 'イオンタウン幕張店',
        delivery_date: null,
        items: [
          {
            raw_name: 'チンゲン菜',
            product_name: 'チンゲン菜',
            quantity: '100',
            unit: 'P',
            confidence: 0.95,
          },
        ],
      },
    ]

    const questions = buildClarificationQuestions(orders, dummyCustomers, dummyDestinations, dummyProducts)
    const dateQuestion = questions.find((q) => q.category === 'date')

    expect(dateQuestion).toBeDefined()
    expect(dateQuestion?.title).toBe('出荷日の確認')
    expect(dateQuestion?.options.some((opt) => opt.label.includes('明日'))).toBe(true)
  })

  it('マスタ未登録の納入先がある場合に【未登録納入先 (Where)】質問カードが生成され、新規登録オプションが含まれること', () => {
    const orders: ParsedOrder[] = [
      {
        customer_name: '株式会社 勘兵衛',
        destination_name: 'イオン新浦安店', // 未登録店舗
        delivery_date: '2026-10-25',
        items: [
          {
            raw_name: 'チンゲン菜',
            product_name: 'チンゲン菜',
            quantity: '100',
            unit: 'P',
            confidence: 0.95,
          },
        ],
      },
    ]

    const questions = buildClarificationQuestions(orders, dummyCustomers, dummyDestinations, dummyProducts)
    const destQuestion = questions.find((q) => q.category === 'destination')

    expect(destQuestion).toBeDefined()
    expect(destQuestion?.reason).toContain('イオン新浦安店')
    const newMasterOpt = destQuestion?.options.find((opt) => opt.isNewMaster)
    expect(newMasterOpt).toBeDefined()
    expect(newMasterOpt?.label).toContain('＋「イオン新浦安店」を新規納入先として登録')
    expect(newMasterOpt?.newMasterPayload?.customerId).toBe('cust-1')
  })

  it('数量のかすれや「約」表記がある場合に【数量・単位 (How many)】質問カードが生成されること', () => {
    const orders: ParsedOrder[] = [
      {
        customer_name: '株式会社 勘兵衛',
        destination_name: 'イオンタウン幕張店',
        delivery_date: '2026-10-25',
        items: [
          {
            raw_name: 'チンゲン菜 15c2',
            product_name: 'チンゲン菜',
            quantity: '300',
            cases: 15,
            packs_per_case: 20,
            unit: 'P',
            confidence: 0.6,
            needs_review_reason: '手書き「15c2」のケース数解釈要確認',
          },
        ],
      },
    ]

    const questions = buildClarificationQuestions(orders, dummyCustomers, dummyDestinations, dummyProducts)
    const qtyQuestion = questions.find((q) => q.category === 'quantity')

    expect(qtyQuestion).toBeDefined()
    expect(qtyQuestion?.title).toContain('数量・単位の確認')
    expect(qtyQuestion?.reason).toContain('手書き「15c2」のケース数解釈要確認')
    expect(qtyQuestion?.options.some((opt) => opt.label.includes('15ケース'))).toBe(true)
    expect(qtyQuestion?.options.some((opt) => opt.label.includes('300パック'))).toBe(true)
  })

  it('手書き質問事項（要返答）がある場合に【特記事項 (Notes)】質問カードが生成されること', () => {
    const orders: ParsedOrder[] = [
      {
        customer_name: '農事組合法人 和郷園',
        destination_name: 'パルシステム岩槻センター',
        delivery_date: '2026-10-25',
        items: [
          {
            raw_name: 'チンゲン菜',
            product_name: 'チンゲン菜',
            quantity: '200',
            unit: 'P',
            confidence: 0.95,
            has_reply_required: true,
            note: '【要返答】来週の規格確認お願いします',
          },
        ],
      },
    ]

    const questions = buildClarificationQuestions(orders, dummyCustomers, dummyDestinations, dummyProducts)
    const noteQuestion = questions.find((q) => q.category === 'general')

    expect(noteQuestion).toBeDefined()
    expect(noteQuestion?.title).toContain('FAX内の連絡・手書き質問事項')
    expect(noteQuestion?.reason).toContain('来週の規格確認お願いします')
  })
})
