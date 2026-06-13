'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { FilePlus2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { Input } from '@/components/ui/Input'

const thisMonth = () => new Date().toISOString().slice(0, 7) // YYYY-MM

const ERR: Record<string, string> = {
  no_billable_items: '対象期間に請求できる明細（承認/出荷済み）がありません。',
}

/** 請求書を作成（取引先×対象月）。月締めで税率別に集計し、欠番なしで採番する（tax.md）。 */
export function GenerateInvoiceForm({ customers }: { customers: { id: string; name: string }[] }) {
  const router = useRouter()
  const [customerId, setCustomerId] = useState('')
  const [month, setMonth] = useState(thisMonth())
  const [submitting, setSubmitting] = useState(false)

  async function submit() {
    if (!customerId) {
      toast.error('取引先を選択してください')
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch('/api/invoices/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ customer_id: customerId, billing_month: month }),
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
    <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
      <Select
        label="取引先"
        placeholder="選択"
        value={customerId}
        onChange={(e) => setCustomerId(e.target.value)}
        options={customers.map((c) => ({ value: c.id, label: c.name }))}
      />
      <Input label="対象月" type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="sm:w-44" />
      <Button onClick={submit} isLoading={submitting} size="lg">
        <FilePlus2 className="h-4 w-4" aria-hidden />
        請求書を作成
      </Button>
    </div>
  )
}
