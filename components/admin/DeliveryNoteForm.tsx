'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { FileText } from 'lucide-react'
import toast from 'react-hot-toast'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { Input } from '@/components/ui/Input'
import { DELIVERY_AMOUNT_MODES, parseAmountMode, type DeliveryAmountMode } from '@/lib/delivery-notes/amount-mode'
import { jstTodayStr as today } from '@/lib/dates'

/** 納品書を表示（取引先×納品日）。その日のその取引先向け明細から伝票を生成する。 */
export function DeliveryNoteForm({
  customers,
  defaultMode = 'full',
}: {
  customers: { id: string; name: string }[]
  /** 金額表示の初期値（設定 DELIVERY_NOTE_AMOUNT_MODE 由来） */
  defaultMode?: DeliveryAmountMode
}) {
  const router = useRouter()
  const [customerId, setCustomerId] = useState('')
  const [date, setDate] = useState(today())
  const [mode, setMode] = useState<DeliveryAmountMode>(defaultMode)

  function open() {
    if (!customerId) {
      toast.error('取引先を選択してください')
      return
    }
    router.push(`/admin/delivery-notes/view?customer=${customerId}&date=${date}&amount=${mode}`)
  }

  return (
    <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
      <Select
        label="取引先"
        placeholder="選択"
        value={customerId}
        onChange={(e) => setCustomerId(e.target.value)}
        options={customers.map((c) => ({ value: c.id, label: c.name }))}
      />
      <Input label="納品日" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="sm:w-44" />
      <Select
        label="金額表示"
        value={mode}
        onChange={(e) => setMode(parseAmountMode(e.target.value))}
        options={DELIVERY_AMOUNT_MODES.map((m) => ({ value: m.value, label: m.label }))}
        className="sm:w-48"
      />
      <Button onClick={open} size="lg">
        <FileText className="h-4 w-4" aria-hidden />
        納品書を表示
      </Button>
    </div>
  )
}
