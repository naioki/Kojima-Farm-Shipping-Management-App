/**
 * 通知の集約点（features.md §9-2）。
 * notify() を呼ぶと有効な送信先（LINE WORKS / Discord）へ並列送信する。
 * 片方が失敗しても他方は送る（Promise.allSettled）。送信先の増減はここだけ変更する。
 */

export type NotifyLevel = 'alert' | 'warning' | 'info'

export type NotifyEvent =
  | 'pending_review' // 承認待ち発生（新規/差分）
  | 'low_confidence' // AI確信度低（要確認）
  | 'quota_low' // Gemini無料枠 残50/0
  | 'unmatched_receipt' // 取引先未紐付け
  | 'edit_conflict' // 楽観ロック競合
  | 'shortage_forecast' // 翌日以降の不足予測

export interface NotifyMessage {
  event: NotifyEvent
  level: NotifyLevel
  title: string
  body: string
  /** 詳細画面への導線など */
  url?: string
}

export interface NotifyChannel {
  name: string
  send(message: NotifyMessage): Promise<void>
}

export interface NotifyResult {
  channel: string
  ok: boolean
  error?: string
}

/**
 * 全送信先へ並列送信。1つも throw せず、各送信先の成否を返す。
 * channels を渡せばテストでモック可能（既定は環境変数から構築）。
 */
export async function notify(
  message: NotifyMessage,
  channels?: NotifyChannel[],
): Promise<NotifyResult[]> {
  const targets = channels ?? buildChannelsFromEnv()
  const settled = await Promise.allSettled(targets.map((c) => c.send(message)))
  return settled.map((s, i) => {
    const channel = targets[i]!.name
    if (s.status === 'fulfilled') return { channel, ok: true }
    return { channel, ok: false, error: s.reason instanceof Error ? s.reason.message : String(s.reason) }
  })
}

/**
 * 環境変数から送信先を構築（ON/OFF を env で切替・features.md §9-2）。
 * 遅延 import で Node 専用依存をクライアントに持ち込まない。
 */
export function buildChannelsFromEnv(): NotifyChannel[] {
  const channels: NotifyChannel[] = []
  if (process.env.DISCORD_WEBHOOK_URL && process.env.NOTIFY_DISCORD !== 'off') {
    const url = process.env.DISCORD_WEBHOOK_URL
    channels.push({
      name: 'discord',
      send: async (m) => {
        const { sendDiscord } = await import('./discord')
        await sendDiscord(url, m)
      },
    })
  }
  if (process.env.LINE_WORKS_WEBHOOK_URL && process.env.NOTIFY_LINE_WORKS !== 'off') {
    const url = process.env.LINE_WORKS_WEBHOOK_URL
    channels.push({
      name: 'line_works',
      send: async (m) => {
        const { sendLineWorks } = await import('./line-works')
        await sendLineWorks(url, m)
      },
    })
  }
  return channels
}
