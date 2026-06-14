import 'server-only'
import { getSetting } from '@/lib/settings'
import type { NotifyChannel } from './index'

/**
 * 設定（app_settings → env）から通知の送信先を構築する（サーバ専用）。
 * 設定画面で入れた Discord / LINE WORKS の Webhook をそのまま使えるようにする。
 * （buildChannelsFromEnv は env のみ参照するため、設定UIで入れた値も拾えるこちらを使う）
 */
export async function buildChannelsFromSettings(): Promise<NotifyChannel[]> {
  const [discordUrl, discordOn, lwUrl, lwOn] = await Promise.all([
    getSetting('DISCORD_WEBHOOK_URL'),
    getSetting('NOTIFY_DISCORD'),
    getSetting('LINE_WORKS_WEBHOOK_URL'),
    getSetting('NOTIFY_LINE_WORKS'),
  ])

  const channels: NotifyChannel[] = []
  if (discordUrl && discordOn !== 'off') {
    channels.push({
      name: 'discord',
      send: async (m) => {
        const { sendDiscord } = await import('./discord')
        await sendDiscord(discordUrl, m)
      },
    })
  }
  if (lwUrl && lwOn !== 'off') {
    channels.push({
      name: 'line_works',
      send: async (m) => {
        const { sendLineWorks } = await import('./line-works')
        await sendLineWorks(lwUrl, m)
      },
    })
  }
  return channels
}
