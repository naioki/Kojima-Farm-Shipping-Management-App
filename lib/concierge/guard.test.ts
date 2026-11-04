import { describe, it, expect } from 'vitest'
import { sanitizeProposals, parseLooseJson, buildBriefing } from './guard'

const nav = (href: string) => ({ type: 'navigate', title: 't', summary: 's', payload: { href, button_label: 'b' } })
const toggle = (entries: { key: string; label: string; value: string }[]) => ({
  type: 'toggle_setting',
  title: 't',
  summary: 's',
  payload: { entries },
})

describe('sanitizeProposals（AIの提案の安全装置）', () => {
  it('形式が壊れた提案は捨てる', () => {
    expect(sanitizeProposals([{ type: 'add_shipment', title: 'x' }, nav('/field/shipments')], 'admin')).toHaveLength(1)
    expect(sanitizeProposals('not array', 'admin')).toEqual([])
  })
  it('スタッフには設定変更と管理画面への移動を出さない', () => {
    const raw = [toggle([{ key: 'STAFF_CAN_OCR', label: 'OCR', value: 'on' }]), nav('/admin/settings'), nav('/field/print')]
    const out = sanitizeProposals(raw, 'staff')
    expect(out.map((a) => a.type)).toEqual(['navigate'])
  })
  it('外部サイトや javascript: への移動は出さない', () => {
    expect(sanitizeProposals([nav('https://evil.example'), nav('//evil.example'), nav('javascript:alert(1)')], 'admin')).toEqual([])
  })
  it('許可していない設定キー（合言葉など）や on/off 以外の値は落とす', () => {
    const out = sanitizeProposals(
      [
        toggle([
          { key: 'CRON_SECRET', label: 'x', value: 'abc' },
          { key: 'STAFF_CAN_APPROVE', label: '承認', value: 'on' },
          { key: 'AUTO_APPROVE_ENABLED', label: '自動', value: 'maybe' },
        ]),
      ],
      'admin',
    )
    expect(out).toHaveLength(1)
    expect(out[0]!.type === 'toggle_setting' && out[0]!.payload.entries.map((e) => e.key)).toEqual(['STAFF_CAN_APPROVE'])
  })
})

describe('parseLooseJson', () => {
  it('コードブロックや前後の文章があっても JSON を取り出す', () => {
    expect(parseLooseJson('はい。\n```json\n{"reply":"ok"}\n```')).toEqual({ reply: 'ok' })
    expect(parseLooseJson('結果: {"reply":"ok","proposals":[]} です')).toEqual({ reply: 'ok', proposals: [] })
    expect(parseLooseJson('JSONなし')).toBeNull()
  })
})

describe('buildBriefing（開いた瞬間の今日の要点）', () => {
  const base = { deliveryDate: '2026-11-05', dateLabel: '明日', notStarted: 3, packed: 2, shipped: 5, packsLeft: 120, pendingApprovals: 4, failedReceipts: 1 }
  it('管理者には残り作業・承認待ち・読み取り失敗と、その画面へのボタンを出す', () => {
    const r = buildBriefing({ ...base, role: 'admin' })
    expect(r.reply).toContain('残り 5件')
    expect(r.reply).toContain('承認待ちの注文が 4件')
    expect(r.reply).toContain('読み取り失敗・取引先不明の受信が 1件')
    expect(r.proposals.map((p) => p.type === 'navigate' && p.payload.href)).toEqual([
      '/field/shipments?date=2026-11-05',
      '/admin/approvals',
      '/admin/inbox?filter=review',
    ])
  })
  it('スタッフには管理画面へのボタンを出さない', () => {
    const r = buildBriefing({ ...base, role: 'staff' })
    expect(r.proposals.every((p) => p.type !== 'navigate' || !p.payload.href.startsWith('/admin'))).toBe(true)
  })
  it('全部出荷済みならねぎらう', () => {
    expect(buildBriefing({ ...base, role: 'staff', notStarted: 0, packed: 0 }).reply).toContain('すべて出荷済み')
  })
})
