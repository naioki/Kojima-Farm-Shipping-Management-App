'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, FileDown, Table, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { Button } from '@/components/ui/Button'
import { PrintButton } from '@/components/admin/PrintButton'
import type { InvoiceStatus } from '@/types/database'

/** 請求書の操作（印刷・確定・削除）。印刷ボタン等は print:hidden で印刷時に隠す。 */
export function InvoiceActions({ invoiceId, status }: { invoiceId: string; status: InvoiceStatus }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function finalize() {
    setBusy(true)
    try {
      const res = await fetch(`/api/invoices/${invoiceId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'finalized' }),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error ?? `確定に失敗 (${res.status})`)
      }
      toast.success('請求書を確定しました')
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '確定に失敗しました')
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
        <Button onClick={finalize} isLoading={busy} size="sm">
          <CheckCircle2 className="h-4 w-4" aria-hidden />
          確定する
        </Button>
      )}
      <button
        type="button"
        onClick={handleDelete}
        disabled={deleting}
        className="inline-flex h-8 items-center gap-1 rounded border border-red-200 bg-red-50 px-2.5 text-xs font-semibold text-red-700 hover:bg-red-100 hover:text-red-800 disabled:opacity-50 transition"
        title="この請求書を削除"
      >
        <Trash2 className="h-3.5 w-3.5" aria-hidden />
        {deleting ? '削除中...' : '削除'}
      </button>
    </div>
  )
}
