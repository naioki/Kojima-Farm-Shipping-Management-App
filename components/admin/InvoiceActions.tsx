'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, FileDown, Table, Trash2, Send, Wallet, Undo2, Ban } from 'lucide-react'
import toast from 'react-hot-toast'
import { Button } from '@/components/ui/Button'
import { PrintButton } from '@/components/admin/PrintButton'
import type { InvoiceStatus } from '@/types/database'

/** 請求書の操作（印刷・確定・削除）。印刷ボタン等は print:hidden で印刷時に隠す。 */
export function InvoiceActions({ invoiceId, status }: { invoiceId: string; status: InvoiceStatus }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function setStatus(next: InvoiceStatus, done: string, confirmMsg?: string) {
    if (confirmMsg && !window.confirm(confirmMsg)) return
    setBusy(true)
    try {
      const res = await fetch(`/api/invoices/${invoiceId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: next }),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error ?? `更新に失敗 (${res.status})`)
      }
      toast.success(done)
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '更新に失敗しました')
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete() {
    if (!window.confirm('この請求書を削除しますか？\n（削除すると関連する請求明細も削除されます）')) {
      return
    }

    setDeleting(true)
    try {
      const res = await fetch(`/api/invoices/${invoiceId}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error ?? `削除に失敗しました (${res.status})`)
      }
      toast.success('請求書を削除しました')
      router.push('/admin/invoices')
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '削除に失敗しました')
      setDeleting(false)
    }
  }

  return (
    <div className="flex items-center gap-2 print:hidden">
      <a
        href={`/api/invoices/${invoiceId}/pdf`}
        target="_blank"
        rel="noopener"
        className="inline-flex h-8 items-center gap-1.5 rounded border border-line-strong bg-bg-card px-3 text-sm font-medium text-earth-700 hover:bg-earth-50"
      >
        <FileDown className="h-4 w-4" aria-hidden />
        PDF
      </a>
      <a
        href={`/api/invoices/${invoiceId}/csv`}
        className="inline-flex h-8 items-center gap-1.5 rounded border border-line-strong bg-bg-card px-3 text-sm font-medium text-trust-700 hover:bg-trust-50"
        title="マネーフォワード / freee 取り込み用 CSV"
      >
        <Table className="h-4 w-4" aria-hidden />
        CSV
      </a>
      <PrintButton />
      {status === 'draft' && (
        <Button onClick={() => setStatus('finalized', '請求書を確定しました')} isLoading={busy} size="sm">
          <CheckCircle2 className="h-4 w-4" aria-hidden />
          確定する
        </Button>
      )}
      {status === 'finalized' && (
        <Button variant="secondary" onClick={() => setStatus('sent', '送付済にしました')} isLoading={busy} size="sm">
          <Send className="h-4 w-4" aria-hidden />
          送付済にする
        </Button>
      )}
      {(status === 'finalized' || status === 'sent') && (
        <Button
          onClick={() => setStatus('paid', '入金済にしました', '入金を確認しましたか？（入金済にします）')}
          isLoading={busy}
          size="sm"
        >
          <Wallet className="h-4 w-4" aria-hidden />
          入金済にする
        </Button>
      )}
      {status === 'paid' && (
        <Button
          variant="tertiary"
          onClick={() => setStatus('sent', '入金済を取り消しました', '入金済を取り消しますか？')}
          isLoading={busy}
          size="sm"
        >
          <Undo2 className="h-4 w-4" aria-hidden />
          入金を取り消す
        </Button>
      )}
      {/* 下書きは削除できる。確定後は番号と履歴を残すため「無効にする」だけ（tax.md: 欠番禁止） */}
      {status === 'draft' && (
        <button
          type="button"
          onClick={handleDelete}
          disabled={deleting}
          className="inline-flex h-8 items-center gap-1 rounded border border-alert/30 bg-alert-bg px-2.5 text-xs font-semibold text-alert hover:opacity-90 hover:text-alert disabled:opacity-50 transition"
          title="この下書きを削除"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
          {deleting ? '削除中...' : '削除'}
        </button>
      )}
      {(status === 'finalized' || status === 'sent') && (
        <button
          type="button"
          onClick={() =>
            setStatus(
              'void',
              '請求書を無効にしました',
              'この請求書を無効にしますか？\n（番号と履歴は残ります。元に戻せません。明細は再び請求できる状態に戻ります）',
            )
          }
          disabled={busy}
          className="inline-flex h-8 items-center gap-1 rounded border border-alert/30 bg-alert-bg px-2.5 text-xs font-semibold text-alert hover:opacity-90 hover:text-alert disabled:opacity-50 transition"
          title="この請求書を無効にする（削除はしない）"
        >
          <Ban className="h-3.5 w-3.5" aria-hidden />
          無効にする
        </button>
      )}
    </div>
  )
}
