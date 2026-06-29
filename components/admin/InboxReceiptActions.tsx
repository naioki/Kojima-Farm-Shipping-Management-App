'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ScanLine, RefreshCw, X } from 'lucide-react'
import toast from 'react-hot-toast'

interface Props {
  receiptId: string
  status: string
  hasR2Key: boolean
}

export function InboxReceiptActions({ receiptId, status, hasR2Key }: Props) {
  const router = useRouter()
  const [dismissing, setDismissing] = useState(false)
  const [retrying, setRetrying] = useState(false)

  async function handleDismiss() {
    if (!confirm('この受信を却下してリストから消しますか？（元の画像は保持されます）')) return
    setDismissing(true)
    try {
      const res = await fetch(`/api/receipts/${receiptId}/dismiss`, { method: 'POST' })
      if (!res.ok) {
        const j = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(j.error ?? `却下失敗 (${res.status})`)
      }
      toast.success('受信を却下しました')
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '却下に失敗しました')
    } finally {
      setDismissing(false)
    }
  }

  async function handleRetry() {
    setRetrying(true)
    try {
      const res = await fetch(`/api/receipts/${receiptId}/retry`, { method: 'POST' })
      if (!res.ok) {
        const j = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(j.error ?? `失敗 (${res.status})`)
      }
      toast.success('再解析を開始しました。少し待ってからページを更新してください。')
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '再解析の開始に失敗しました')
    } finally {
      setRetrying(false)
    }
  }

  return (
    <>
      {hasR2Key && (
        <a
          href={`/admin/ocr?receipt=${receiptId}`}
          className="inline-flex items-center gap-1.5 rounded border border-harvest-300 bg-harvest-50 px-2.5 py-1 text-xs font-medium text-harvest-700 hover:bg-harvest-100"
        >
          <ScanLine className="h-3.5 w-3.5" aria-hidden />
          読み取る
        </a>
      )}
      {status === 'ai_failed' && (
        <button
          type="button"
          onClick={handleRetry}
          disabled={retrying}
          className="inline-flex items-center gap-1.5 rounded border border-line-strong bg-bg-card px-2.5 py-1 text-xs font-medium text-ink hover:bg-bg-soft disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${retrying ? 'animate-spin' : ''}`} aria-hidden />
          {retrying ? '開始中…' : '再解析'}
        </button>
      )}
      <button
        type="button"
        onClick={handleDismiss}
        disabled={dismissing}
        className="inline-flex items-center gap-1.5 rounded border border-line-strong bg-bg-card px-2.5 py-1 text-xs font-medium text-ink-faint hover:bg-bg-soft disabled:opacity-50"
      >
        <X className="h-3.5 w-3.5" aria-hidden />
        {dismissing ? '処理中…' : '却下'}
      </button>
    </>
  )
}
