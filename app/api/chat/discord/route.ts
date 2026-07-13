import { NextResponse } from 'next/server'
import { getDiscordConfig } from '@/lib/chat/config'
import { verifyDiscordSignature } from '@/lib/chat/discord-verify'
import { parseCustomId, buildCustomId, isUserAllowed } from '@/lib/chat/discord-custom-id'
import { resolveDateFromText } from '@/lib/chat/dates'
import { listPendingApprovals, listRecentConfirmed } from '@/lib/chat/use-cases'
import {
  RESPONSE,
  ephemeralMessage,
  buildPrintCommandResponse,
  buildPreviewResponse,
  buildDateSelectorResponse,
  buildDateModalResponse,
  extractModalDateInput,
  runApproveAndPrint,
  runReprint,
  runIngest,
  type DiscordResponse,
} from '@/lib/chat/discord-handlers'

export const runtime = 'nodejs'

/**
 * Discord Interactions Webhook（統合2E-2）。
 * 「今日の受注を確認 → 承認 → 事務所プリンタに自動印刷」を Discord から操作する。
 * 承認は必ず 2E-1 のユースケース層（lib/chat/use-cases）を通す（DB直操作・RPC新設なし）。
 *
 * 3秒制限対策: 重い処理（取込・承認・印刷）は type:5（deferred）で即 ACK し、結果は followup
 * webhook で送る。一覧取得・プレビュー・日付選択など軽い処理は同期応答（type:4/9）。
 *
 * 注意（Cloud Run）: deferred の後続処理はレスポンス返却後に走る。Cloud Run で確実に完走させるには
 * CPU always-allocated もしくは min-instances>=1 が望ましい（レビュー確認ポイント）。
 */

/** Response 返却後もバックグラウンド処理を継続させる（v4 BackgroundTasks 相当）。例外はログのみ。 */
function fireAndForget(work: Promise<void>): void {
  void work.catch((e) => {
    console.error('[chat/discord] followup 実行に失敗', e)
  })
}

function json(res: DiscordResponse): NextResponse {
  return NextResponse.json(res)
}

/** deferred（考え中…）ACK。 */
function deferred(): DiscordResponse {
  return { type: RESPONSE.DEFERRED_MESSAGE }
}

