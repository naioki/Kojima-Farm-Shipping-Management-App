'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Check } from 'lucide-react'
import toast from 'react-hot-toast'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'

/** 「納入先なし（取引先あて）」を表す選択値（納入先IDと衝突しない値）。 */
const NO_DESTINATION = '__none__'

interface DestinationOption {
  id: string
  label: string
}

/** いつもと違う数量の明細（承認前に確認ダイアログを出す）。 */
export interface ApproveAnomaly {
  productName: string
  quantity: number
  unit: string
  usualQuantity: number
  kind: 'high' | 'low'
}

interface ApproveOrderButtonProps {
  orderId: string
  /** 納品日が未確定なら true。承認前に日付入力を求める。 */
  needsDeliveryDate: boolean
  /** 納入先が未確定（取引先に納入先があるのに未選択）なら true。承認前に選択を求める。 */
  needsDestination?: boolean
  destinationOptions?: DestinationOption[]
  /** FAX・メモに書かれていた納入先の文字（マスタと照合できなかったときの参考表示） */
  destinationHint?: string | null
  /** 荷姿が未選択の品目名。1件でもあれば承認ボタンを無効にして、ボタンの近くに全部出す。 */
  missingPackProducts?: string[]
  /** いつもと違う数量の明細。あれば承認前に「○○ 300P（いつもは30P前後）でよいですか？」と確認する。 */
  anomalies?: ApproveAnomaly[]
  /** やさしい日本語ラベル（スタッフ向けに大きく出す等）。 */
  label?: string
  size?: 'sm' | 'md' | 'lg'
  /** 現場向けのやさしい日本語で案内する */
  kana?: boolean
}

function fmtQty(n: number): string {
  return Math.round(n).toLocaleString()
}

/**
 * 注文承認ボタン。pending_review → approved（収穫タスク生成）。
 * 納品日・納入先が未確定なら、その場で入れてから承認する（harvest_tasks・出荷一覧の表示に必須）。
 * 荷姿の選び忘れは押す前に止め、いつもと違う数量は押したときに確認する。
 */
