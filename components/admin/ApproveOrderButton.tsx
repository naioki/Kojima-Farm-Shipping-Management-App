'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check } from 'lucide-react'
import toast from 'react-hot-toast'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/Button'

interface ApproveOrderButtonProps {
  orderId: string
  /** 納品日が未確定なら true。承認前に日付入力を求める。 */
  needsDeliveryDate: boolean
  /** やさしい日本語ラベル（スタッフ向けに大きく出す等）。 */
  label?: string
  size?: 'sm' | 'md' | 'lg'
}

/**
 * 注文承認ボタン。pending_review → approved（収穫タスク生成）。
 * 納品日が未確定なら、その場で日付を入れてから承認する（harvest_tasks に必須）。
 */
export function ApproveOrderButton({ orderId, needsDeliveryDate, label = '承認する', size = 'sm' }: ApproveOrderButtonProps) {
  const router = useRouter()
  const [date, setDate] = useState('')
  const [busy, setBusy] = useState(false)

  async function approve() {
    if (needsDeliveryDate && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      toast.error('納品日を入れてください')
      return
    }
    setBusy(true)
    try {
      const res = await fetch(`/api/orders/${orderId}/approve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(needsDeliveryDate ? { delivery_date: date } : {}),
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
    <div className="flex items-center gap-2">
      {needsDeliveryDate && (
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          aria-label="納品日"
          className={cn(inputCls, size === 'lg' && 'h-12')}
        />
      )}
      <Button variant="primary" size={size} onClick={approve} isLoading={busy}>
        <Check className="h-4 w-4" aria-hidden />
        {label}
      </Button>
    </div>
  )
}
