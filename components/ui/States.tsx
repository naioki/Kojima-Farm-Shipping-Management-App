import type { ReactNode } from 'react'
import { Inbox, AlertTriangle } from 'lucide-react'
import { Card } from './Card'
import { ErrorRetry } from './ErrorRetry'

/** 空状態（すべてのリストに必須・design.md / react-ui-patterns） */
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <Card className="flex flex-col items-center gap-3 py-12 text-center">
      <span className="text-ink-faint">{icon ?? <Inbox className="h-8 w-8" aria-hidden />}</span>
      <h3 className="font-display text-lg font-bold text-ink">{title}</h3>
      {description && <p className="max-w-sm text-sm text-ink-soft">{description}</p>}
      {action}
    </Card>
  )
}

/**
 * エラー状態（必ずユーザーに見せる・NEVER swallow errors）。
 *
 * - `message`: 平易な日本語の見出し文（既定あり）。現場・経営が読んで動ける言葉にする。
 * - `detail`: 技術的な詳細（元の error.message 等）。「詳細を表示」の折りたたみに収納し、
 *   ふだんは見せない（利用者を怖がらせない・でも調査時には見える）。
 * - `onRetry`: あれば「再試行」がそれを呼ぶ（クライアントページ）。無ければページ再読み込み。
 *
 * 後方互換: `<ErrorState message="..." />` だけでも従来どおり動く。
 */
export function ErrorState({
  title = 'エラーが発生しました',
  message = 'データを読み込めませんでした。時間をおいて再度お試しください。',
  detail,
  onRetry,
}: {
  title?: string
  message?: string
  detail?: string
  onRetry?: () => void
}) {
  return (
    <Card className="flex flex-col items-center gap-3 border-alert/40 py-12 text-center">
      <AlertTriangle className="h-8 w-8 text-alert" aria-hidden />
      <h3 className="font-display text-lg font-bold text-ink">{title}</h3>
      <p className="max-w-sm text-sm text-ink-soft">{message}</p>
      {detail && (
        <details className="max-w-sm text-left text-xs text-ink-faint">
          <summary className="cursor-pointer select-none text-ink-soft hover:text-ink">詳細を表示</summary>
          <p className="mt-2 whitespace-pre-wrap break-words font-mono text-alert">{detail}</p>
        </details>
      )}
      <ErrorRetry onRetry={onRetry} />
    </Card>
  )
}
