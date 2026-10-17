/**
 * 通知の集約点（docs/web_app_migration_plan.md 確定方針：Discord連携は完全廃止）。
 * Webアプリ内で完結する運用を基本とし、LINE WORKS が設定されている場合のみ通知を送信する。
 * 1つも throw せず、各送信先の成否を返す。
 */

export type NotifyLevel = 'alert' | 'warning' | 'info'

export type NotifyEvent =
  | 'pending_review' // 承認待ち発生（新規/差分）
  | 'low_confidence' // AI確信度低（要確認）
  | 'quota_low' // Gemini無料枠 残50/0
  | 'unmatched_receipt' // 取引先未紐付け
  | 'edit_conflict' // 楽観ロック競合
  | 'shortage_forecast' // 翌日以降の不足予測
  | 'rule_changed' // 取引先の規格（取引ルール）の追加・変更
  | 'shadow_diff' // 影実行（v4×新アプリの突合レポート・統合2C）

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
 * 環境変数から送信先を構築。
 * ※ 確定方針（2026-10-16）により Discord 通知・Bot連携は完全廃止。
 */
export function buildChannelsFromEnv(): NotifyChannel[] {
  const channels: NotifyChannel[] = []
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
