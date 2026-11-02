'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ChevronDown, Check, AlertTriangle, ShieldCheck, Trash2, Undo2, ArrowUpToLine, ChevronUp } from 'lucide-react'
import toast from 'react-hot-toast'
import { cn } from '@/lib/cn'
import type { FieldStatus, SpecWarning } from '@/types/database'
import { ColorDot } from '@/components/ui/ColorDot'
import { FIELD_STATUS_META } from '@/lib/field/tap-loop'
import { rowStatusKey, type RowStatusKey } from '@/lib/field/shipment-sort'
import { ConfirmModal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { PackInstructions, type PackInstructionValues, type PackInstructionPhoto } from '@/components/admin/PackInstructions'
import { fieldErrorMessage } from '@/lib/field/net-error'
import type { ReceiptOriginalInfo } from '@/lib/orders/pending'
import { useOutbox } from '@/hooks/useOutbox'
import { jstTodayStr, shiftDateStr } from '@/lib/dates'
import { extractActionableNote, extractChangeDiffBadge } from '@/lib/field/clean-note'
import { useFieldLang } from '@/lib/field/lang-context'
import {
  getThaiContainer,
  getContainerColorEmoji,
  getBagEmoji,
  getTapeColorEmoji,
  getThaiSpec,
  THAI_LABELS,
} from '@/lib/field/thai-dict'

const UNDO_GRACE_MS = 5000

export interface ShipmentRowProps {
  itemId: string
  customerName: string
  customerColor?: string | null
  destinationId?: string | null
  destinationName?: string | null
  departureTime?: string | null
  shippingRouteName?: string | null
  quantityText: string
  orderedQty: number
  initialStatus: FieldStatus
  initialVersion: number
  initialSpec: string | null
  initialContainer: string | null
  initialHasCard: boolean | null
  initialLineNote: string | null
  initialShippedQty: number | null
  initialFieldNote: string | null
  specWarnings?: SpecWarning[] | null
  masterLabelSpec?: string | null
  masterTapeColor?: string | null
  masterPackingNotes?: string | null
  masterPacksPerCase?: number | null
  needsManualConfirm?: boolean
  packInstructions?: PackInstructionValues | null
  packPhotos?: PackInstructionPhoto[]
  customerId?: string | null
  productId?: string
  canEditRulesDirectly?: boolean
  canReportSpec?: boolean
  bagType?: string | null
  sealText?: string | null
  hasSeal?: boolean | null
  deliveryDate?: string
  isAdmin?: boolean
  isNextDay?: boolean
  isNextUp?: boolean
  onMoveToTop?: () => void
  onMoveUp?: () => void
  onMoveDown?: () => void
  showShippingButton?: boolean
  receipt?: ReceiptOriginalInfo | null
  onStatusChange?: (itemId: string, newStatus: FieldStatus, newVersion: number) => void
  onStatusSettled?: (itemId: string, status: RowStatusKey) => void
  onDeleted?: (itemId: string) => void
  onShippedQtyChange?: (itemId: string, newQty: number | null) => void
  onOrderedQtyChange?: (itemId: string, newOrderedQty: number) => void
  onDetailsChange?: (itemId: string, newSpec: string | null, newContainer: string | null) => void
}

function buildUnifiedMemo(lineNote?: string | null, fieldNote?: string | null): string {
  const cleanLine = extractActionableNote(lineNote ?? '')
  const cleanField = (fieldNote ?? '').trim()
  if (cleanField && cleanLine) {
    if (cleanField.includes(cleanLine)) return cleanField
    if (cleanLine.includes(cleanField)) return cleanLine
    return `${cleanField} / ${cleanLine}`
  }
  return cleanField || cleanLine || ''
}

export function ShipmentRow({
  itemId,
  customerName,
  customerColor,
  destinationName,
  orderedQty: initialOrderedQty,
  initialStatus,
  initialVersion,
  initialSpec,
  initialContainer,
  initialHasCard,
  initialLineNote,
  initialShippedQty,
  initialFieldNote,
  specWarnings,
  masterLabelSpec,
  masterTapeColor,
  masterPackingNotes,
  masterPacksPerCase,
  needsManualConfirm,
  packInstructions,
  packPhotos,
  bagType: initialBagType,
  sealText: initialSealText,
  hasSeal: initialHasSeal,
  deliveryDate,
  productId,
  onMoveToTop,
  onMoveUp,
  onMoveDown,
  showShippingButton = false,
  isNextDay = false,
  isNextUp = false,
  receipt,
  onStatusChange,
  onStatusSettled,
  onDeleted,
  onShippedQtyChange,
  onOrderedQtyChange,
  onDetailsChange,
}: ShipmentRowProps) {
  const router = useRouter()
  const { enqueue } = useOutbox()
  const { isThaiMode } = useFieldLang()
  const [status, setStatus] = useState<FieldStatus>(initialStatus)
  const [version, setVersion] = useState(initialVersion)
  const [orderedQty, setOrderedQty] = useState<number>(initialOrderedQty)
  const [busy, setBusy] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [offlinePending, setOfflinePending] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [specConfirmOpen, setSpecConfirmOpen] = useState(false)
  const [partialPackConfirmOpen, setPartialPackConfirmOpen] = useState(false)
  const [nextDayPackConfirmOpen, setNextDayPackConfirmOpen] = useState(false)
  const [undoGrace, setUndoGrace] = useState<{ from: FieldStatus } | null>(null)
  const undoTimerRef = useRef<number | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // 詳細アコーディオン（最上段：途中数 ＆ 一本化メモ、中段：注文数の直接変更、下段：原本 ＆ 荷姿・シール・袋・順序移動）
  const [open, setOpen] = useState(false)
  const [spec, setSpec] = useState(initialSpec ?? '')
  const [container, setContainer] = useState(initialContainer ?? '')
  const [hasCard, setHasCard] = useState(Boolean(initialHasCard))
  const [hasSeal, setHasSeal] = useState<boolean | null>(initialHasSeal ?? null)
  const [sealText, setSealText] = useState<string>(initialSealText ?? (initialHasSeal ? 'シールあり' : ''))
  const [bagType, setBagType] = useState<string>(initialBagType ?? '')
  const [shippedQty, setShippedQty] = useState(initialShippedQty == null ? '' : String(initialShippedQty))
  const [memoText, setMemoText] = useState(() => buildUnifiedMemo(initialLineNote, initialFieldNote))
  const [savingQuick, setSavingQuick] = useState(false)
  const [savingNote, setSavingNote] = useState(false)
  const [savingDetails, setSavingDetails] = useState(false)
  const [savingOrderQty, setSavingOrderQty] = useState(false)
  const [expandedWhenDone, setExpandedWhenDone] = useState(false)

  const meta = FIELD_STATUS_META[status]
  const isDone = status === 'packed' || status === 'shipped'
  const changeDiffBadge = extractChangeDiffBadge(initialLineNote ?? '')
  const shippedNum = shippedQty.trim() === '' ? null : Number(shippedQty)
  const isPartial = shippedNum != null && Number.isFinite(shippedNum) && shippedNum > 0 && shippedNum < orderedQty

  let packsPerCase = masterPacksPerCase ?? null
  if (!packsPerCase || packsPerCase <= 0) {
    const combinedSpec = `${customerName} ${spec || masterLabelSpec || ''}`.normalize('NFKC')
    const match = combinedSpec.match(/(?:入数|1箱|1ケース)\s*(\d+)|(\d+)\s*(?:入|パック|P)/i)
    if (match) {
      const parsedNum = Number(match[1] || match[2])
      if (Number.isFinite(parsedNum) && parsedNum > 0 && parsedNum <= 200) {
        packsPerCase = parsedNum
      }
    }
    if (!packsPerCase || packsPerCase <= 0) {
      if (combinedSpec.includes('農業総合研究所') || combinedSpec.includes('NSK')) {
        packsPerCase = 24
      } else {
        packsPerCase = 20
      }
    }
  }

  const [editOrderBoxes, setEditOrderBoxes] = useState<string>(() =>
    String(Math.floor(initialOrderedQty / packsPerCase)),
  )
  const [editOrderPacks, setEditOrderPacks] = useState<string>(() => String(initialOrderedQty))

  const fullCases = Math.floor(orderedQty / packsPerCase)
  const loosePacks = orderedQty % packsPerCase
  const casesText = String(fullCases)
  const looseText = String(loosePacks)
  const partialCases = shippedNum != null && packsPerCase > 0 ? Math.floor(shippedNum / packsPerCase) : 0
  const remainingPacks = shippedNum != null ? Math.max(0, orderedQty - shippedNum) : orderedQty
  const remainingCases = packsPerCase > 0 ? Math.ceil(remainingPacks / packsPerCase) : 0

  useEffect(() => {
    if (!busy && !undoGrace) {
      setStatus(initialStatus)
      setVersion(initialVersion)
    }
  }, [initialStatus, initialVersion, busy, undoGrace])

  useEffect(() => {
    setOrderedQty(initialOrderedQty)
    setEditOrderBoxes(String(Math.floor(initialOrderedQty / packsPerCase)))
    setEditOrderPacks(String(initialOrderedQty))
  }, [initialOrderedQty, packsPerCase])

  useEffect(() => {
    setShippedQty(initialShippedQty == null ? '' : String(initialShippedQty))
  }, [initialShippedQty])

  useEffect(() => {
    setMemoText(buildUnifiedMemo(initialLineNote, initialFieldNote))
  }, [initialLineNote, initialFieldNote])

  useEffect(() => {
    return () => {
      if (undoTimerRef.current != null) window.clearTimeout(undoTimerRef.current)
    }
  }, [])

  function startUndoGrace(from: FieldStatus, settled: FieldStatus) {
    if (undoTimerRef.current != null) window.clearTimeout(undoTimerRef.current)
    setUndoGrace({ from })
    undoTimerRef.current = window.setTimeout(() => {
      undoTimerRef.current = null
      setUndoGrace(null)
      onStatusSettled?.(itemId, rowStatusKey(settled, isPartial ? shippedNum : null, orderedQty))
      router.refresh()
    }, UNDO_GRACE_MS)
  }

  async function advanceTo(target: FieldStatus) {
    if (busy || status === target) return
    const prev = status
    setStatus(target)
    setBusy(true)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8000)
    try {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        throw new TypeError('Failed to fetch (offline)')
      }
      const res = await fetch(`/api/order-items/${itemId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ field_status: target, version }),
        signal: controller.signal,
      })
      clearTimeout(timer)
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
      setOfflinePending(false)
      onStatusChange?.(itemId, target, json.item.version)
      startUndoGrace(prev, target)
    } catch (e: unknown) {
      clearTimeout(timer)
      const err = e as { name?: string } | null
      const isNetworkOrAbort =
        (typeof navigator !== 'undefined' && !navigator.onLine) ||
        err?.name === 'AbortError' ||
        e instanceof TypeError
      if (isNetworkOrAbort) {
        try {
          await enqueue({
            itemId,
            fieldStatus: target,
            version,
            ts: Date.now(),
          })
          setOfflinePending(true)
          toast('圏外のため一時保存しました（電波復帰時に自動送信）', { icon: '📡' })
          onStatusChange?.(itemId, target, version)
          startUndoGrace(prev, target)
          return
        } catch (enqueueErr) {
          console.error('Failed to enqueue outbox', enqueueErr)
        }
      }
      setStatus(prev)
      toast.error(fieldErrorMessage(e, '更新に失敗しました'))
    } finally {
      setBusy(false)
    }
  }

  async function undoAdvance() {
    const graceSnap = undoGrace
    if (undoTimerRef.current != null) {
      window.clearTimeout(undoTimerRef.current)
      undoTimerRef.current = null
    }
    setUndoGrace(null)
    if ((offlinePending || (typeof navigator !== 'undefined' && !navigator.onLine)) && graceSnap) {
      setStatus(graceSnap.from)
      try {
        await enqueue({
          itemId,
          fieldStatus: graceSnap.from,
          version,
          ts: Date.now(),
        })
      } catch (err) {
        console.error('Failed to enqueue offline undo', err)
      }
      onStatusChange?.(itemId, graceSnap.from, version)
      onStatusSettled?.(
        itemId,
        rowStatusKey(graceSnap.from, isPartial ? shippedNum : null, orderedQty),
      )
      return
    }
    await reset()
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
      onStatusChange?.(itemId, json.item.field_status, json.item.version)
      onStatusSettled?.(
        itemId,
        rowStatusKey(json.item.field_status, isPartial ? shippedNum : null, orderedQty),
      )
      router.refresh()
    } catch (e) {
      setStatus(prev)
      toast.error(fieldErrorMessage(e, '戻す操作に失敗しました'))
    } finally {
      setBusy(false)
      setConfirmOpen(false)
    }
  }

  async function deleteItem() {
    setDeleting(true)
    try {
      const res = await fetch(`/api/order-items/${itemId}`, { method: 'DELETE' })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error ?? `削除に失敗 (${res.status})`)
      }
      toast.success('明細を削除しました')
      setDeleteOpen(false)
      onDeleted?.(itemId)
      router.refresh()
    } catch (e) {
      toast.error(fieldErrorMessage(e, '削除に失敗しました'))
    } finally {
      setDeleting(false)
    }
  }

  async function savePartialQty(overrideVal?: number | null) {
    const rawVal = overrideVal !== undefined ? overrideVal : shippedNum != null && Number.isFinite(shippedNum) ? shippedNum : null
    const val = rawVal != null && rawVal > 0 ? Math.min(orderedQty, rawVal) : null
    setSavingQuick(true)
    try {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        throw new TypeError('Failed to fetch (offline)')
      }
      const res = await fetch(`/api/order-items/${itemId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          shipped_qty: val,
          version,
        }),
      })
      if (res.status === 409) {
        setConflict(true)
        toast.error('競合しました。画面を更新してください')
        return
      }
      if (!res.ok) throw new Error(`保存に失敗 (${res.status})`)
      const json = (await res.json()) as { item: { version: number } }
      setVersion(json.item.version)
      onShippedQtyChange?.(itemId, val)
      toast.success(val ? `途中数（${val}P）を記録しました` : '途中数をクリアしました')
      router.refresh()
    } catch (e) {
      const isOfflineErr = (typeof navigator !== 'undefined' && !navigator.onLine) || e instanceof TypeError
      if (isOfflineErr) {
        try {
          await enqueue({
            itemId,
            shippedQty: val,
            version,
            ts: Date.now(),
          })
          setOfflinePending(true)
          onShippedQtyChange?.(itemId, val)
          toast('電波が弱い場所のため「途中数」を一時保存しました（復帰時に自動反映）', { icon: '📡' })
          return
        } catch (enqErr) {
          console.error('Failed to enqueue shipped_qty', enqErr)
        }
      }
      toast.error(fieldErrorMessage(e, '保存に失敗しました'))
    } finally {
      setSavingQuick(false)
    }
  }

  async function saveUnifiedMemo() {
    setSavingNote(true)
    const trimmed = memoText.trim() || null
    try {
      const res = await fetch(`/api/order-items/${itemId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          field_note: trimmed,
          line_note: trimmed,
          version,
        }),
      })
      if (res.status === 409) {
        setConflict(true)
        toast.error('競合しました。画面を更新してください')
        return
      }
      if (!res.ok) throw new Error(`保存に失敗 (${res.status})`)
      const json = (await res.json()) as { item: { version: number } }
      setVersion(json.item.version)
      toast.success(trimmed ? 'メモ・伝達事項を保存しました' : 'メモをクリアしました')
      router.refresh()
    } catch (e) {
      toast.error(fieldErrorMessage(e, 'メモの保存に失敗しました'))
    } finally {
      setSavingNote(false)
    }
  }

  /** #09 注文数（箱数/パック数）のその場直接変更 */
  async function saveDirectOrderedQty() {
    const newPacks = Math.max(0, parseInt(editOrderPacks, 10) || 0)
    if (newPacks <= 0) {
      toast.error('注文数を0にする場合は下の「削除」ボタンを押してください')
      return
    }
    if (newPacks === orderedQty) {
      toast('注文数は変更されていません', { icon: 'ℹ️' })
      return
    }
    setSavingOrderQty(true)
    try {
      const res = await fetch(`/api/order-items/${itemId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          quantity: newPacks,
          version,
        }),
      })
      if (res.status === 409) {
        setConflict(true)
        toast.error('競合しました。画面を更新してください')
        return
      }
      if (!res.ok) throw new Error(`注文数の変更に失敗 (${res.status})`)
      const json = (await res.json()) as { item: { version: number; field_status: FieldStatus; shipped_qty: number | null } }
      setVersion(json.item.version)
      setOrderedQty(newPacks)
      setStatus(json.item.field_status)
      setShippedQty(json.item.shipped_qty == null ? '' : String(json.item.shipped_qty))
      onOrderedQtyChange?.(itemId, newPacks)
      onStatusChange?.(itemId, json.item.field_status, json.item.version)
      toast.success(
        packsPerCase
          ? `注文数を ${Math.floor(newPacks / packsPerCase)}箱（${newPacks}P）に変更しました`
          : `注文数を ${newPacks}Pに変更しました`
      )
      router.refresh()
    } catch (e) {
      toast.error(fieldErrorMessage(e, '注文数の変更に失敗しました'))
    } finally {
      setSavingOrderQty(false)
    }
  }

  function handleSaveDetails() {
    if (spec !== initialSpec || container !== initialContainer) {
      setSpecConfirmOpen(true)
    } else {
      executeSaveDetails()
    }
  }

  async function executeSaveDetails() {
    setSavingDetails(true)
    const trimmedMemo = memoText.trim() || null
    const valQty = shippedNum != null && Number.isFinite(shippedNum) && shippedNum > 0 ? shippedNum : null
    try {
      const res = await fetch(`/api/order-items/${itemId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          spec: spec || null,
          container_type: container || null,
          has_card: hasCard,
          has_seal: hasSeal,
          seal_text: sealText.trim() || null,
          bag_type: bagType.trim() || null,
          line_note: trimmedMemo,
          field_note: trimmedMemo,
          shipped_qty: valQty,
          version,
        }),
      })
      if (res.status === 409) {
        setConflict(true)
        toast.error('競合しました。画面を更新してください')
        return
      }
      if (!res.ok) throw new Error(`保存に失敗 (${res.status})`)
      const json = (await res.json()) as { item: { version: number } }
      setVersion(json.item.version)
      onShippedQtyChange?.(itemId, valQty)
      onDetailsChange?.(itemId, spec || null, container || null)
      if ((spec && spec !== initialSpec) || (container && container !== initialContainer)) {
        toast.success('荷姿・規格・シール設定を保存し、学習ルールへ反映しました 💡')
      } else {
        toast.success('変更を保存しました')
      }
      router.refresh()
    } catch (e) {
      toast.error(fieldErrorMessage(e, '保存に失敗しました'))
    } finally {
      setSavingDetails(false)
    }
  }

  const fieldInput =
    'h-10 w-full rounded-lg border border-line-strong bg-white px-3 text-sm text-ink focus:outline-none focus:border-forest-600 focus:ring-2 focus:ring-forest-100'

  const todayStr = jstTodayStr()
  const tomorrowStr = shiftDateStr(todayStr, 1)

  const isTodayOrder = deliveryDate === todayStr && !isNextDay
  const isTomorrowOrder = deliveryDate === tomorrowStr && !isNextDay
  const isFutureOrNextDay = isNextDay || Boolean(deliveryDate && deliveryDate > tomorrowStr)

  const isCollapsedDone =
    isDone && !expandedWhenDone && !open && !undoGrace && !conflict

  const viewerHref = receipt?.originalUrl
    ? `${receipt.originalUrl}${productId && !receipt.originalUrl.includes('product=') ? `${receipt.originalUrl.includes('?') ? '&' : '?'}product=${productId}` : ''}`
    : receipt?.id
    ? `/field/viewer/${receipt.id}?date=${deliveryDate ?? ''}${productId ? `&product=${productId}` : ''}`
    : null

  return (
    <div
      className={cn(
        'rounded-2xl border shadow-sm transition-all duration-200',
        isCollapsedDone ? 'px-3.5 py-2.5' : 'p-3.5',
        isFutureOrNextDay
          ? 'border-slate-300 bg-slate-100/95 text-slate-800 shadow-xs'
          : isTodayOrder
          ? status === 'shipped'
            ? 'border-sky-400 bg-sky-100/80'
            : status === 'packed'
            ? 'border-sky-300 bg-sky-50/80 ring-1 ring-sky-300'
            : 'border-sky-300 bg-sky-50/60 shadow-xs'
          : isTomorrowOrder
          ? status === 'shipped'
            ? 'border-emerald-400 bg-emerald-100/80'
            : status === 'packed'
            ? 'border-emerald-300 bg-emerald-50/80 ring-1 ring-emerald-300'
            : 'border-emerald-300/80 bg-white shadow-xs'
          : status === 'shipped'
          ? 'border-sky-300 bg-sky-50/30'
          : status === 'packed'
          ? 'border-emerald-300 bg-emerald-50/30'
          : 'border-line bg-white shadow-xs',
        isNextUp && !isDone && !isFutureOrNextDay
          ? 'ring-2 ring-emerald-600 border-emerald-600 bg-white shadow-md'
          : '',
        conflict ? 'animate-pulse-alert border-alert ring-2 ring-alert/20' : '',
      )}
    >
      {conflict && (
        <div className="mb-2.5 flex items-center justify-between rounded-xl bg-alert/10 border border-alert/30 p-2.5 text-xs font-bold text-alert">
          <span className="flex items-center gap-1.5">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            他で更新されたため競合しました
          </span>
          <button
            type="button"
            onClick={() => {
              setConflict(false)
              router.refresh()
            }}
            className="flex items-center gap-1 rounded-lg bg-alert text-white px-2.5 py-1 text-xs font-bold shadow-xs hover:bg-alert/90 transition-colors"
          >
            🔄 最新データを反映
          </button>
        </div>
      )}

      {offlinePending && (
        <div className="mb-2 flex items-center gap-1.5 rounded-lg bg-amber-50 border border-amber-200 px-2.5 py-1 text-[11px] font-bold text-amber-800">
          <span>📡 圏外のため一時保存中（電波復帰時に自動送信されます）</span>
        </div>
      )}

      {isCollapsedDone ? (
        <div
          onClick={() => setExpandedWhenDone(true)}
          className="flex items-center justify-between gap-2 cursor-pointer select-none"
          title="タップしてカードを展開"
        >
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span className="inline-flex items-center gap-0.5 rounded-md bg-emerald-600 px-2 py-0.5 text-xs font-black text-white shrink-0 shadow-2xs">
              <Check className="h-3.5 w-3.5" />
              <span>{status === 'shipped' ? '出荷済' : '済'}</span>
            </span>
            <ColorDot color={customerColor} name={customerName} size="sm" />
            <span className="font-black text-ink text-sm sm:text-base truncate">
              {customerName}
            </span>
            {destinationName && customerName !== destinationName && (
              <span className="inline-flex items-center gap-0.5 rounded bg-emerald-100/90 border border-emerald-300 px-1.5 py-0.5 text-xs font-black text-emerald-900 shrink-0">
                <span>▶</span>
                <span className="truncate max-w-[120px] sm:max-w-[180px]">{destinationName}</span>
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <span className="num text-sm sm:text-base font-black text-ink tabular-nums">
              {casesText}箱
              {loosePacks > 0 ? `+${looseText}P` : ''}
              <span className="text-xs font-bold text-ink-soft ml-1">
                ({orderedQty}P)
              </span>
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={(e) => {
                e.stopPropagation()
                setConfirmOpen(true)
              }}
              className="h-8 rounded-lg border border-line-strong bg-white px-2.5 text-xs font-bold text-ink-soft hover:bg-bg-soft active:scale-95 transition"
              title="未完了に戻す"
            >
              <span>戻す</span>
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setExpandedWhenDone(true)
              }}
              className="h-8 w-8 rounded-lg border border-line bg-white/80 flex items-center justify-center text-ink-soft hover:text-ink"
              title="カードを展開"
              aria-label="カードを展開"
            >
              <ChevronDown className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* ① 見出し情報 */}
          <div className="space-y-1.5 pb-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                {isNextUp && !isDone && !isFutureOrNextDay && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-emerald-700 px-2 py-0.5 text-[11px] font-black text-white shadow-2xs">
                    <span>🔥 次</span>
                  </span>
                )}
                <ColorDot color={customerColor} name={customerName} size="md" />
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="font-black text-ink text-lg sm:text-xl tracking-tight">
                    {customerName}
                  </span>
                  {destinationName && customerName !== destinationName && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-emerald-50 border border-emerald-300 text-emerald-900 font-black text-sm sm:text-base tracking-tight shadow-2xs">
                      <span className="text-emerald-700 text-xs">▶</span>
                      {destinationName}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-1">
                {changeDiffBadge && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-amber-500 text-white px-2 py-0.5 text-xs font-black shadow-2xs">
                    <span>🔄 {changeDiffBadge}</span>
                  </span>
                )}
                {needsManualConfirm && !changeDiffBadge && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 border border-amber-300 px-2 py-0.5 text-xs font-black text-amber-900">
                    ⚠️ 要確認
                  </span>
                )}
                {isDone && expandedWhenDone && (
                  <button
                    type="button"
                    onClick={() => setExpandedWhenDone(false)}
                    className="rounded-lg border border-line bg-white px-2 py-0.5 text-xs font-bold text-ink-soft hover:bg-bg-soft"
                  >
                    1行に畳む ▲
                  </button>
                )}
              </div>
            </div>

            {/* 規格 ＋ 資材レシピタグ */}
            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
              <span className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1 text-xs sm:text-sm font-black text-ink border border-slate-300">
                {isThaiMode && getThaiSpec(spec || masterLabelSpec, masterPacksPerCase) ? (
                  <>
                    <span>📐 {getThaiSpec(spec || masterLabelSpec, masterPacksPerCase)}</span>
                    <span className="text-[11px] font-bold text-ink-muted">({spec || masterLabelSpec || '標準規格'})</span>
                  </>
                ) : (
                  <span>📐 {spec || masterLabelSpec || '標準規格'}</span>
                )}
              </span>

              {container && (
                <span className="inline-flex items-center gap-1 rounded-lg bg-sky-50 px-2.5 py-1 text-xs sm:text-sm font-black text-sky-950 border border-sky-300">
                  {isThaiMode && getThaiContainer(container) ? (
                    <>
                      <span>{getContainerColorEmoji(container)} {getThaiContainer(container)}</span>
                      <span className="text-[11px] font-bold text-sky-700">({container})</span>
                    </>
                  ) : (
                    <span>
                      {getContainerColorEmoji(container)}{' '}
                      {container === '農業総研専用折りたたみコンテナ' ? 'NSKオリコン' : container}
                    </span>
                  )}
                </span>
              )}

              {(hasSeal || sealText) && (
                <span className="inline-flex items-center gap-1 rounded-lg bg-rose-50 px-2.5 py-1 text-xs sm:text-sm font-black text-rose-900 border border-rose-300">
                  <span>🏷️ {sealText || 'シールあり'}</span>
                </span>
              )}
              {hasSeal === false && (
                <span className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-1 text-xs font-bold text-slate-600 border border-slate-300">
                  <span>シールなし</span>
                </span>
              )}

              {hasCard && (
                <span className="inline-flex items-center gap-1 rounded-lg bg-indigo-50 px-2.5 py-1 text-xs sm:text-sm font-black text-indigo-900 border border-indigo-300">
                  <span>🃏 カード有</span>
                </span>
              )}

              {bagType && (
                <span className="inline-flex items-center gap-1 rounded-lg bg-amber-50 px-2.5 py-1 text-xs sm:text-sm font-black text-amber-950 border border-amber-300">
                  <span>{getBagEmoji(bagType)} {bagType}</span>
                </span>
              )}

              {masterTapeColor && (
                <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2.5 py-1 text-xs sm:text-sm font-black text-emerald-950 border border-emerald-300">
                  <span>{getTapeColorEmoji(masterTapeColor)} テープ: {masterTapeColor}</span>
                </span>
              )}
            </div>

            {isPartial && (
              <button
                type="button"
                onClick={() => setOpen(true)}
                className="w-full mt-1 rounded-xl border-2 border-amber-400 bg-amber-50 hover:bg-amber-100/80 px-3 py-1.5 text-left flex items-center justify-between gap-2 transition"
              >
                <span className="text-xs sm:text-sm font-black text-amber-950 flex items-center gap-1.5">
                  <span>⏳ 途中経過:</span>
                  <span className="underline decoration-amber-500">
                    {partialCases}箱（{shippedNum}P）完了
                  </span>
                </span>
                <span className="rounded-md bg-amber-600 text-white px-2 py-0.5 text-xs font-black shrink-0">
                  残り {remainingCases}箱（{remainingPacks}P）✎
                </span>
              </button>
            )}

            {(memoText || masterPackingNotes) && (
              <button
                type="button"
                onClick={() => setOpen(true)}
                className="w-full mt-1 rounded-xl border-l-4 border-orange-500 bg-orange-50 hover:bg-orange-100/70 px-3 py-1.5 text-left text-xs font-bold text-orange-950 flex items-center justify-between gap-2 transition"
              >
                <span className="flex items-center gap-1.5">
                  <span>📝</span>
                  <span>{[memoText, masterPackingNotes].filter(Boolean).join(' / ')}</span>
                </span>
                <span className="text-[10px] font-black text-orange-800 shrink-0 underline">編集</span>
              </button>
            )}
          </div>

          {/* ② 統合数量ブロック（箱数を特大表示 ＋ 総パック数を並置） */}
          <div
            className={cn(
              'rounded-xl px-4 py-2.5 text-white mb-2.5 shadow-sm transition-colors flex flex-wrap items-center justify-between gap-2',
              isFutureOrNextDay
                ? 'bg-[#334155] border border-slate-500/30'
                : isTodayOrder
                ? 'bg-[#0369a1] border border-sky-600/30'
                : 'bg-[#1b5e20]',
            )}
          >
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="text-xs font-black text-white/85 tracking-wide">
                {isThaiMode ? `${THAI_LABELS.casesUnit} (箱数)` : '箱数'}
              </span>
              <span className="num text-3xl sm:text-4xl font-black tracking-tight text-white tabular-nums leading-none">
                {casesText}
                <span className="text-base sm:text-xl font-black text-emerald-200 ml-1">
                  {isThaiMode ? 'ลัง (箱)' : '箱'}
                </span>
              </span>
              {loosePacks > 0 && (
                <span className="rounded-lg bg-amber-300 text-amber-950 px-2 py-0.5 text-xs sm:text-sm font-black shadow-2xs">
                  ＋端数 {looseText}P (1箱)
                </span>
              )}
            </div>

            <div className="flex items-baseline gap-1.5 rounded-lg bg-black/20 border border-white/15 px-3 py-1 tabular-nums">
              <span className="text-[11px] font-bold text-white/80">総数</span>
              <span className="num text-lg sm:text-xl font-black text-white">
                {orderedQty.toLocaleString()}
              </span>
              <span className="text-xs font-bold text-white/90">P</span>
              <span className="text-[11px] font-bold text-white/70 ml-0.5">
                ({packsPerCase}入)
              </span>
            </div>
          </div>

          {/* ③ 下部スマート2ボタンバー */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (status === 'not_started') {
                  if (isPartial) {
                    setPartialPackConfirmOpen(true)
                    return
                  }
                  if (isFutureOrNextDay) {
                    setNextDayPackConfirmOpen(true)
                    return
                  }
                  advanceTo('packed')
                } else if (status === 'packed') {
                  setConfirmOpen(true)
                }
              }}
              className={cn(
                'min-h-[48px] h-12 flex-1 rounded-xl px-4 text-sm sm:text-base font-black shadow-xs transition-all active:scale-[0.98]',
                status === 'packed'
                  ? 'bg-emerald-600 text-white ring-2 ring-emerald-600 ring-offset-1'
                  : status === 'shipped'
                  ? 'border border-line bg-bg-soft/70 text-ink-muted'
                  : isFutureOrNextDay
                  ? 'border-2 border-slate-500 bg-white text-slate-800 hover:bg-slate-100'
                  : 'border-2 border-emerald-600 bg-white text-emerald-800 hover:bg-emerald-50',
              )}
            >
              {status === 'packed' ? (
                <span>✓ パック済{isThaiMode ? ` (${THAI_LABELS.packDone})` : ''}</span>
              ) : isFutureOrNextDay ? (
                <span>📅 先行分をパック済にする</span>
              ) : (
                <span>✓ パック済にする{isThaiMode ? ` (${THAI_LABELS.packDoneAction})` : ''}</span>
              )}
            </button>

            {showShippingButton && (
              <button
                type="button"
                disabled={busy || status === 'not_started'}
                onClick={() => {
                  if (status === 'packed') {
                    advanceTo('shipped')
                  } else if (status === 'shipped') {
                    setConfirmOpen(true)
                  }
                }}
                className={cn(
                  'min-h-[48px] h-12 rounded-xl px-3.5 text-xs sm:text-sm font-black shadow-xs transition-all active:scale-[0.98]',
                  status === 'shipped'
                    ? 'bg-sky-600 text-white ring-2 ring-sky-600 ring-offset-1'
                    : status === 'packed'
                    ? 'border-2 border-sky-600/60 bg-white text-sky-800 hover:bg-sky-50'
                    : 'border border-line bg-bg-soft/40 text-ink-muted opacity-50 cursor-not-allowed',
                )}
              >
                {status === 'shipped' ? '✓ 出荷済' : '出荷済'}
              </button>
            )}

            <button
              type="button"
              onClick={() => setOpen(!open)}
              className={cn(
                'min-h-[48px] h-12 shrink-0 rounded-xl border px-3.5 text-xs sm:text-sm font-black shadow-xs transition-all inline-flex items-center gap-1',
                open
                  ? 'border-forest-700 bg-forest-700 text-white'
                  : isPartial || memoText
                  ? 'border-amber-400 bg-amber-50 text-amber-950 hover:bg-amber-100'
                  : 'border-line-strong bg-white text-ink hover:bg-bg-soft',
              )}
              title={open ? '詳細を閉じる' : '途中数・メモ・詳細を開く'}
            >
              <span>{open ? '閉じる' : '詳細・途中数'}</span>
              <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} />
            </button>
          </div>
        </>
      )}

      {undoGrace && (
        <div
          data-guide="undo-bar"
          className="mt-2 flex items-center justify-between gap-2 rounded-xl border border-harvest-200 bg-harvest-50/80 px-3 py-2"
        >
          <span className="flex items-center gap-1.5 text-xs font-bold text-harvest-700">
            <Check className="h-4 w-4" aria-hidden />
            <span>{meta.label}に更新しました</span>
          </span>
          <button
            type="button"
            onClick={undoAdvance}
            disabled={busy}
            className="inline-flex min-h-[40px] h-10 shrink-0 items-center gap-1.5 rounded-xl border border-line-strong bg-white px-3 text-xs font-black text-ink hover:bg-bg-soft active:scale-95 transition"
          >
            <Undo2 className="h-3.5 w-3.5" aria-hidden />
            <span>元に戻す</span>
          </button>
        </div>
      )}

      {specWarnings && specWarnings.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-xl border border-warning/40 bg-warning-bg/40 p-2">
          {specWarnings.map((w, i) =>
            w.type === 'forbidden' ? (
              <span key={i} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-bold text-alert bg-alert/10">
                <AlertTriangle className="h-3 w-3" aria-hidden />
                {w.text}
              </span>
            ) : (
              <span key={i} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-bold text-harvest-700 bg-harvest-50">
                <ShieldCheck className="h-3 w-3" aria-hidden />
                {w.text}
              </span>
            ),
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* ▼ 詳細アコーディオン（最上段：①途中数 ＆ ②一本化メモ、中段：③注文数の直接変更、下段：④荷姿・シール・袋・順序移動） */}
      {/* ===================================================================== */}
      {open && (
        <div className="mt-3 space-y-3 border-t-2 border-line pt-3 animate-in fade-in duration-150">
          {/* 【最上段①】⏳ 途中数（できた数）の記録バー */}
          <div className="rounded-xl border border-amber-300 bg-amber-50/70 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-black text-amber-950 flex items-center gap-1.5">
                <span>⏳ 途中数（いまできた数）の記録</span>
              </span>
              <span className="text-xs font-bold text-amber-900">
                目標: {casesText}箱（{orderedQty}P）
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  const cur = parseInt(shippedQty, 10) || 0
                  const step = packsPerCase && packsPerCase > 0 ? packsPerCase : 20
                  setShippedQty(String(Math.max(0, cur - step)))
                }}
                className="min-h-[42px] h-10 px-3 rounded-xl bg-white hover:bg-slate-100 text-ink border border-line-strong text-xs font-black active:scale-95 transition"
              >
                -1箱 (-{packsPerCase}P)
              </button>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                className={cn(fieldInput, 'num h-10 w-24 tabular-nums font-black text-center')}
                value={shippedQty}
                onChange={(e) => setShippedQty(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                    e.preventDefault()
                    savePartialQty()
                  }
                }}
                placeholder="パック数"
              />
              <button
                type="button"
                onClick={() => {
                  const cur = parseInt(shippedQty, 10) || 0
                  const step = packsPerCase && packsPerCase > 0 ? packsPerCase : 20
                  setShippedQty(String(Math.min(orderedQty, cur + step)))
                }}
                className="min-h-[42px] h-10 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black active:scale-95 transition shadow-2xs"
              >
                +1箱 (+{packsPerCase}P)
              </button>
              <div className="ml-auto flex items-center gap-1.5">
                {shippedQty !== '' && (
                  <button
                    type="button"
                    onClick={() => {
                      setShippedQty('')
                      void savePartialQty(null)
                    }}
                    className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-xs text-ink-soft hover:bg-bg-soft font-bold"
                  >
                    クリア
                  </button>
                )}
                <Button size="sm" onClick={() => savePartialQty()} isLoading={savingQuick}>
                  途中数を保存
                </Button>
              </div>
            </div>
          </div>

          {/* 【最上段②】📝 メモ・伝達事項（1つに一本化！） */}
          <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-black text-blue-950">
                📝 メモ・伝達事項（現場メモ・内訳・注意事項）
              </span>
              {memoText.trim() !== '' && (
                <button
                  type="button"
                  onClick={() => setMemoText('')}
                  className="text-xs text-ink-soft hover:text-ink font-bold underline"
                >
                  クリア
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                className={cn(fieldInput, 'flex-1 h-10 text-sm font-bold text-ink')}
                value={memoText}
                onChange={(e) => setMemoText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                    e.preventDefault()
                    saveUnifiedMemo()
                  }
                }}
                placeholder="例: ライフ近畿40箱 / サンプラザ20箱、20箱で中断、午前便優先など"
              />
              <Button size="sm" onClick={saveUnifiedMemo} isLoading={savingNote} className="shrink-0 h-10 px-3.5">
                メモ保存
              </Button>
            </div>
          </div>

          {/* 【中段 #09】📦 注文数そのものの直接変更（モーダルを開かずに箱数/パック数を即変更） */}
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-black text-emerald-950">
                📦 注文数の直接変更（電話変更・減数など）
              </span>
              <span className="text-[11px] font-bold text-emerald-800">
                1箱 ＝ {packsPerCase} P
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={editOrderBoxes}
                  onChange={(e) => {
                    const b = e.target.value
                    setEditOrderBoxes(b)
                    const bNum = parseInt(b, 10)
                    if (!isNaN(bNum) && bNum >= 0) {
                      setEditOrderPacks(String(bNum * packsPerCase))
                    }
                  }}
                  className={cn(fieldInput, 'num h-10 w-20 text-center font-black')}
                />
                <span className="text-xs font-black text-ink">箱</span>
              </div>
              <span className="text-xs font-bold text-ink-muted">＝</span>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={editOrderPacks}
                  onChange={(e) => {
                    const p = e.target.value
                    setEditOrderPacks(p)
                    const pNum = parseInt(p, 10)
                    if (!isNaN(pNum) && pNum >= 0 && packsPerCase > 0) {
                      setEditOrderBoxes(String(Math.floor(pNum / packsPerCase)))
                    }
                  }}
                  className={cn(fieldInput, 'num h-10 w-24 text-center font-black')}
                />
                <span className="text-xs font-black text-ink">P</span>
              </div>
              <Button
                size="sm"
                onClick={saveDirectOrderedQty}
                isLoading={savingOrderQty}
                className="ml-auto h-10 px-3.5"
              >
                注文数を変更
              </Button>
            </div>
          </div>

          {/* 📄 受注原本 */}
          {receipt?.hasOriginal && viewerHref && (
            <div className="rounded-xl border border-trust-200 bg-trust-50/60 p-2.5 flex items-center justify-between gap-3">
              <span className="text-xs font-black text-trust-900">📄 受注原本（FAX・注文書画像）</span>
              <Link
                href={viewerHref}
                className="h-8 px-3 rounded-lg bg-trust-700 text-white text-xs font-black shadow-2xs hover:bg-trust-800 active:scale-95 transition flex items-center gap-1 shrink-0"
              >
                <span>原本を見る</span>
              </Link>
            </div>
          )}

          {packInstructions && (
            <PackInstructions values={packInstructions} photos={packPhotos ?? []} variant="field" />
          )}

          {/* 【下段 #10】🏷️ 荷姿・規格・シール・袋種別の変更 ＆ 作業順移動 ＆ 明細削除 */}
          <div className="rounded-xl border border-line bg-bg-soft/40 p-3 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-black text-ink-soft">🏷️ 荷姿・規格・シール・袋 ／ 作業順の移動</span>
              {(onMoveToTop || onMoveUp || onMoveDown) && (
                <div className="flex items-center gap-1">
                  {onMoveToTop && !isNextUp && !isDone && (
                    <button
                      type="button"
                      onClick={() => onMoveToTop()}
                      disabled={busy}
                      className="h-7 px-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black flex items-center gap-1 shadow-2xs"
                    >
                      <ArrowUpToLine className="h-3.5 w-3.5" />
                      <span>最上段へ</span>
                    </button>
                  )}
                  {onMoveUp && (
                    <button
                      type="button"
                      onClick={() => onMoveUp()}
                      disabled={busy}
                      className="h-7 px-2 rounded-lg border border-line bg-white text-xs font-bold text-ink hover:bg-bg-soft flex items-center gap-0.5"
                    >
                      <ChevronUp className="h-3.5 w-3.5" />
                      <span>上へ</span>
                    </button>
                  )}
                  {onMoveDown && (
                    <button
                      type="button"
                      onClick={() => onMoveDown()}
                      disabled={busy}
                      className="h-7 px-2 rounded-lg border border-line bg-white text-xs font-bold text-ink hover:bg-bg-soft flex items-center gap-0.5"
                    >
                      <ChevronDown className="h-3.5 w-3.5" />
                      <span>下へ</span>
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <label className="space-y-1">
                <span className="text-[11px] font-bold text-ink-soft">容器・コンテナ</span>
                <input
                  className={fieldInput}
                  value={container}
                  onChange={(e) => setContainer(e.target.value)}
                  placeholder="青コン / 茶コン / 段ボール / NSKオリコン"
                />
              </label>
              <label className="space-y-1">
                <span className="text-[11px] font-bold text-ink-soft">規格</span>
                <input
                  className={fieldInput}
                  value={spec}
                  onChange={(e) => setSpec(e.target.value)}
                  placeholder="200gUP (入数24) / 2〜3株 (入数20)"
                />
              </label>
            </div>

            {/* #10 シール有無・表記 ＆ 袋種別のワンタップ切替 */}
            <div className="grid gap-2 sm:grid-cols-2 pt-0.5">
              <div className="space-y-1">
                <span className="text-[11px] font-bold text-ink-soft block">シール有無・表記</span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      const next = !hasSeal
                      setHasSeal(next)
                      setSealText(next ? (sealText && sealText !== 'シールなし' ? sealText : 'シールあり') : 'シールなし')
                    }}
                    className={cn(
                      'h-9 px-2.5 rounded-lg border text-xs font-black shrink-0 transition',
                      hasSeal
                        ? 'border-rose-400 bg-rose-50 text-rose-900'
                        : 'border-line bg-white text-ink-muted',
                    )}
                  >
                    {hasSeal ? '🏷️ シールあり' : 'シールなし'}
                  </button>
                  <input
                    className={cn(fieldInput, 'h-9 text-xs')}
                    value={sealText}
                    onChange={(e) => {
                      setSealText(e.target.value)
                      if (e.target.value.trim() && e.target.value !== 'シールなし') {
                        setHasSeal(true)
                      }
                    }}
                    placeholder="シール表記（任意）"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <span className="text-[11px] font-bold text-ink-soft block">袋種別</span>
                <div className="flex flex-wrap items-center gap-1">
                  {['印字袋(FG)', '無地袋', '指定なし'].map((bt) => {
                    const val = bt === '指定なし' ? '' : bt
                    const active = bagType === val
                    return (
                      <button
                        key={bt}
                        type="button"
                        onClick={() => setBagType(val)}
                        className={cn(
                          'h-9 px-2.5 rounded-lg border text-xs font-bold transition',
                          active
                            ? 'border-amber-500 bg-amber-50 text-amber-950 font-black'
                            : 'border-line bg-white text-ink-soft hover:bg-bg-soft',
                        )}
                      >
                        {bt}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 pt-1">
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={hasCard}
                    onChange={(e) => setHasCard(e.target.checked)}
                    className="h-4 w-4 accent-forest-600 rounded"
                  />
                  <span className="text-xs font-bold text-ink">カード同梱</span>
                </label>
                {!isThaiMode && (
                  <button
                    type="button"
                    onClick={() => setDeleteOpen(true)}
                    className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-bold text-alert hover:bg-alert/10"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    <span>削除</span>
                  </button>
                )}
              </div>
              <Button size="sm" onClick={handleSaveDetails} isLoading={savingDetails}>
                荷姿・規格を保存
              </Button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        open={partialPackConfirmOpen}
        onClose={() => setPartialPackConfirmOpen(false)}
        onConfirm={async () => {
          setPartialPackConfirmOpen(false)
          await advanceTo('packed')
        }}
        title="⚠️ 途中数が記録されています。全数パック済にしますか？"
        message={`受注数 ${orderedQty}P（${casesText}箱）に対し、現在 途中数 ${shippedNum ?? 0}P が記録されています。全数（${orderedQty}P）の袋詰めが完了した場合のみ「パック済にする」を押してください。`}
        confirmLabel={`全${orderedQty}P完了としてパック済にする`}
        isLoading={busy}
      />

      <ConfirmModal
        open={nextDayPackConfirmOpen}
        onClose={() => setNextDayPackConfirmOpen(false)}
        onConfirm={async () => {
          setNextDayPackConfirmOpen(false)
          await advanceTo('packed')
        }}
        title="📅 先行作業分（翌日以降出荷）をパック済にしますか？"
        message={`このカードは「${deliveryDate ?? '翌日以降'} 出荷分」の先行枠です。本日の出荷分と間違えていないか確認のうえ確定してください。`}
        confirmLabel="先行分をパック済にする"
        isLoading={busy}
      />

      <ConfirmModal
        open={specConfirmOpen}
        onClose={() => setSpecConfirmOpen(false)}
        onConfirm={async () => {
          setSpecConfirmOpen(false)
          await executeSaveDetails()
        }}
        title="規格・荷姿を変更しますか？"
        message="規格や荷姿を変更すると、パック進捗や出荷集計に直接影響します。変更して保存しますか？"
        confirmLabel="変更して保存"
        isLoading={savingDetails}
      />

      <ConfirmModal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={reset}
        title="ステータスを未完了に戻しますか？"
        message={`「${customerName} / ${casesText}箱 (${orderedQty}P)」を ${meta.label} から1段戻します。`}
        confirmLabel="戻す"
        isLoading={busy}
      />

      <ConfirmModal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={deleteItem}
        title="この明細を削除しますか？"
        message={`「${customerName} / ${casesText}箱 (${orderedQty}P)」を削除します。この操作は取り消せません。`}
        confirmLabel="削除する"
        isLoading={deleting}
      />
    </div>
  )
}
