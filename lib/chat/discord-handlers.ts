import 'server-only'
import {
  listPendingApprovals,
  approveAndPrint,
  reprint,
  ingestEmailsForDate,
  type PendingApprovalView,
  type ConfirmedOrderView,
} from './use-cases'
import { resolveChatActorUserId } from './discord-actor'
import { sendFollowup } from './discord-api'
import { buildCustomId } from './discord-custom-id'
import { jstTodayStr, shiftDateStr } from '@/lib/dates'

/**
 * Discord Interactions のビルダー（同期応答用）と deferred 実行本体（followup 送信）。
 *
 * - 承認は必ず 2E-1 のユースケース層（approveAndPrint / reprint / ingestEmailsForDate）を通す。
 *   ここから DB を直接叩いたり RPC を新設したりしない（抜け道を作らない）。
 * - 重い処理（取込・承認・印刷）は route 側で type:5（deferred）ACK 済み。ここでは結果を
 *   followup webhook で送るだけ。エラーは握りつぶさず利用者向け日本語で followup する。
 */

// Discord Interaction レスポンス型（数値の意味はコメント参照）。
export const RESPONSE = {
  PONG: 1,
  MESSAGE: 4, // CHANNEL_MESSAGE_WITH_SOURCE
  DEFERRED_MESSAGE: 5, // DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE（「考え中…」表示→followup）
  DEFERRED_UPDATE: 6, // DEFERRED_UPDATE_MESSAGE
  MODAL: 9,
} as const

// embed カラー（features.md §9-2: 赤=alert / 黄=warning / 緑=info / 青=中立）。
const COLOR = { alert: 0xd92d20, warning: 0xdc6803, info: 0x16a34a, neutral: 0x3b82f6 } as const

const EPHEMERAL = 64

export interface DiscordResponse {
  type: number
  data?: Record<string, unknown>
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'] as const

/** YYYY-MM-DD → 「07/13(月)」。カレンダー計算（TZ非依存）。 */
export function formatDateLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  const wd = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
  return `${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}(${wd})`
}

// ---------------------------------------------------------------------------
// 同期応答ビルダー（route から直接 return する）
// ---------------------------------------------------------------------------

/** ephemeral（本人のみ表示）のテキスト応答。 */
export function ephemeralMessage(content: string): DiscordResponse {
  return { type: RESPONSE.MESSAGE, data: { content, flags: EPHEMERAL } }
}

/** 通常のテキスト応答。 */
export function textMessage(content: string): DiscordResponse {
  return { type: RESPONSE.MESSAGE, data: { content } }
}

function button(label: string, customId: string, style = 2): Record<string, unknown> {
  return { type: 2, label: label.slice(0, 80), style, custom_id: customId }
}

/** /印刷: 未確定（承認待ち）＋直近確定済み＋メール取込ボタンを1メッセージで返す。 */
export function buildPrintCommandResponse(
  pending: PendingApprovalView[],
  confirmed: ConfirmedOrderView[],
): DiscordResponse {
  const rows: Record<string, unknown>[] = []
  const lines: string[] = []

  if (pending.length > 0) {
    lines.push('📋 **未確定の受注**（タップして確認・承認）')
    // Discord は1行最大5ボタン・1メッセージ最大5行。承認待ちは先頭5件までボタン化。
    const buttons = pending
      .slice(0, 5)
      .map((p) => button(`📋 ${p.customerName}`, buildCustomId('preview', p.orderId), 2))
    rows.push({ type: 1, components: buttons })
  }

  if (confirmed.length > 0) {
    lines.push('🖨️ **確定済みを再印刷**')
    const buttons = confirmed
      .slice(0, 5)
      .map((o) =>
        button(
          `🖨️ ${formatDateLabel(o.deliveryDate)} ${o.lineCount}件`,
          buildCustomId('reprint', o.orderId, o.deliveryDate),
          1,
        ),
      )
    rows.push({ type: 1, components: buttons })
  }

  // メール取込（その日の受信を取り込んで承認待ちを更新）。
  rows.push({ type: 1, components: [button('📥 メールを取込む', buildCustomId('ingest_pick'), 2)] })

  if (pending.length === 0 && confirmed.length === 0) {
    lines.push('📭 承認待ち・確定済みの受注がありません。メール取込を試してください。')
  }

  return {
    type: RESPONSE.MESSAGE,
    data: { content: lines.join('\n'), components: rows },
  }
}

