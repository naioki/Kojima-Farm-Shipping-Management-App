'use client'

import { useState } from 'react'
import { ChevronLeft, ChevronRight, Circle, Check, Truck } from 'lucide-react'
import toast from 'react-hot-toast'
import { cn } from '@/lib/cn'
import type { FieldStatus } from '@/types/database'
import { nextFieldStatus, canAdvance, FIELD_STATUS_META } from '@/lib/field/tap-loop'
import { ConfirmModal } from '@/components/ui/Modal'

const ICONS = { circle: Circle, check: Check, truck: Truck } as const

// Tailwind JIT は動的クラス名を拾えないため status→色は literal で持つ（MatrixCell と同方針）。
const STATUS_TEXT: Record<FieldStatus, string> = {
  not_started: 'text-line-strong',
  packed: 'text-trust-500',
  shipped: 'text-harvest-500',
}

export interface ShipmentRowProps {
  itemId: string
  customerName: string
  /** 総数表示（"120" や "6c0" など、呼び出し側で整形） */
  quantityText: string
  initialStatus: FieldStatus
  initialVersion: number
}

/**
 * 出荷一覧の1行（Laravel版 画面2の ◀▶ ステータス変更）。
 * ▶ = 前進（not_started→packed→shipped、安全版タップループ・既存 PATCH）。
 * ◀ = 1段戻す（features.md §7：誤操作防止のため必ず確認ダイアログを挟む・専用 reset API）。
 * 金額は一切表示しない（現場が品目と数量に集中するため・Laravel版の意図）。
 */
export function ShipmentRow({
  itemId,
  customerName,
  quantityText,
  initialStatus,
  initialVersion,
}: ShipmentRowProps) {
  const [status, setStatus] = useState<FieldStatus>(initialStatus)
  const [version, setVersion] = useState(initialVersion)
  const [busy, setBusy] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const meta = FIELD_STATUS_META[status]
  const Icon = ICONS[meta.icon]

  async function advance() {
    if (!canAdvance(status) || busy) return
    const target = nextFieldStatus(status)
    const prev = status
    setStatus(target)
    setBusy(true)
    try {
      const res = await fetch(`/api/order-items/${itemId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ field_status: target, version }),
      })
      if (res.status === 409) {
        setStatus(prev)
        setConflict(true)
        toast.error('競合しました。画面を更新してください')
        return
      }
      if (!res.ok) throw new Error(`更新失敗 (${res.status})`)
      const json = (await res.json()) as { item: { version: number } }
      setVersion(json.item.version)
      setConflict(false)
    } catch (e) {
      setStatus(prev)
      toast.error(e instanceof Error ? e.message : '更新に失敗しました')
    } finally {
      setBusy(false)
    }
  }

  async function reset() {
    const prev = status
    setBusy(true)
    try {
      const res = await fetch(`/api/order-items/${itemId}/reset`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ version }),
      })
      if (res.status === 409) {
        setConflict(true)
        toast.error('競合しました。画面を更新してください')
        return
      }
      if (!res.ok) throw new Error(`戻す操作に失敗 (${res.status})`)
      const json = (await res.json()) as { item: { field_status: FieldStatus; version: number } }
      setStatus(json.item.field_status)
      setVersion(json.item.version)
      setConflict(false)
    } catch (e) {
      setStatus(prev)
      toast.error(e instanceof Error ? e.message : '戻す操作に失敗しました')
    } finally {
      setBusy(false)
      setConfirmOpen(false)
    }
  }

  return (
    <div
      className={cn(
        'flex items-center justify-between gap-3 rounded border px-3 py-2',
        conflict ? 'animate-pulse-alert border-alert' : 'border-line',
      )}
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-ink">{customerName}</p>
        <p className="num text-base font-bold tabular-nums text-ink">{quantityText}</p>
      </div>

      <div className="flex items-center gap-1.5">
        {/* ◀ 1段戻す（確認あり）。not_started では押せない */}
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          disabled={busy || status === 'not_started'}
          aria-label="1段戻す"
          className="flex h-12 w-12 items-center justify-center rounded border border-line text-ink-soft hover:bg-bg-soft disabled:opacity-30 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-trust-100"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden />
        </button>

        {/* 現在ステータス */}
        <span className="flex w-20 flex-col items-center gap-0.5">
          <Icon className={cn('h-5 w-5', STATUS_TEXT[status])} aria-hidden />
          <span className="text-xs text-ink-soft">{meta.label}</span>
        </span>

        {/* ▶ 前進。shipped では押せない */}
        <button
          type="button"
          onClick={advance}
          disabled={busy || !canAdvance(status)}
          aria-label="次のステータスへ進める"
          className="flex h-12 w-12 items-center justify-center rounded border border-line text-ink-soft hover:bg-bg-soft disabled:opacity-30 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-trust-100"
        >
          <ChevronRight className="h-5 w-5" aria-hidden />
        </button>
      </div>

      <ConfirmModal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={reset}
        title="ステータスを1段戻しますか？"
        message={`「${customerName} / ${quantityText}」を ${meta.label} から1段戻します。出荷済みを戻す場合、出荷実績は取り消されます。`}
        confirmLabel="戻す"
        isLoading={busy}
      />
    </div>
  )
}
