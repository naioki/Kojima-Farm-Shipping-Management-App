import type { ReactNode } from 'react'
import { Inbox, AlertTriangle } from 'lucide-react'
import { Card } from './Card'

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

/** エラー状態（必ずユーザーに見せる・NEVER swallow errors） */
export function ErrorState({ title = 'エラーが発生しました', message }: { title?: string; message: string }) {
  return (
    <Card className="flex flex-col items-center gap-3 border-alert/40 py-12 text-center">
      <AlertTriangle className="h-8 w-8 text-alert" aria-hidden />
      <h3 className="font-display text-lg font-bold text-ink">{title}</h3>
      <p className="max-w-sm text-sm text-alert">{message}</p>
    </Card>
  )
}
