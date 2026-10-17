'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check } from 'lucide-react'
import toast from 'react-hot-toast'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/Button'

interface DestinationOption {
  id: string
  label: string
}

interface ApproveOrderButtonProps {
  orderId: string
  /** 納品日が未確定なら true。承認前に日付入力を求める。 */
  needsDeliveryDate: boolean
  /** 納入先が未確定（取引先に納入先があるのに未選択）なら true。承認前に選択を求める。 */
  needsDestination?: boolean
  destinationOptions?: DestinationOption[]
  /** やさしい日本語ラベル（スタッフ向けに大きく出す等）。 */
  label?: string
  size?: 'sm' | 'md' | 'lg'
}

/**
 * 注文承認ボタン。pending_review → approved（収穫タスク生成）。
 * 納品日・納入先が未確定なら、その場で入れてから承認する（harvest_tasks・出荷一覧の表示に必須）。
 */
export function ApproveOrderButton({
  orderId,
  needsDeliveryDate,
  needsDestination = false,
  destinationOptions = [],
  label = '承認する',
  size = 'sm',
}: ApproveOrderButtonProps) {
  const router = useRouter()
  const [date, setDate] = useState('')
  const [destinationId, setDestinationId] = useState('')
  const [busy, setBusy] = useState(false)

  async function approve() {
    if (needsDeliveryDate && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      toast.error('納品日を入れてください')
      return
    }
    if (needsDestination && !destinationId) {
      toast.error('納入先を選んでください')
      return
    }
    setBusy(true)
    try {
      const body: Record<string, string> = {}
      if (needsDeliveryDate) body.delivery_date = date
      if (needsDestination) body.destination_id = destinationId
      const res = await fetch(`/api/orders/${orderId}/approve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = (await res.json()) as { ok?: boolean; error?: string; tasksCreated?: number }
      if (!res.ok) throw new Error(json.error ?? `承認失敗 (${res.status})`)
      toast.success(`承認しました（収穫タスク ${json.tasksCreated ?? 0} 件）`)
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '承認に失敗しました')
    } finally {
      setBusy(false)
    }
  }

  const inputCls =
    'h-10 rounded border border-line-strong bg-bg-card px-2 text-sm text-ink focus:outline-none focus:border-trust-500 focus:ring-2 focus:ring-trust-100'

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {needsDeliveryDate && (
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          aria-label="納品日"
          className={cn(inputCls, size === 'lg' && 'h-12')}
        />
      )}
      {needsDestination && (
        <select
          value={destinationId}
          onChange={(e) => setDestinationId(e.target.value)}
          aria-label="納入先"
          className={cn(inputCls, size === 'lg' && 'h-12')}
        >
          <option value="">納入先を選択</option>
          {destinationOptions.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
            </option>
          ))}
        </select>
      )}
      <Button variant="primary" size={size} onClick={approve} isLoading={busy}>
        <Check className="h-4 w-4" aria-hidden />
        {label}
      </Button>
    </div>
  )
}
