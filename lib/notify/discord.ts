import type { NotifyLevel, NotifyMessage } from './index'

/** Discord embed の色（features.md §9-2：赤=alert/黄=warning/緑=info）。 */
export function levelToColor(level: NotifyLevel): number {
  switch (level) {
    case 'alert':
      return 0xd92d20
    case 'warning':
      return 0xdc6803
    case 'info':
      return 0x16a34a
  }
}

/** Discord Incoming Webhook へ embed 形式で POST。URL は Secret Manager 由来（security.md）。 */
export async function sendDiscord(webhookUrl: string, message: NotifyMessage): Promise<void> {
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      embeds: [
        {
          title: message.title,
          description: message.body,
          color: levelToColor(message.level),
          url: message.url,
          footer: { text: `event: ${message.event}` },
        },
      ],
    }),
  })
  if (!res.ok) throw new Error(`Discord 送信失敗: ${res.status}`)
}
