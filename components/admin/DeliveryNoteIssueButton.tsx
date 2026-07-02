'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Save } from 'lucide-react'
import toast from 'react-hot-toast'
import { Button } from '@/components/ui/Button'
import type { DeliveryAmountMode } from '@/lib/delivery-notes/amount-mode'

/**
 * 納品書を「発行（保存）」する。現在の明細・取引先名・金額モードを凍結して履歴に残す。
 * 保存後は保存済み詳細（/admin/delivery-notes/[id]）へ遷移し、以後は当時の内容で再印刷できる。
 */
export function DeliveryNoteIssueButton({
  customerId,
  date,
  mode,
  destinationId,
}: {
  customerId: string
  date: string
  mode: DeliveryAmountMode
  /** 納入先で絞り込み中なら、その納入先の明細だけを発行する。 */
  destinationId?: string
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function issue() {
    setBusy(true)
    try {
      const res = await fetch('/api/delivery-notes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          customer_id: customerId,
          delivery_date: date,
          amount_mode: mode,
          destination_id: destinationId || undefined,
        }),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error ?? `発行に失敗 (${res.status})`)
      }
      const j = (await res.json()) as { id: string; note_number: string }
      toast.success(`納品書 ${j.note_number} を発行しました`)
      router.push(`/admin/delivery-notes/${j.id}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '発行に失敗しました')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button onClick={issue} isLoading={busy} size="sm">
      <Save className="h-4 w-4" aria-hidden />
      発行して保存
    </Button>
  )
}
