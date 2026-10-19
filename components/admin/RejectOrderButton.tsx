'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { XCircle, AlertTriangle } from 'lucide-react'
import toast from 'react-hot-toast'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'

interface Props {
  orderId: string
  customerName: string
  deliveryDate?: string | null
  size?: 'sm' | 'md' | 'lg'
}

const REASON_OPTIONS = [
  '重複して届いた（既に登録済み）',
  '取引先からキャンセル連絡があった',
  '注文書ではない（広告・誤送信・案内状）',
  '内容に不備があり再送を依頼した',
  'その他',
]

export function RejectOrderButton({ orderId, customerName, deliveryDate, size = 'md' }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState(REASON_OPTIONS[0])
  const [customReason, setCustomReason] = useState('')
  const [busy, setBusy] = useState(false)

  async function handleReject() {
    setBusy(true)
    try {
      const selectedReason = reason === 'その他' ? (customReason.trim() || 'その他') : reason
      const res = await fetch(`/api/orders/${orderId}/reject`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: selectedReason }),
      })

      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error ?? `却下に失敗しました (${res.status})`)
      }

      toast.success('注文を却下（承認しない）しました')
      setOpen(false)
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '却下に失敗しました')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex items-center gap-1 rounded-lg border border-line-strong bg-white px-2.5 py-1 text-xs font-semibold text-ink-muted hover:border-alert/50 hover:bg-alert/5 hover:text-alert transition-all ${
          size === 'lg' ? 'h-11 px-4 text-sm' : size === 'md' ? 'h-9 px-3 text-xs' : 'h-8 px-2.5 text-xs'
        }`}
      >
        <XCircle className="h-3.5 w-3.5 text-ink-faint group-hover:text-alert" aria-hidden />
        <span>承認しない</span>
      </button>

      <Modal
        open={open}
        onClose={() => !busy && setOpen(false)}
        title="注文を承認せず却下しますか？"
      >
        <div className="space-y-4 p-5">
          <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <div>
              <p className="font-bold">この注文を受注ボックスから取り消します</p>
              <p className="mt-0.5 text-amber-700">
                取引先: <span className="font-semibold">{customerName}</span>
                {deliveryDate && ` ／ 納品日: ${deliveryDate}`}
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-bold text-ink">
              却下の理由（社内記録用）
            </label>
            <div className="space-y-1.5">
              {REASON_OPTIONS.map((opt) => (
                <label
                  key={opt}
                  className="flex items-center gap-2 rounded-lg border border-line/70 p-2.5 text-xs text-ink hover:bg-bg-soft cursor-pointer transition-colors"
                >
                  <input
                    type="radio"
                    name="rejectReason"
                    value={opt}
                    checked={reason === opt}
                    onChange={() => setReason(opt)}
                    className="text-alert focus:ring-alert"
                  />
                  <span>{opt}</span>
                </label>
              ))}
            </div>

            {reason === 'その他' && (
              <input
                type="text"
                placeholder="具体的な理由を入力してください"
                value={customReason}
                onChange={(e) => setCustomReason(e.target.value)}
                className="mt-2 w-full rounded-md border border-line px-3 py-2 text-xs text-ink focus:border-alert focus:outline-none focus:ring-1 focus:ring-alert"
              />
            )}
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-line">
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              もどる
            </Button>
            <button
              type="button"
              disabled={busy}
              onClick={handleReject}
              className="inline-flex items-center justify-center rounded-lg bg-alert px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-alert/90 disabled:opacity-50 transition-all"
            >
              {busy ? '却下処理中…' : '承認せず却下する'}
            </button>
          </div>
        </div>
      </Modal>
    </>
  )
}
