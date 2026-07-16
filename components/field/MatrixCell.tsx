'use client'

import { useState } from 'react'
import { Check, Circle, Truck, Keyboard } from 'lucide-react'
import toast from 'react-hot-toast'
import { cn } from '@/lib/cn'
import type { FieldStatus } from '@/types/database'
import { nextFieldStatus, canAdvance, FIELD_STATUS_META } from '@/lib/field/tap-loop'

const ICONS = { circle: Circle, check: Check, truck: Truck } as const

// Tailwind JIT は実行時生成のクラス名を拾えないため、status→色クラスは literal で持つ。
const STATUS_TEXT: Record<FieldStatus, string> = {
  not_started: 'text-line-strong',
  packed: 'text-harvest-500',
  shipped: 'text-ink-faint',
}

// 紙の運用（パック済み＝数字を○で囲む／出荷済み＝線を引く）をそのまま再現する。
// アイコンだけでなく数字自体の「形」も変えることで、色だけに頼らない（design.md WCAG AA）。
const QTY_SHAPE: Record<FieldStatus, string> = {
  not_started: '',
  packed: 'rounded-full border-2 border-harvest-500 px-1.5',
  shipped: 'line-through decoration-2',
}

export interface MatrixCellProps {
  itemId: string
  initialStatus: FieldStatus
  initialVersion: number
  label: string
  /** 総数表示（"122 / 6c2" など、呼び出し側で整形） */
  quantityText: string
}

/**
 * 圃場マトリックスのセル（features.md §7・安全版タップループ）。
 * タップで前進のみ（shipped で停止）。48px タップターゲット。楽観的にUI即時反映し、
 * version 不一致は赤表示で手動確認を促す（competition は §6 の楽観ロックを流用）。
 */
export function MatrixCell({
  itemId,
  initialStatus,
  initialVersion,
  label,
  quantityText,
}: MatrixCellProps) {
  const [status, setStatus] = useState<FieldStatus>(initialStatus)
  const [version, setVersion] = useState(initialVersion)
  const [conflict, setConflict] = useState(false)
  const [busy, setBusy] = useState(false)

  const meta = FIELD_STATUS_META[status]
  const Icon = ICONS[meta.icon]

  async function handleTap() {
    if (!canAdvance(status) || busy) return
    const target = nextFieldStatus(status)
    const prev = status
    setStatus(target) // 楽観的反映
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
        toast.error('競合しました。最新に更新してください')
        return
      }
      if (!res.ok) throw new Error(`更新失敗: ${res.status}`)
      const json = (await res.json()) as { item: { version: number } }
      setVersion(json.item.version)
      setConflict(false)
    } catch (e) {
      setStatus(prev) // ロールバック
      toast.error(e instanceof Error ? e.message : '更新に失敗しました')
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={handleTap}
      aria-label={`${label} ${meta.label}`}
      aria-busy={busy || undefined}
      className={cn(
        'flex min-h-[48px] min-w-[48px] flex-col items-center justify-center gap-0.5 rounded border p-2 transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-trust-100',
        conflict ? 'animate-pulse-alert border-alert' : 'border-line',
        STATUS_TEXT[status],
      )}
    >
      <Icon className="h-5 w-5" aria-hidden />
      <span className={cn('num text-xs text-ink', QTY_SHAPE[status])}>{quantityText}</span>
      <span className="sr-only">{meta.label}</span>
    </button>
  )
}

/** 部分完了の数量入力トリガ（大型テンキーは後続実装） */
export function PartialQtyButton({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="部分数量を入力"
      className="flex min-h-[48px] min-w-[48px] items-center justify-center rounded border border-line text-ink-soft hover:bg-bg-soft"
    >
      <Keyboard className="h-5 w-5" aria-hidden />
    </button>
  )
}
