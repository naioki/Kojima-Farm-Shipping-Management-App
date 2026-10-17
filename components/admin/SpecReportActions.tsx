'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { Button } from '@/components/ui/Button'

/**
 * 規格報告の処理ボタン（管理者）。対応済み / 却下。
 * 反映（規格マスタの変更）は取引先ページで行う想定で、ここは報告の消し込みのみ。
 */
export function SpecReportActions({ reportId }: { reportId: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState<'handled' | 'dismissed' | null>(null)

  async function update(status: 'handled' | 'dismissed') {
    setBusy(status)
    try {
      const res = await fetch(`/api/spec-reports/${reportId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error ?? `更新失敗 (${res.status})`)
      }
      toast.success(status === 'handled' ? '対応済みにしました' : '却下しました')
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '更新に失敗しました')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex gap-2">
      <Button variant="primary" size="sm" onClick={() => update('handled')} isLoading={busy === 'handled'} disabled={busy !== null}>
        <Check className="h-3.5 w-3.5" aria-hidden />
        対応済み
      </Button>
      <Button variant="secondary" size="sm" onClick={() => update('dismissed')} isLoading={busy === 'dismissed'} disabled={busy !== null}>
        <X className="h-3.5 w-3.5" aria-hidden />
        却下
      </Button>
    </div>
  )
}
