'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Button } from './Button'

export interface ModalProps {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  /** フッター（確定/キャンセル等）。未指定なら表示しない */
  footer?: ReactNode
  className?: string
}

/**
 * 確認ダイアログ・編集フォーム用のモーダル（#17 上部ヘッダー・下部フッター固定スクロール対応）。
 * - スマホで長いフォーム（新規出荷の追加/変更など）を開いた際にも、
 *   タイトル/閉じるボタン（上部）と確定/キャンセルボタン（下部）が常時画面内に固定表示され、中央ボディのみがスムーズにスクロールする。
 */
export function Modal({ open, onClose, title, children, footer, className }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(e) => {
        if (!panelRef.current?.contains(e.target as Node)) onClose()
      }}
    >
      <div
        ref={panelRef}
        className={cn(
          'animate-grow-in w-full max-w-md max-h-[92dvh] pb-[env(safe-area-inset-bottom)] flex flex-col rounded-t-2xl sm:rounded-2xl border border-line-strong bg-bg-card shadow-2xl overflow-hidden',
          className,
        )}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-line bg-bg-card px-4 sm:px-5 py-3">
          <h2 className="font-display text-base sm:text-lg font-black text-ink truncate">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="rounded-lg p-1.5 text-ink-soft hover:bg-bg-soft hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-trust-100 shrink-0"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-3.5">{children}</div>
        {footer && (
          <div className="flex shrink-0 justify-end gap-2 border-t border-line bg-bg-card px-4 sm:px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

/** よく使う確認ダイアログの薄いラッパ（破壊的操作は danger を既定に） */
export function ConfirmModal({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'OK',
  danger = true,
  isLoading,
}: {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  message: ReactNode
  confirmLabel?: string
  danger?: boolean
  isLoading?: boolean
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isLoading}>
            キャンセル
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} isLoading={isLoading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm text-ink-soft">{message}</p>
    </Modal>
  )
}
