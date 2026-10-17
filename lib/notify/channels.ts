import 'server-only'
import type { NotifyChannel } from './index'
import { getSetting } from '@/lib/settings'

/**
 * 設定（DB→env）から通知先を構築する（features.md §9-2）。
 * notify() の既定 buildChannelsFromEnv は env 専用（テストで server-only を持ち込まないため）。
 * 設定画面で入れた Webhook を使う場合はこちらを呼んで notify(msg, await buildChannelsFromSettings()) とする。
 */
export async function buildChannelsFromSettings(): Promise<NotifyChannel[]> {
  const [discordUrl, lineUrl, discordOff, lineOff] = await Promise.all([
    getSetting('DISCORD_WEBHOOK_URL'),
    getSetting('LINE_WORKS_WEBHOOK_URL'),
    getSetting('NOTIFY_DISCORD'),
    getSetting('NOTIFY_LINE_WORKS'),
  ])

  const channels: NotifyChannel[] = []
  if (discordUrl && discordOff?.toLowerCase() !== 'off') {
    channels.push({
      name: 'discord',
      send: async (m) => {
        const { sendDiscord } = await import('./discord')
        await sendDiscord(discordUrl, m)
      },
    })
  }
  if (lineUrl && lineOff?.toLowerCase() !== 'off') {
    channels.push({
      name: 'line_works',
      send: async (m) => {
        const { sendLineWorks } = await import('./line-works')
        await sendLineWorks(lineUrl, m)
      },
    })
  }
  return channels
}