/** preview: 未確定注文1件の明細サマリと blockingReasons を embed 表示し、承認ボタンを出す。 */
export function buildPreviewResponse(order: PendingApprovalView): DiscordResponse {
  const blocked = order.blockingReasons.length > 0
  const descLines = [
    `納品日: **${order.deliveryDate ?? '未確定'}**`,
    '',
    `**明細:**`,
    order.itemsSummary || '（明細なし）',
  ]
  if (blocked) {
    descLines.push('', '⚠️ **承認をブロックしている項目:**')
    for (const r of order.blockingReasons) descLines.push(`・${r}`)
  }

  const buttons = [button('✅ 承認して印刷', buildCustomId('approve', order.orderId), 3)]
  // 納品日/納入先が未確定なら日付選択も出す（承認時に日付を確定できるように）。
  if (blocked) {
    buttons.push(button('📅 日付を選んで承認', buildCustomId('approve_pick', order.orderId), 1))
  }

  return {
    type: RESPONSE.MESSAGE,
    data: {
      embeds: [
        {
          title: `📋 未確定受注: ${order.customerName}`,
          description: descLines.join('\n'),
          color: blocked ? COLOR.warning : COLOR.info,
        },
      ],
      components: [{ type: 1, components: buttons }],
    },
  }
}

/**
 * 日付選択ボタン（今日/明日/明後日 ＋ その他記入）。v4 `_build_date_selector` 相当。
 * onCustomId(date) で各日付ボタンの custom_id を、otherCustomId でモーダル起動ボタンを作る。
 */
export function buildDateSelectorResponse(
  content: string,
  onCustomId: (date: string) => string,
  otherCustomId: string,
): DiscordResponse {
  const today = jstTodayStr()
  const labels = ['今日', '明日', '明後日']
  const buttons = labels.map((label, i) => {
    const d = shiftDateStr(today, i)
    return button(`${label} (${formatDateLabel(d)})`, onCustomId(d), 1)
  })
  buttons.push(button('その他（記入）', otherCustomId, 2))
  return {
    type: RESPONSE.MESSAGE,
    data: { content, components: [{ type: 1, components: buttons }] },
  }
}

/** 日付手入力モーダル（type:9）。v4 `_build_date_modal` 相当。 */
export function buildDateModalResponse(modalCustomId: string): DiscordResponse {
  return {
    type: RESPONSE.MODAL,
    data: {
      title: '出荷日を入力',
      custom_id: modalCustomId,
      components: [
        {
          type: 1,
          components: [
            {
              type: 4, // text input
              custom_id: 'date_input',
              label: '出荷日（例: 2026-06-15 / 6/15 / 今日）',
              style: 1,
              placeholder: '2026-06-15',
              required: true,
              min_length: 1,
              max_length: 10,
            },
          ],
        },
      ],
    },
  }
}

