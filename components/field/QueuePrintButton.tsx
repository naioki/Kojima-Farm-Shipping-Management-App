'use client'

import { useState } from 'react'
import toast from 'react-hot-toast'
import { Printer, Loader2 } from 'lucide-react'
import { cn } from '@/lib/cn'

/**
 * 「事務所プリンタで自動印刷」ボタン（統合2D）。
 * POST /api/print-jobs にキュー投入し、常駐エージェントが印刷する。
 * ダウンロード（<a>）と違いその場でPDFは開かない。
 */
export function QueuePrintButton({
  date,
  docType,
  productId,
  label = '事務所で自動印刷',
  className,
}: {
  date: string
  docType: 'sheet' | 'labels'
  productId?: string
  label?: string
  className?: string
}) {
  const [sending, setSending] = useState(false)

  async function send() {
    if (sending) return
    setSending(true)
    try {
      const res = await fetch('/api/print-jobs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ date, docType, productId }),
      })
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        toast.error(body.error ?? '印刷キューへの登録に失敗しました')
        return
      }
      toast.success('事務所のプリンタに送りました')
    } catch {
      toast.error('通信エラー。もう一度お試しください')
    } finally {
      setSending(false)
    }
  }

  return (
    <button
      type="button"
      onClick={send}
      disabled={sending}
      className={cn(
        'inline-flex items-center gap-1.5 rounded border border-line px-3 py-1.5 text-sm text-ink-soft',
        'hover:bg-bg-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-trust-100',
        'disabled:opacity-60',
        className,
      )}
    >
      {sending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Printer className="h-4 w-4" aria-hidden />}
      {label}
    </button>
  )
}
