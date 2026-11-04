import { describe, it, expect } from 'vitest'
import {
  buildConciergeSystemPrompt,
  buildDeterministicConciergeResponse,
  type ConciergeContextData,
} from '@/lib/concierge/schema'

const mockCtx: ConciergeContextData = {
  todayStr: '2026-11-04',
  tomorrowStr: '2026-11-05',
  customers: [
    { id: 'c-wagou', name: '農事組合法人 和郷園' },
    { id: 'c-orange', name: 'オレンジファーム', aliases: ['株式会社オレンジファーム'] },
  ],
  destinations: [
    { id: 'd-iwatsuki', customer_id: 'c-wagou', code: 'パルシステム岩槻', full_name: 'パルシステム岩槻' },
  ],
  products: [
    { id: 'p-chingen', name: '青梗菜', unit: 'パック', category: '葉物', container_capacity: 20 },
  ],
  currentSettings: {
    STAFF_CAN_OCR: 'on',
    STAFF_CAN_CREATE_ORDER: 'on',
    AUTO_APPROVE_ENABLED: 'off',
  },
  tomorrowOrderSummary: [
    {
      customerName: '農事組合法人 和郷園',
      destinationName: 'パルシステム岩槻',
      productName: '青梗菜',
      quantity: 300,
      packsPerCase: 20,
    },
  ],
}

describe('AI総合相談窓口（コンシェルジュ）プロンプト＆決定論エンジン', () => {
  it('アプリの仕様・前日パック原則・やさしい言葉遣いルールをシステムプロンプトに含む', () => {
    const prompt = buildConciergeSystemPrompt(mockCtx)
    expect(prompt).toContain('前日収穫・前日パックの鉄則')
    expect(prompt).toContain('専門用語を一切使わず')
    expect(prompt).toContain('STAFF_CAN_OCR')
    expect(prompt).toContain('農事組合法人 和郷園')
  })

  it('「スタッフの設定を全部オンにして」で5つの権限トグルを一括ONにする提案を返す', () => {
    const res = buildDeterministicConciergeResponse('スタッフの設定を全部オンにして', mockCtx)
    expect(res).not.toBeNull()
    expect(res?.proposals[0]?.type).toBe('toggle_setting')
    if (res?.proposals[0]?.type === 'toggle_setting') {
      expect(res.proposals[0].payload.entries).toHaveLength(5)
      expect(res.proposals[0].payload.entries.every((e) => e.value === 'on')).toBe(true)
    }
  })

  it('「新しい品目で『春菊』を追加して」で品目作成アクションを返す', () => {
    const res = buildDeterministicConciergeResponse('新しい品目で「春菊」を追加して', mockCtx)
    expect(res).not.toBeNull()
    expect(res?.proposals[0]?.type).toBe('create_product')
    if (res?.proposals[0]?.type === 'create_product') {
      expect(res.proposals[0].payload.name).toBe('春菊')
    }
  })

  it('「オレンジファームの入数を20入りに変えて」でルール更新アクションを返す', () => {
    const res = buildDeterministicConciergeResponse('オレンジファームの入数を20入りに変えて', mockCtx)
    expect(res).not.toBeNull()
    expect(res?.proposals[0]?.type).toBe('update_customer_rule')
    if (res?.proposals[0]?.type === 'update_customer_rule') {
      expect(res.proposals[0].payload.customer_id).toBe('c-orange')
      expect(res.proposals[0].payload.packs_per_case).toBe(20)
    }
  })

  it('「明日 和郷園に青梗菜 20箱追加して」で注文追加アクションを返す', () => {
    const res = buildDeterministicConciergeResponse('明日 和郷園に青梗菜 20箱追加して', mockCtx)
    expect(res).not.toBeNull()
    expect(res?.proposals[0]?.type).toBe('add_shipment')
    if (res?.proposals[0]?.type === 'add_shipment') {
      expect(res.proposals[0].payload.customer_id).toBe('c-wagou')
      expect(res.proposals[0].payload.quantity_raw).toBe('20c')
    }
  })
})