/** モーダル送信 body から date_input の生値を取り出す（日付解決は呼び出し側で resolveDateFromText）。 */
export function extractModalDateInput(body: Record<string, unknown>): string | null {
  const data = body.data as { components?: unknown[] } | undefined
  const rows = (data?.components ?? []) as Array<{ components?: Array<{ custom_id?: string; value?: string }> }>
  for (const row of rows) {
    for (const comp of row.components ?? []) {
      if (comp.custom_id === 'date_input') return (comp.value ?? '').trim() || null
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// followup ペイロード（deferred 後の結果通知）
// ---------------------------------------------------------------------------

function errorPayload(message: string): Record<string, unknown> {
  return { embeds: [{ title: '❌ 処理に失敗しました', description: message, color: COLOR.alert }] }
}

function successPayload(title: string, description: string): Record<string, unknown> {
  return { embeds: [{ title, description, color: COLOR.info }] }
}

// ---------------------------------------------------------------------------
// deferred 実行本体（route が type:5 で ACK 済み → ここは followup を送るだけ）
// ---------------------------------------------------------------------------

/** approve/approve_on/approve_modal 共通の承認→印刷実行。 */
export async function runApproveAndPrint(
  applicationId: string,
  token: string,
  orderId: string,
  opts: { deliveryDate?: string },
): Promise<void> {
  const actor = await resolveChatActorUserId()
  if (!actor.ok) {
    await sendFollowup(applicationId, token, errorPayload(actor.error))
    return
  }

  const res = await approveAndPrint(orderId, opts, actor.userId)
  if (!res.success) {
    // ゲート拒否・印刷失敗などの日本語 error をそのまま利用者に返す。
    await sendFollowup(applicationId, token, errorPayload(res.error ?? '不明なエラー'))
    return
  }

  await sendFollowup(
    applicationId,
    token,
    successPayload(
      '✅ 承認 ＆ 印刷キュー登録完了',
      [
        `納品日: **${res.deliveryDate ?? '—'}**`,
        `印刷ジョブ: \`${res.jobId ? res.jobId.slice(0, 8) : '—'}\``,
        '',
        '🖨️ 事務所のPCで自動印刷が開始されます。',
      ].join('\n'),
    ),
  )
}

/** reprint: 確定済み受注の印刷キュー再投入。 */
export async function runReprint(
  applicationId: string,
  token: string,
  orderId: string,
  deliveryDate: string | undefined,
): Promise<void> {
  const res = await reprint(orderId, deliveryDate)
  if (!res.success) {
    await sendFollowup(applicationId, token, errorPayload(res.error ?? '不明なエラー'))
    return
  }
  await sendFollowup(
    applicationId,
    token,
    successPayload(
      '🖨️ 再印刷キュー登録完了',
      [
        `納品日: **${res.deliveryDate ?? '—'}**`,
        `印刷ジョブ: \`${res.jobId ? res.jobId.slice(0, 8) : '—'}\``,
        '',
        '🖨️ 事務所のPCで自動印刷が開始されます。',
      ].join('\n'),
    ),
  )
}

/** ingest: その日の受信メールを取り込み、承認待ち一覧を followup で返す。 */
export async function runIngest(
  applicationId: string,
  token: string,
  date: string,
): Promise<void> {
  const ing = await ingestEmailsForDate(date)
  if (!ing.success) {
    await sendFollowup(applicationId, token, errorPayload(ing.error ?? 'メール取込に失敗しました'))
    return
  }

  const pending = await listPendingApprovals()
  const summary = `📥 ${date} の受信: 新規 ${ing.newCount}件（うち要確認 ${ing.pendingCount}件）`

  if (!pending.success) {
    // 取込は成功。一覧取得だけ失敗 → 取込結果は伝える（握りつぶさない）。
    await sendFollowup(applicationId, token, {
      content: `${summary}\n⚠️ 承認待ち一覧の取得に失敗しました: ${pending.error}`,
    })
    return
  }

  if (pending.items.length === 0) {
    await sendFollowup(applicationId, token, { content: `${summary}\n📭 承認待ちの受注はありません。` })
    return
  }

  const buttons = pending.items
    .slice(0, 5)
    .map((p) => button(`📋 ${p.customerName}`, buildCustomId('preview', p.orderId), 2))
  await sendFollowup(applicationId, token, {
    content: `${summary}\n📋 承認待ち ${pending.items.length}件（タップして確認・承認）`,
    components: [{ type: 1, components: buttons }],
  })
}
