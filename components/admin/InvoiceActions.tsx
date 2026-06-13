'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { Button } from '@/components/ui/Button'
import { PrintButton } from '@/components/admin/PrintButton'
import type { InvoiceStatus } from '@/types/database'

/** 請求書の操作（印刷・確定）。印刷ボタン等は print:hidden で印刷時に隠す。 */
export function InvoiceActions({ invoiceId, status }: { invoiceId: string; status: InvoiceStatus }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

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

  return (
    <div className="flex items-center gap-2 print:hidden">
      <PrintButton />
      {status === 'draft' && (
        <Button onClick={finalize} isLoading={busy} size="sm">
          <CheckCircle2 className="h-4 w-4" aria-hidden />
          確定する
        </Button>
      )}
    </div>
  )
}