export async function POST(req: Request) {
  // 1. 署名検証（生の本文で検証する。JSON.parse 前）。
  const rawBody = await req.text()
  const signature = req.headers.get('X-Signature-Ed25519') ?? ''
  const timestamp = req.headers.get('X-Signature-Timestamp') ?? ''

  const config = await getDiscordConfig()
  // 公開鍵未設定は 401（本番は必須。v4 は未設定でスキップしていたが弱いので踏襲しない）。
  if (!config.publicKey) {
    console.error('[chat/discord] DISCORD_PUBLIC_KEY 未設定のため検証不可')
    return new NextResponse('signature verification unavailable', { status: 401 })
  }
  const valid = verifyDiscordSignature({
    publicKeyHex: config.publicKey,
    signatureHex: signature,
    timestamp,
    rawBody,
  })
  if (!valid) {
    return new NextResponse('invalid request signature', { status: 401 })
  }

  // 2. 本文パース（検証後）。
  let body: Record<string, unknown>
  try {
    body = JSON.parse(rawBody)
  } catch {
    return new NextResponse('invalid json', { status: 400 })
  }

  const interactionType = body.type as number
  // 3. PING（疎通確認）。
  if (interactionType === 1) {
    return json({ type: RESPONSE.PONG })
  }

  const applicationId = String(body.application_id ?? '')
  const token = String(body.token ?? '')

  // 4. 許可ユーザー判定。
  const member = body.member as { user?: { id?: string } } | undefined
  const topUser = body.user as { id?: string } | undefined
  const userId = member?.user?.id ?? topUser?.id ?? null
  if (!isUserAllowed(config.allowedUsers, userId)) {
    return json(ephemeralMessage('⚠️ このシステムの操作権限がありません。'))
  }

  try {
    // 5. スラッシュコマンド。
    if (interactionType === 2) {
      const cmd = (body.data as { name?: string } | undefined)?.name ?? ''
      if (cmd === '印刷' || cmd === 'order-print' || cmd === 'print') {
        const [pending, confirmed] = await Promise.all([listPendingApprovals(), listRecentConfirmed()])
        if (!pending.success) return json(ephemeralMessage(`承認待ちの取得に失敗しました: ${pending.error}`))
        if (!confirmed.success) return json(ephemeralMessage(`確定済みの取得に失敗しました: ${confirmed.error}`))
        return json(buildPrintCommandResponse(pending.items, confirmed.items))
      }
      return json(ephemeralMessage('不明なコマンドです。'))
    }

    // 6. ボタン押下。
    if (interactionType === 3) {
      const customId = (body.data as { custom_id?: string } | undefined)?.custom_id ?? ''
      const { action, args } = parseCustomId(customId)

      switch (action) {
        case 'preview': {
          const orderId = args[0] ?? ''
          const pending = await listPendingApprovals()
          if (!pending.success) return json(ephemeralMessage(`取得に失敗しました: ${pending.error}`))
          const order = pending.items.find((o) => o.orderId === orderId)
          if (!order) {
            return json(ephemeralMessage('この受注は承認待ちに見つかりません（既に承認済みの可能性）。'))
          }
          return json(buildPreviewResponse(order))
        }
        case 'approve': {
          const orderId = args[0] ?? ''
          fireAndForget(runApproveAndPrint(applicationId, token, orderId, {}))
          return json(deferred())
        }
        case 'approve_pick': {
          const orderId = args[0] ?? ''
          return json(
            buildDateSelectorResponse(
              '📅 出荷日を選択してください:',
              (date) => buildCustomId('approve_on', orderId, date),
              buildCustomId('approve_other', orderId),
            ),
          )
        }
        case 'approve_on': {
          const [orderId, date] = [args[0] ?? '', args[1] ?? '']
          fireAndForget(runApproveAndPrint(applicationId, token, orderId, { deliveryDate: date }))
          return json(deferred())
        }
        case 'approve_other': {
          const orderId = args[0] ?? ''
          return json(buildDateModalResponse(buildCustomId('approve_modal', orderId)))
        }
        case 'reprint': {
          const [orderId, date] = [args[0] ?? '', args[1] ?? '']
          fireAndForget(runReprint(applicationId, token, orderId, date || undefined))
          return json(deferred())
        }
        case 'ingest_pick': {
          return json(
            buildDateSelectorResponse(
              '📅 取り込む受信日を選択してください:',
              (date) => buildCustomId('ingest_on', date),
              buildCustomId('ingest_other'),
            ),
          )
        }
        case 'ingest_on': {
          const date = args[0] ?? ''
          fireAndForget(runIngest(applicationId, token, date))
          return json(deferred())
        }
        case 'ingest_other': {
          return json(buildDateModalResponse(buildCustomId('ingest_modal')))
        }
        default:
          return json(ephemeralMessage('不明な操作です。'))
      }
    }

    // 7. モーダル送信。
    if (interactionType === 5) {
      const customId = (body.data as { custom_id?: string } | undefined)?.custom_id ?? ''
      const { action, args } = parseCustomId(customId)
      const rawDate = extractModalDateInput(body)
      const date = resolveDateFromText(rawDate)

      if (action === 'approve_modal') {
        const orderId = args[0] ?? ''
        if (!date) return json(ephemeralMessage('❌ 日付を認識できませんでした（例: 2026-06-15 / 6/15 / 今日）。'))
        fireAndForget(runApproveAndPrint(applicationId, token, orderId, { deliveryDate: date }))
        return json(deferred())
      }
      if (action === 'ingest_modal') {
        if (!date) return json(ephemeralMessage('❌ 日付を認識できませんでした（例: 2026-06-15 / 6/15 / 今日）。'))
        fireAndForget(runIngest(applicationId, token, date))
        return json(deferred())
      }
      return json(ephemeralMessage('不明な入力です。'))
    }

    return json(ephemeralMessage('未対応の操作です。'))
  } catch (e) {
    // 内部エラーでも Discord には有効な応答を返す（500 にしない）。秘匿値はログに出さない。
    console.error('[chat/discord] 処理中にエラー', e)
    return json(ephemeralMessage('⚠️ 内部エラーが発生しました。時間をおいて再度お試しください。'))
  }
}
