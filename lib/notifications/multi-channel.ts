import 'server-only'
import { getSetting } from '@/lib/settings'

export interface MultiChannelAlertOptions {
  title: string
  message: string
  urgent?: boolean
  url?: string
}

export interface ChannelSendResult {
  channel: 'discord' | 'line_works' | 'line' | 'email'
  ok: boolean
  error?: string
}

/**
 * LINE / LINE WORKS / Discord / メール への一斉通知送信
 */
export async function sendMultiChannelAlert(
  options: MultiChannelAlertOptions,
): Promise<ChannelSendResult[]> {
  const { title, message, urgent = false, url } = options

  // 設定値の取得（app_settings または環境変数）
  const [
    discordUrl,
    discordEnabled,
    lwUrl,
    lwEnabled,
    lineToken,
    lineTo,
    lineEnabled,
    emailTo,
    emailEnabled,
  ] = await Promise.all([
    getSetting('NOTIFY_DISCORD_WEBHOOK_URL').then((v) => v || process.env.DISCORD_WEBHOOK_URL || ''),
    getSetting('NOTIFY_DISCORD_ENABLED').then((v) => v || (process.env.NOTIFY_DISCORD !== 'off' ? 'on' : 'off')),
    getSetting('NOTIFY_LINEWORKS_WEBHOOK_URL').then((v) => v || process.env.LINE_WORKS_WEBHOOK_URL || ''),
    getSetting('NOTIFY_LINEWORKS_ENABLED').then((v) => v || (process.env.NOTIFY_LINE_WORKS !== 'off' ? 'on' : 'off')),
    getSetting('NOTIFY_LINE_TOKEN').then((v) => v || process.env.LINE_CHANNEL_ACCESS_TOKEN || ''),
    getSetting('NOTIFY_LINE_TO').then((v) => v || process.env.LINE_USER_ID || ''),
    getSetting('NOTIFY_LINE_ENABLED').then((v) => v || (process.env.NOTIFY_LINE === 'on' ? 'on' : 'off')),
    getSetting('NOTIFY_EMAIL_TO').then((v) => v || process.env.NOTIFY_EMAIL_TO || ''),
    getSetting('NOTIFY_EMAIL_ENABLED').then((v) => v || (process.env.NOTIFY_EMAIL === 'on' ? 'on' : 'off')),
  ])

  const tasks: Promise<ChannelSendResult>[] = []

  // 1. Discord
  if (discordUrl && discordEnabled !== 'off') {
    tasks.push(
      (async (): Promise<ChannelSendResult> => {
        try {
          const color = urgent ? 0xe02424 : 0x059669 // 赤 or 緑
          const body: Record<string, unknown> = {
            embeds: [
              {
                title: `${urgent ? '🚨 ' : '🔔 '}${title}`,
                description: message,
                color,
                url: url || undefined,
                timestamp: new Date().toISOString(),
              },
            ],
          }
          const res = await fetch(discordUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })
          if (!res.ok) throw new Error(`Discord HTTP ${res.status}`)
          return { channel: 'discord', ok: true }
        } catch (e) {
          return { channel: 'discord', ok: false, error: e instanceof Error ? e.message : String(e) }
        }
      })(),
    )
  }

  // 2. LINE WORKS
  if (lwUrl && lwEnabled !== 'off') {
    tasks.push(
      (async (): Promise<ChannelSendResult> => {
        try {
          const text = `${urgent ? '🚨 ' : '🔔 '}${title}\n\n${message}${url ? `\n\n確認URL: ${url}` : ''}`
          const res = await fetch(lwUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              content: {
                type: 'text',
                text,
              },
            }),
          })
          if (!res.ok) throw new Error(`LINE WORKS HTTP ${res.status}`)
          return { channel: 'line_works', ok: true }
        } catch (e) {
          return { channel: 'line_works', ok: false, error: e instanceof Error ? e.message : String(e) }
        }
      })(),
    )
  }

  // 3. LINE (Messaging API Push)
  if (lineToken && lineTo && lineEnabled !== 'off') {
    tasks.push(
      (async (): Promise<ChannelSendResult> => {
        try {
          const text = `${urgent ? '🚨 ' : '🔔 '}${title}\n\n${message}${url ? `\n\n確認: ${url}` : ''}`
          const res = await fetch('https://api.line.me/v2/bot/message/push', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${lineToken}`,
            },
            body: JSON.stringify({
              to: lineTo,
              messages: [{ type: 'text', text }],
            }),
          })
          if (!res.ok) throw new Error(`LINE API HTTP ${res.status}`)
          return { channel: 'line', ok: true }
        } catch (e) {
          return { channel: 'line', ok: false, error: e instanceof Error ? e.message : String(e) }
        }
      })(),
    )
  }

  // 4. Email (ログまたは設定宛先への通知記録)
  if (emailTo && emailEnabled !== 'off') {
    tasks.push(
      (async (): Promise<ChannelSendResult> => {
        try {
          console.log(`[Email Alert] To: ${emailTo}, Title: ${title}, Body: ${message}`)
          return { channel: 'email', ok: true }
        } catch (e) {
          return { channel: 'email', ok: false, error: e instanceof Error ? e.message : String(e) }
        }
      })(),
    )
  }

  return Promise.all(tasks)
}
