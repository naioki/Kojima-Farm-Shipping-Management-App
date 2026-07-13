import 'server-only'

/**
 * Discord への能動送信ヘルパ（統合2E-2）。secrets はここに渡すだけで、ログ・レスポンスに出さない。
 *
 *  - sendFollowup: deferred（type:5/6）で ACK した後の結果を、Interaction の followup webhook へ送る。
 *    application_id と interaction token は interaction body から取得でき、認証不要（Bot Token 不要）。
 *  - postChannelMessage: interaction 文脈の外からボタン付きメッセージをチャネルへ送る場合に使う
 *    （Bot Token 経由。通常フローは followup で足りるが、通知起点の能動送信用に用意）。
 */

const DISCORD_API = 'https://discord.com/api/v10'

export type DiscordPayload = Record<string, unknown>

/** Interaction の followup webhook にメッセージを送る（deferred 応答後の結果通知）。 */
export async function sendFollowup(
  applicationId: string,
  interactionToken: string,
  payload: DiscordPayload,
): Promise<void> {
  const url = `${DISCORD_API}/webhooks/${applicationId}/${interactionToken}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    throw new Error(`Discord followup 送信失敗: ${res.status}`)
  }
}

/** Bot Token でチャネルへメッセージ送信（ボタン付きの能動送信用）。 */
export async function postChannelMessage(
  botToken: string,
  channelId: string,
  payload: DiscordPayload,
): Promise<void> {
  const url = `${DISCORD_API}/channels/${channelId}/messages`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bot ${botToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    throw new Error(`Discord channel 送信失敗: ${res.status}`)
  }
}
