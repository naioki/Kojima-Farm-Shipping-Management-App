/**
 * AI相談窓口の安全装置と朝のブリーフィング（純関数・DB非依存）。
 *
 * - sanitizeProposals: AI が返した「実行ボタン」を、そのまま画面に出さない。
 *   ① 形式チェック（zod）に通らない提案は捨てる
 *   ② その人が実行できない提案は出さない（スタッフに設定変更や管理画面への移動を出さない）
 *   ③ 変えてよい設定キー・移動先を許可リストで限定する（AIの誤り・指示の混入対策）
 * - buildBriefing: 開いた瞬間に「今日の要点」を、AI を呼ばずに実データから組み立てる（速い・正確）。
 */
import { conciergeActionSchema, type ConciergeAction, type ConciergeResponse } from './schema'

export type Role = 'admin' | 'staff'

/** AI が変更を提案してよい設定（設定画面の「現場スタッフに任せること」＋自動承認・通知） */
export const CONCIERGE_SETTING_KEYS = new Set([
  'STAFF_CAN_OCR',
  'STAFF_CAN_CREATE_ORDER',
  'STAFF_CAN_APPROVE',
  'STAFF_CAN_PRINT_DOCS',
  'STAFF_CAN_REPORT_SPEC',
  'AUTO_APPROVE_ENABLED',
  'NOTIFY_LINEWORKS_ENABLED',
])

/** スタッフが実行できない操作（/api/settings は管理者専用。出しても押すと失敗するだけなので出さない） */
const ADMIN_ONLY_TYPES = new Set<ConciergeAction['type']>(['toggle_setting'])

export function sanitizeProposals(raw: unknown, role: Role): ConciergeAction[] {
  if (!Array.isArray(raw)) return []
  const out: ConciergeAction[] = []
  for (const item of raw.slice(0, 6)) {
    const parsed = conciergeActionSchema.safeParse(item)
    if (!parsed.success) continue
    const a = parsed.data
    if (role !== 'admin' && ADMIN_ONLY_TYPES.has(a.type)) continue
    if (a.type === 'navigate') {
      const href = a.payload.href
      // アプリ内の相対パスのみ（外部サイト・javascript: 等は不可）
      if (!href.startsWith('/') || href.startsWith('//')) continue
      if (role !== 'admin' && href.startsWith('/admin')) continue
    }
    if (a.type === 'toggle_setting') {
      const entries = a.payload.entries.filter(
        (e) => CONCIERGE_SETTING_KEYS.has(e.key) && (e.value === 'on' || e.value === 'off'),
      )
      if (entries.length === 0) continue
      out.push({ ...a, payload: { entries } })
      continue
    }
    out.push(a)
  }
  return out
}

/** 会話の返答文から JSON を取り出す（```json ... ``` や前後の文章を許容） */
export function parseLooseJson(text: string): unknown {
  const t = text.trim()
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = fenced ? fenced[1]! : t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)
  try {
    return JSON.parse(candidate)
  } catch {
    return null
  }
}

export interface BriefingInput {
  role: Role
  deliveryDate: string
  dateLabel: string
  notStarted: number
  packed: number
  shipped: number
  packsLeft: number
  pendingApprovals: number
  failedReceipts: number
}

export function buildBriefing(b: BriefingInput): ConciergeResponse {
  const lines: string[] = []
  const proposals: ConciergeAction[] = []
  const total = b.notStarted + b.packed + b.shipped

  if (total === 0) {
    lines.push(`📦 ${b.dateLabel}納品分の注文は、まだありません。`)
  } else if (b.notStarted + b.packed === 0) {
    lines.push(`✅ ${b.dateLabel}納品分は ${total}件すべて出荷済みです。おつかれさまでした！`)
  } else {
    lines.push(
      `📦 ${b.dateLabel}納品分: 残り ${b.notStarted + b.packed}件（未着手 ${b.notStarted}・パック済 ${b.packed}）／出荷済 ${b.shipped}件。残り ${b.packsLeft}パック。`,
    )
    proposals.push({
      type: 'navigate',
      title: '収穫・パックボードを開く',
      summary: `${b.dateLabel}納品分の残りを確認します`,
      payload: { href: `/field/shipments?date=${b.deliveryDate}`, button_label: '📦 パックボードへ' },
    })
  }

  if (b.role === 'admin') {
    if (b.pendingApprovals > 0) {
      lines.push(`📝 承認待ちの注文が ${b.pendingApprovals}件あります。`)
      proposals.push({
        type: 'navigate',
        title: '承認待ちを開く',
        summary: '原本と見比べて承認します',
        payload: { href: '/admin/approvals', button_label: `📝 承認待ち ${b.pendingApprovals}件へ` },
      })
    }
    if (b.failedReceipts > 0) {
      lines.push(`⚠️ 読み取り失敗・取引先不明の受信が ${b.failedReceipts}件あります。`)
      proposals.push({
        type: 'navigate',
        title: '受信ボックスを開く',
        summary: '読み取りに失敗したFAX・メールを直します',
        payload: { href: '/admin/inbox?filter=review', button_label: `⚠️ 読み取り失敗 ${b.failedReceipts}件へ` },
      })
    }
  } else if (b.pendingApprovals > 0) {
    lines.push(`📝 確認待ちの注文が ${b.pendingApprovals}件あります（承認は管理者が行います）。`)
  }

  return {
    reply: `今日の要点です🌱\n${lines.join('\n')}\n\n知りたいこと・やりたいことを、ふつうの言葉で話しかけてください。`,
    proposals,
    followUpSuggestions:
      b.role === 'admin'
        ? ['今月の売上を取引先別に教えて', '先週と比べて今週の注文はどう？', `${b.dateLabel}の注文を取引先ごとに教えて`]
        : [`${b.dateLabel}の注文を取引先ごとに教えて`, '何が終わっていない？', '明日 和郷園に青梗菜20箱追加して'],
  }
}
