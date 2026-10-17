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
 * 確認ダイアログ・編集フォーム用の最小モーダル。
 * Esc で閉じ、開いている間は背面スクロールを止める（誤操作防止）。
 * 圃場のリセット確認（features.md §7）など破壊的操作の確認に使う。
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(e) => {
        // 背景クリックで閉じる（パネル内クリックは無視）
        if (!panelRef.current?.contains(e.target as Node)) onClose()
      }}
    >
      <div
        ref={panelRef}
        className={cn(
          'animate-grow-in w-full max-w-md rounded-lg border border-line-strong bg-bg-card shadow-xl',
          className,
        )}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="font-display text-lg font-bold text-ink">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="rounded p-1 text-ink-faint hover:bg-bg-soft hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-trust-100"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 border-t border-line px-5 py-3.5">{footer}</div>
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
