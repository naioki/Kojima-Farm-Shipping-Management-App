'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ScanLine, RefreshCw, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { ConfirmModal } from '@/components/ui/Modal'

interface Props {
  receiptId: string
  status: string
  hasR2Key: boolean
}

export function InboxReceiptActions({ receiptId, status, hasR2Key }: Props) {
  const router = useRouter()
  const [dismissing, setDismissing] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  async function handleDismiss() {
    setDismissing(true)
    try {
      const res = await fetch(`/api/receipts/${receiptId}/dismiss`, { method: 'POST' })
      if (!res.ok) {
        const j = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(j.error ?? `却下失敗 (${res.status})`)
      }
      toast.success('受信を却下しました')
      setConfirmOpen(false)
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
      const json = (await res.json().catch(() => ({}))) as { status?: string; error?: string }
      if (!res.ok) throw new Error(json.error ?? `読み取りに失敗しました (${res.status})`)

      if (json.status === 'ai_failed') {
        toast.error('もう一度読み取りましたが、失敗しました（理由はカードに出ます）')
      } else if (json.status === 'not_order') {
        toast('注文書ではないと判定されました', { icon: '⚠️' })
      } else {
        toast.success('読み取りが終わりました')
      }
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '読み取りに失敗しました')
    } finally {
      setRetrying(false)
    }
  }

  return (
    <>
      {hasR2Key && (
        <a
          href={`/admin/orders/new?receipt=${receiptId}`}
          className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-harvest-400 bg-harvest-50 px-3 text-xs font-bold text-harvest-700 hover:bg-harvest-100"
        >
          <ScanLine className="h-3.5 w-3.5" aria-hidden />
          注文の受付で読み取る
        </a>
      )}
      {status === 'ai_failed' && (
        <button
          type="button"
          onClick={handleRetry}
          disabled={retrying}
          className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-line-strong bg-bg-card px-3 text-xs font-medium text-ink hover:bg-bg-soft disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${retrying ? 'animate-spin' : ''}`} aria-hidden />
          {retrying ? '読み取り中…' : 'もう一度読み取る'}
        </button>
      )}
      <button
        type="button"
        onClick={() => setConfirmOpen(true)}
        disabled={dismissing}
        className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-line-strong bg-bg-card px-3 text-xs font-medium text-ink-soft hover:bg-bg-soft disabled:opacity-50"
      >
        <X className="h-3.5 w-3.5" aria-hidden />
        {dismissing ? '処理中…' : '却下'}
      </button>
      <ConfirmModal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={handleDismiss}
        title="この受信を却下しますか？"
        message="リストから消えます（原本の画像・PDFは保持されます。取り消せません）。"
        confirmLabel="却下する"
        isLoading={dismissing}
      />
    </>
  )
}
