import type { NotifyMessage } from './index'

/**
 * LINE WORKS への送信（features.md §9-2）。
 * 既存の LINE WORKS 通知実装をこのインターフェースに合わせてラップする。
 * 現状は Incoming Webhook 互換の最小実装。Bot API を使う場合はここを差し替える。
 */
export async function sendLineWorks(webhookUrl: string, message: NotifyMessage): Promise<void> {
  const prefix = message.level === 'alert' ? '🔴' : message.level === 'warning' ? '🟡' : '🟢'
  const text = [`${prefix} ${message.title}`, message.body, message.url].filter(Boolean).join('\n')
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: { type: 'text', text } }),
  })
  if (!res.ok) throw new Error(`LINE WORKS 送信失敗: ${res.status}`)
}
