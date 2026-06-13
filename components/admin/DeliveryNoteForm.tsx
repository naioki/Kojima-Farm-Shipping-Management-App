'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { FileText } from 'lucide-react'
import toast from 'react-hot-toast'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { Input } from '@/components/ui/Input'

const today = () => new Date().toISOString().slice(0, 10)

/** 納品書を表示（取引先×納品日）。その日のその取引先向け明細から伝票を生成する。 */
export function DeliveryNoteForm({ customers }: { customers: { id: string; name: string }[] }) {
  const router = useRouter()
  const [customerId, setCustomerId] = useState('')
  const [date, setDate] = useState(today())

  function open() {
    if (!customerId) {
      toast.error('取引先を選択してください')
      return
    }
    router.push(`/admin/delivery-notes/view?customer=${customerId}&date=${date}`)
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
      <Input label="納品日" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="sm:w-44" />
      <Button onClick={open} size="lg">
        <FileText className="h-4 w-4" aria-hidden />
        納品書を表示
      </Button>
    </div>
  )
}
