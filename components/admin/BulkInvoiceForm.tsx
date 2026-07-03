'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Layers } from 'lucide-react'
import toast from 'react-hot-toast'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { jstDateStr as iso } from '@/lib/dates'

const firstOfMonth = () => {
  const d = new Date()
  return iso(new Date(d.getFullYear(), d.getMonth(), 1))
}

/** 全取引先まとめて請求書を作成（月次一括）。対象明細が無い/作成済みの取引先は自動スキップ。 */
export function BulkInvoiceForm() {
  const router = useRouter()
  const [from, setFrom] = useState(firstOfMonth())
  const [to, setTo] = useState(iso(new Date()))
  const [busy, setBusy] = useState(false)

  async function run() {
    if (from > to) {
      toast.error('開始日は終了日以前にしてください')
      return
    }
    setBusy(true)
    try {
      const res = await fetch('/api/invoices/generate-bulk', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ period_start: from, period_end: to }),
      })
      const j = (await res.json().catch(() => ({}))) as {
        created_count?: number
        skipped_count?: number
        error?: string
      }
      if (!res.ok) throw new Error(j.error ?? `一括作成に失敗 (${res.status})`)
      toast.success(`${j.created_count ?? 0}件作成・${j.skipped_count ?? 0}件スキップ`)
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '一括作成に失敗しました')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      <Input label="開始日" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
      <Input label="終了日" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
      <Button onClick={run} isLoading={busy} size="lg" variant="secondary">
        <Layers className="h-4 w-4" aria-hidden />
        全取引先まとめて作成
      </Button>
    </div>
  )
}
