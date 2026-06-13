'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { FilePlus2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { Input } from '@/components/ui/Input'

const iso = (d: Date) => d.toISOString().slice(0, 10)
const firstOfMonth = () => {
  const d = new Date()
  return iso(new Date(d.getFullYear(), d.getMonth(), 1))
}

const ERR: Record<string, string> = {
  no_billable_items: '対象期間に請求できる明細（承認/出荷済み）がありません。',
}

/**
 * 請求書を作成（取引先×任意期間）。開始日〜終了日で集計するので月締め以外（20日締め等）にも対応。
 * 税率別に集計し、欠番なしで採番する（tax.md）。
 */
export function GenerateInvoiceForm({ customers }: { customers: { id: string; name: string }[] }) {
  const router = useRouter()
  const [customerId, setCustomerId] = useState('')
  const [from, setFrom] = useState(firstOfMonth())
  const [to, setTo] = useState(iso(new Date()))
  const [submitting, setSubmitting] = useState(false)

  async function submit() {
    if (!customerId) {
      toast.error('取引先を選択してください')
      return
    }
    if (from > to) {
      toast.error('開始日は終了日以前にしてください')
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch('/api/invoices/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ customer_id: customerId, period_start: from, period_end: to }),
      })
      const j = (await res.json().catch(() => ({}))) as { invoice_id?: string; error?: string }
      if (!res.ok) throw new Error(ERR[j.error ?? ''] ?? j.error ?? `作成に失敗 (${res.status})`)
      toast.success('請求書を作成しました')
      if (j.invoice_id) router.push(`/admin/invoices/${j.invoice_id}`)
      else router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '作成に失敗しました')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_auto] lg:items-end">
      <Select
        label="取引先"
        placeholder="選択"
        value={customerId}
        onChange={(e) => setCustomerId(e.target.value)}
        options={customers.map((c) => ({ value: c.id, label: c.name }))}
      />
      <Input label="開始日" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
      <Input label="終了日" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
      <Button onClick={submit} isLoading={submitting} size="lg">
        <FilePlus2 className="h-4 w-4" aria-hidden />
        請求書を作成
      </Button>
    </div>
  )
}
