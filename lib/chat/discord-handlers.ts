import 'server-only'
import {
  approveAndPrint,
  reprint,
  type PendingApprovalView,
  type ConfirmedOrderView,
} from './use-cases'
import { resolveChatActorUserId } from './discord-actor'
import { buildCustomId } from './discord-custom-id'
import { getSetting } from '@/lib/settings'
import { jstTodayStr, shiftDateStr } from '@/lib/dates'

/**
 * Discord Interactions のビルダー（同期応答用）と実行本体（interaction 応答を組み立てて返す）。
 *
 * - 承認は必ず 2E-1 のユースケース層（approveAndPrint / reprint）を通す。ここから DB を
 *   直接叩いたり RPC を新設したりしない（抜け道を作らない）。
 * - 2E-2r: Cloud Run を「CPUリクエスト時のみ割当＋min-instances=0」（コスト優先）で運用するため、
 *   レスポンス返却後の背景処理（旧 deferred+followup）は CPU が絞られ完走保証がない。よって
 *   承認・再印刷は interaction リクエスト内で同期実行し type:4 で即返す（runApproveAndPrint /
 *   runReprint は DiscordResponse を返す純粋な async 関数）。メール取込は IMAP+Gemini で確実に
 *   3秒を超えるため同期化できないので、独立リクエストとして full CPU で走る poll-email を
 *   self-invoke する（runIngest）。エラーは握りつぶさず利用者向け日本語 embed で返す。
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

  // メール取込（poll-email を self-invoke。メールボックス全体を Message-ID で重複排除するので
  // 日付スコープは持たない → 単一トリガー ingest）。
  rows.push({ type: 1, components: [button('📥 メールを取込む', buildCustomId('ingest'), 2)] })

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
// 実行本体（interaction リクエスト内で同期実行し、type:4 の embed を返す）
//
// 3秒制限のトレードオフ（「CPUリクエスト時のみ割当＋min-instances=0」設計の許容点）:
//   ウォーム時は 承認(数クエリ)＋1ページPDF生成＋Storage 投入まで 3秒内に収まる。
//   min-instances=0 のコールドスタート時は 3秒を超え Discord 側が「アプリが応答しませんでした」と
//   表示することがあるが、サーバ側の承認・印刷投入は完走している。approveOrder は既承認を 409 で
//   弾く（二重承認しない）ため、利用者が再タップしても安全に「既に承認済み」を返す。これはコスト
//   優先設計に伴う許容トレードオフ。always-allocated / min-instances>=1 にすれば解消する。
// ---------------------------------------------------------------------------

function errorPayload(message: string): Record<string, unknown> {
  return { embeds: [{ title: '❌ 処理に失敗しました', description: message, color: COLOR.alert }] }
}

function successPayload(title: string, description: string): Record<string, unknown> {
  return { embeds: [{ title, description, color: COLOR.info }] }
}

/** 失敗 embed を type:4 応答として返す。 */
function errorResponse(message: string): DiscordResponse {
  return { type: RESPONSE.MESSAGE, data: errorPayload(message) }
}

/** approve/approve_on/approve_modal 共通の承認→印刷実行（同期・type:4 で結果 embed を返す）。 */
export async function runApproveAndPrint(
  orderId: string,
  opts: { deliveryDate?: string },
): Promise<DiscordResponse> {
  const actor = await resolveChatActorUserId()
  if (!actor.ok) return errorResponse(actor.error)

  const res = await approveAndPrint(orderId, opts, actor.userId)
  if (!res.success) {
    // ゲート拒否・印刷失敗などの日本語 error をそのまま利用者に返す。
    return errorResponse(res.error ?? '不明なエラー')
  }

  return {
    type: RESPONSE.MESSAGE,
    data: successPayload(
      '✅ 承認 ＆ 印刷キュー登録完了',
      [
        `納品日: **${res.deliveryDate ?? '—'}**`,
        `印刷ジョブ: \`${res.jobId ? res.jobId.slice(0, 8) : '—'}\``,
        '',
        '🖨️ 事務所のPCで自動印刷が開始されます。',
      ].join('\n'),
    ),
  }
}

/** reprint: 確定済み受注の印刷キュー再投入（同期・type:4）。 */
export async function runReprint(
  orderId: string,
  deliveryDate: string | undefined,
): Promise<DiscordResponse> {
  const res = await reprint(orderId, deliveryDate)
  if (!res.success) return errorResponse(res.error ?? '不明なエラー')
  return {
    type: RESPONSE.MESSAGE,
    data: successPayload(
      '🖨️ 再印刷キュー登録完了',
      [
        `納品日: **${res.deliveryDate ?? '—'}**`,
        `印刷ジョブ: \`${res.jobId ? res.jobId.slice(0, 8) : '—'}\``,
        '',
        '🖨️ 事務所のPCで自動印刷が開始されます。',
      ].join('\n'),
    ),
  }
}

/**
 * ingest: メール取込を起動する。IMAP+Gemini は確実に 3秒を超え同期化も背景実行もできないため、
 * 独立した Cloud Run リクエスト（full CPU で確実に完走）として GET /api/cron/poll-email を
 * self-invoke する。origin は route が受信 interaction の URL から導出して渡す。
 *
 * 完走は待たない: fetch の発火だけ担保して即 ack を返す（Promise.race で最大 ~800ms 待って、
 * 接続が張られてから戻る）。CRON_SECRET は self エンドポイントの認証ヘッダに載せるだけで、
 * ログにもレスポンスにも出さない。
 */
export async function runIngest(origin: string): Promise<DiscordResponse> {
  const secret = await getSetting('CRON_SECRET')
  if (!secret) {
    return errorResponse('CRON_SECRETが未設定です。設定画面から登録してください。')
  }

  const url = `${origin}/api/cron/poll-email`
  // verifyCronRequest が受け付けるヘッダ（x-cron-secret）で自分の cron エンドポイントを叩く。
  const fire = fetch(url, { method: 'GET', headers: { 'x-cron-secret': secret } })
    .then(() => undefined)
    .catch(() => undefined)
  // 送信の発火だけ担保して戻る（完走は待たない）。
  await Promise.race([fire, new Promise<void>((resolve) => setTimeout(resolve, 800))])

  return {
    type: RESPONSE.MESSAGE,
    data: successPayload(
      '📥 メールの取り込みを開始しました',
      '数十秒後に /印刷 で確認してください。',
    ),
  }
}