export function ApproveOrderButton({
  orderId,
  needsDeliveryDate,
  needsDestination = false,
  destinationOptions = [],
  destinationHint = null,
  missingPackProducts = [],
  anomalies = [],
  label = '承認する',
  size = 'sm',
  kana = false,
}: ApproveOrderButtonProps) {
  const router = useRouter()
  const [date, setDate] = useState('')
  const [destinationId, setDestinationId] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  // 画面の判定とサーバーの判定がずれた場合（他の人がマスタを変えた等）に備え、サーバーが求めたら選択欄を出す
  const [forceDestination, setForceDestination] = useState(false)
  const showDestination = (needsDestination || forceDestination) && destinationOptions.length > 0
  const destinationMissing = showDestination && !destinationId
  const dateMissing = needsDeliveryDate && !/^\d{4}-\d{2}-\d{2}$/.test(date)
  const packMissing = missingPackProducts.length > 0
  const blocked = packMissing || destinationMissing || dateMissing

  const blockers: string[] = []
  if (dateMissing) blockers.push(kana ? 'のうひん日を いれてください' : '納品日を入れてください')
  if (destinationMissing) blockers.push(kana ? 'のうにゅうさきを えらんでください' : '納入先を選んでください')
  if (packMissing)
    blockers.push(`${kana ? 'にすがたを えらんでください' : '荷姿を選んでください'}: ${missingPackProducts.join('・')}`)

  async function approve() {
    setConfirmOpen(false)
    setBusy(true)
    try {
      const body: Record<string, string | boolean> = {}
      if (needsDeliveryDate) body.delivery_date = date
      if (destinationId === NO_DESTINATION) body.no_destination = true
      else if (destinationId) body.destination_id = destinationId
      const res = await fetch(`/api/orders/${orderId}/approve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        error?: string
        reason?: string
        tasksCreated?: number
      }
      if (!res.ok) {
        if (json.reason === 'destination_required') setForceDestination(true)
        throw new Error(json.error ?? `承認できませんでした (${res.status})`)
      }
      toast.success(`承認しました（収穫・パックの予定 ${json.tasksCreated ?? 0} 件）`)
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '承認に失敗しました')
    } finally {
      setBusy(false)
    }
  }

  function onClick() {
    if (blocked) return
    if (anomalies.length > 0) {
      setConfirmOpen(true)
      return
    }
    void approve()
  }

  const inputCls =
    'h-10 min-w-0 rounded border border-line-strong bg-bg-card px-2 text-sm text-ink focus:outline-none focus:border-trust-500 focus:ring-2 focus:ring-trust-100'

  return (
    <div className="flex min-w-0 flex-col items-stretch gap-2 sm:items-end">
      {(needsDeliveryDate || showDestination) && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {needsDeliveryDate && (
            <label className="flex items-center gap-1.5 text-xs font-bold text-ink-soft">
              {kana ? 'のうひん日' : '納品日'}
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className={cn(inputCls, size === 'lg' && 'h-12')}
              />
            </label>
          )}
          {showDestination && (
            <label className="flex min-w-0 flex-col gap-1 text-xs font-bold text-ink-soft sm:items-end">
              <span className="flex items-center gap-1.5">
                {kana ? 'のうにゅうさき' : '納入先'}
                {destinationHint && (
                  <span className="font-normal text-ink-faint">
                    （FAXの記載: {destinationHint}）
                  </span>
                )}
              </span>
              <select
                value={destinationId}
                onChange={(e) => setDestinationId(e.target.value)}
                className={cn(inputCls, 'w-full sm:w-auto', size === 'lg' && 'h-12', !destinationId && 'border-alert/60')}
              >
                <option value="">{kana ? 'えらんでください' : '納入先を選んでください'}</option>
                {destinationOptions.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label}
                  </option>
                ))}
                <option value={NO_DESTINATION}>納入先なし（取引先あて）</option>
              </select>
            </label>
          )}
        </div>
      )}
      <Button
        variant="primary"
        size={size}
        onClick={onClick}
        isLoading={busy}
        disabled={blocked}
        aria-describedby={blocked ? `approve-blockers-${orderId}` : undefined}
        className="min-h-10"
      >
        <Check className="h-4 w-4" aria-hidden />
        {label}
      </Button>
      {blocked && (
        <ul id={`approve-blockers-${orderId}`} className="space-y-0.5 text-xs font-bold text-alert sm:text-right">
          {blockers.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      )}

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={kana ? 'かず を たしかめて ください' : '数量を確かめてください'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmOpen(false)}>
              {kana ? 'もどって なおす' : '戻って直す'}
            </Button>
            <Button variant="primary" onClick={() => void approve()}>
              <Check className="h-4 w-4" aria-hidden />
              {kana ? 'このまま しょうにん' : 'このまま承認する'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="flex items-start gap-2 text-sm font-bold text-alert">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            {kana ? 'いつもと だいぶ ちがう かず です。' : 'いつもと大きく違う数量があります。'}
          </p>
          <ul className="space-y-1.5">
            {anomalies.map((a) => (
              <li key={a.productName} className="rounded-lg border border-alert/40 bg-alert-bg px-3 py-2 text-sm text-ink">
                <span className="font-bold">{a.productName}</span>{' '}
                <span className="num font-mono font-bold tabular-nums">
                  {fmtQty(a.quantity)}
                  {a.unit}
                </span>
                <span className="text-ink-soft">
                  （いつもは{fmtQty(a.usualQuantity)}
                  {a.unit}前後）
                </span>
                {kana ? ' で いいですか？' : ' でよいですか？'}
              </li>
            ))}
          </ul>
          <p className="text-xs text-ink-soft">
            {kana
              ? 'FAX の よみまちがい（30 → 300 など）が おおいです。げんぽん を みて たしかめてください。'
              : 'FAXの読み違い（30→300 など）がよくあります。原本と見比べてから承認してください。'}
          </p>
        </div>
      </Modal>
    </div>
  )
}
