'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { ConfirmModal } from '@/components/ui/Modal'

/**
 * 受注（注文）の削除（誤登録の取消・admin）。確認モーダルを挟んでから削除する。
 * 出荷済み・請求確定済みはサーバ側で 409 を返すので、その理由をトーストで見せる。
 */
export function DeleteOrderButton({ orderId, customerName }: { orderId: string; customerName: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  async function handleDelete() {
    setBusy(true)
    try {
      const res = await fetch(`/api/orders/${orderId}`, { method: 'DELETE' })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error ?? `削除に失敗しました (${res.status})`)
      }
      toast.success('受注を削除しました')
      setOpen(false)
      router.push('/admin/orders')
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '削除に失敗しました')
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-alert/40 px-3 py-1.5 text-sm font-medium text-alert transition-colors hover:bg-alert/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-alert/20"
      >
        <Trash2 className="h-4 w-4" aria-hidden />
        削除
      </button>
      <ConfirmModal
        open={open}
        onClose={() => setOpen(false)}
        onConfirm={handleDelete}
        title="この受注を削除しますか？"
        message={`「${customerName}」の受注を明細ごと削除します。この操作は取り消せません。出荷済み・請求確定済みは削除できません。`}
        confirmLabel="削除する"
        isLoading={busy}
      />
    </>
  )
}
