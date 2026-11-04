'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ChevronDown, Check, AlertTriangle, ShieldCheck, Trash2, Undo2 } from 'lucide-react'
import { isSampleOrderText, isGenericOrInvalidContainer } from '@/lib/pipeline/schemas'
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
import {
  extractActionableNote,
  extractChangeDiffBadge,
  formatCleanSpecBadge,
  mergeUserMemoWithSystemTokens,
} from '@/lib/field/clean-note'
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
  onDetailsChange?: (itemId: string, newSpec: string | null, newContainer: string | null, newHasCard?: boolean) => void
}

function buildUnifiedMemo(lineNote?: string | null, fieldNote?: string | null): string {
  const cleanLine = extractActionableNote(lineNote ?? '')
  const cleanField = extractActionableNote(fieldNote ?? '')
  if (cleanField && cleanLine) {
    if (cleanField.includes(cleanLine)) return cleanField
    if (cleanLine.includes(cleanField)) return cleanLine
    return `${cleanField} / ${cleanLine}`
  }
  return cleanField || cleanLine || ''
}

/**
 * 収穫・パックボードの1カードコンポーネント（v5.1.10 重複・不整合完全排除版）。
 * - 【#06 解消】規格バッジから冗長な `(入数20)` を除去し、数量バーの `(20入)` との重複を排除。
 * - 【#07 解消】詳細欄の `<PackInstructions>` でカード表面のバッジが二重描画される問題を排除。
 * - 【#08 解消】端数箱がある注文での総箱数・途中数ステッパー上限の不整合を修正。
 * - 【#09 解消】メモ保存時に `line_note` 内のシステム差分履歴（`165→150P`・`★新規追加`）が消去されるバグを修正。
 */
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
  const [currentLineNote, setCurrentLineNote] = useState<string | null>(initialLineNote)
  const [busy, setBusy] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [offlinePending, setOfflinePending] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [partialPackConfirmOpen, setPartialPackConfirmOpen] = useState(false)
  const [nextDayPackConfirmOpen, setNextDayPackConfirmOpen] = useState(false)
  const [undoGrace, setUndoGrace] = useState<{ from: FieldStatus } | null>(null)
  const undoTimerRef = useRef<number | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const [open, setOpen] = useState(false)
  const [spec, setSpec] = useState(initialSpec ?? '')
  const [container, setContainer] = useState(
    initialContainer && !isGenericOrInvalidContainer(initialContainer) ? initialContainer : '青コン',
  )
  const [hasCard, setHasCard] = useState(Boolean(initialHasCard))
  const [hasSeal, setHasSeal] = useState<boolean | null>(initialHasSeal ?? null)
  const [sealText, setSealText] = useState<string>(initialSealText ?? (initialHasSeal ? 'シールあり' : ''))
  const [bagType, setBagType] = useState<string>(initialBagType ?? '')

  const packsPerCase: number = (() => {
    const combinedSpec = `${customerName} ${spec || masterLabelSpec || ''}`.normalize('NFKC')
    const match = combinedSpec.match(/(?:入数|1箱|1ケース)\s*[:：]?\s*(\d+)|(\d+)\s*入(?:り)?/i)
    if (match) {
      const parsedNum = Number(match[1] || match[2])
      if (Number.isFinite(parsedNum) && parsedNum >= 10 && parsedNum <= 200) {
        return parsedNum
      }
    }
    if (masterPacksPerCase && masterPacksPerCase >= 10) return masterPacksPerCase
    if (combinedSpec.includes('農業総合研究所') || combinedSpec.includes('NSK')) return 24
    if (combinedSpec.includes('オレンジファーム')) return 25
    if (combinedSpec.includes('やなぎさわ') || combinedSpec.includes('ランドローム')) return 10
    return 20
  })()

  const isSampleOrder = isSampleOrderText(destinationName, currentLineNote, initialFieldNote, spec)
  const isSmallSample = isSampleOrder && orderedQty < packsPerCase
  const totalBoxes = isSmallSample ? 0 : Math.ceil(orderedQty / packsPerCase)
  const fullCases = isSmallSample ? 0 : Math.floor(orderedQty / packsPerCase)
  const loosePacks = isSmallSample ? orderedQty : orderedQty % packsPerCase
  const casesText = String(fullCases)
  const looseText = String(loosePacks)

  // 途中数は「箱数」メインで操作・表示
  const [shippedPacks, setShippedPacks] = useState<number | null>(initialShippedQty)
  const [partialBoxesStr, setPartialBoxesStr] = useState<string>(() =>
    initialShippedQty != null && initialShippedQty > 0
      ? String(Math.ceil(initialShippedQty / packsPerCase))
      : '',
  )
  const [memoText, setMemoText] = useState(() => buildUnifiedMemo(initialLineNote, initialFieldNote))
  const [editOrderBoxes, setEditOrderBoxes] = useState<string>(() =>
    String(Math.floor(initialOrderedQty / packsPerCase)),
  )
  const [editOrderPacks, setEditOrderPacks] = useState<string>(() => String(initialOrderedQty))

  const [savingQuick, setSavingQuick] = useState(false)
  const [savingNote, setSavingNote] = useState(false)
  const [savingDetails, setSavingDetails] = useState(false)
  const [expandedWhenDone, setExpandedWhenDone] = useState(false)

  const meta = FIELD_STATUS_META[status]
  const isDone = status === 'packed' || status === 'shipped'
  const changeDiffBadge = extractChangeDiffBadge(currentLineNote ?? '')
  const cleanSpecLabel = formatCleanSpecBadge(spec, masterLabelSpec)
  const isPartial = shippedPacks != null && shippedPacks > 0 && shippedPacks < orderedQty

  const remainingPacks = shippedPacks != null ? Math.max(0, orderedQty - shippedPacks) : orderedQty
  const remainingCases = packsPerCase > 0 ? Math.ceil(remainingPacks / packsPerCase) : 0
  const partialCases = Math.max(0, totalBoxes - remainingCases)

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
    setShippedPacks(initialShippedQty)
    setPartialBoxesStr(
      initialShippedQty != null && initialShippedQty > 0
        ? String(Math.ceil(initialShippedQty / packsPerCase))
        : '',
    )
  }, [initialShippedQty, packsPerCase])

  useEffect(() => {
    setCurrentLineNote(initialLineNote)
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
      onStatusSettled?.(itemId, rowStatusKey(settled, isPartial ? shippedPacks : null, orderedQty))
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
        rowStatusKey(graceSnap.from, isPartial ? shippedPacks : null, orderedQty),
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
        rowStatusKey(json.item.field_status, isPartial ? shippedPacks : null, orderedQty),
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

  /** 途中数（箱数メイン）の保存 */
  async function savePartialBoxes(overrideBoxes?: number | null) {
    const bNum =
      overrideBoxes !== undefined
        ? overrideBoxes
        : partialBoxesStr.trim() === ''
        ? null
        : Math.max(0, parseInt(partialBoxesStr, 10) || 0)
    const ppc = packsPerCase && packsPerCase > 0 ? packsPerCase : 20
    const rawPacks = bNum != null && bNum > 0 ? bNum * ppc : null
    const val = rawPacks != null && rawPacks > 0 ? Math.min(orderedQty, rawPacks) : null
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
      setShippedPacks(val)
      onShippedQtyChange?.(itemId, val)
      toast.success(
        val && bNum ? `途中数 ${bNum}箱（${val}P）を記録しました` : '途中数をクリアしました',
      )
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
          setShippedPacks(val)
          onShippedQtyChange?.(itemId, val)
          toast('電波が弱い場所のため「途中数」を一時保存しました', { icon: '📡' })
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

  /** 一本化メモの即時保存（#09 システム履歴トークンを維持して差分バッジ消滅を防止） */
  async function saveUnifiedMemo() {
    setSavingNote(true)
    const trimmed = memoText.trim() || null
    const mergedLineNote = mergeUserMemoWithSystemTokens(currentLineNote, trimmed)
    try {
      const res = await fetch(`/api/order-items/${itemId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          field_note: trimmed,
          line_note: mergedLineNote,
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
      setCurrentLineNote(mergedLineNote)
      toast.success(trimmed ? 'メモを保存しました' : 'メモをクリアしました')
      router.refresh()
    } catch (e) {
      toast.error(fieldErrorMessage(e, 'メモの保存に失敗しました'))
    } finally {
      setSavingNote(false)
    }
  }

  /** 注文数・荷姿・規格・シール・袋の一括統合保存（#09 システム履歴トークンを維持） */
  async function executeSaveAllSpecsAndQty() {
    const newPacks = Math.max(0, parseInt(editOrderPacks, 10) || 0)
    if (newPacks <= 0) {
      toast.error('注文数を0にする場合は「削除」ボタンを押してください')
      return
    }
    setSavingDetails(true)
    const trimmedMemo = memoText.trim() || null
    const mergedLineNote = mergeUserMemoWithSystemTokens(currentLineNote, trimmedMemo)
    try {
      const res = await fetch(`/api/order-items/${itemId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...(newPacks !== orderedQty ? { quantity: newPacks } : {}),
          spec: spec || null,
          container_type: container || null,
          has_card: hasCard,
          has_seal: hasSeal,
          seal_text: sealText.trim() || null,
          bag_type: bagType.trim() || null,
          line_note: mergedLineNote,
          field_note: trimmedMemo,
          version,
        }),
      })
      if (res.status === 409) {
        setConflict(true)
        toast.error('競合しました。画面を更新してください')
        return
      }
      if (!res.ok) throw new Error(`保存に失敗 (${res.status})`)
      const json = (await res.json()) as {
        item: { version: number; field_status: FieldStatus; shipped_qty: number | null; line_note?: string | null }
      }
      setVersion(json.item.version)
      if (json.item.line_note !== undefined) {
        setCurrentLineNote(json.item.line_note)
      } else {
        setCurrentLineNote(mergedLineNote)
      }
      if (newPacks !== orderedQty) {
        setOrderedQty(newPacks)
        setStatus(json.item.field_status)
        onOrderedQtyChange?.(itemId, newPacks)
        onStatusChange?.(itemId, json.item.field_status, json.item.version)
      }
      onDetailsChange?.(itemId, spec || null, container || null, hasCard)
      toast.success('注文数・仕様の変更を保存しました')
      router.refresh()
    } catch (e) {
      toast.error(fieldErrorMessage(e, '保存に失敗しました'))
    } finally {
      setSavingDetails(false)
    }
  }

  /** 🃏カード・🏷️シール・🛍️袋・🟦コンテナ・📐規格のワンタップ即時切替（自動保存＆AIルール自動学習） */
  async function quickPatchAttributes(patch: {
    has_card?: boolean
    has_seal?: boolean | null
    seal_text?: string | null
    bag_type?: string | null
    container_type?: string | null
    spec?: string | null
  }) {
    setSavingDetails(true)
    const nextCard = patch.has_card !== undefined ? patch.has_card : hasCard
    const nextSeal = patch.has_seal !== undefined ? patch.has_seal : hasSeal
    const nextSealText = patch.seal_text !== undefined ? (patch.seal_text ?? '') : sealText
    const nextBag = patch.bag_type !== undefined ? (patch.bag_type ?? '') : bagType
    const nextCont = patch.container_type !== undefined ? (patch.container_type ?? '') : container
    const nextSpec = patch.spec !== undefined ? (patch.spec ?? '') : spec

    if (patch.has_card !== undefined) setHasCard(nextCard)
    if (patch.has_seal !== undefined) setHasSeal(nextSeal)
    if (patch.seal_text !== undefined) setSealText(nextSealText)
    if (patch.bag_type !== undefined) setBagType(nextBag)
    if (patch.container_type !== undefined) setContainer(nextCont)
    if (patch.spec !== undefined) setSpec(nextSpec)

    try {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        throw new TypeError('Failed to fetch (offline)')
      }
      const res = await fetch(`/api/order-items/${itemId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...patch,
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
      onDetailsChange?.(itemId, nextSpec || null, nextCont || null, nextCard)
      toast.success('設定を即時反映しました（次回から自動適用）', { id: `quick-attr-${itemId}`, duration: 1800 })
      router.refresh()
    } catch (e) {
      const isOfflineErr = (typeof navigator !== 'undefined' && !navigator.onLine) || e instanceof TypeError
      if (isOfflineErr) {
        try {
          await enqueue({
            itemId,
            hasCard: patch.has_card,
            hasSeal: patch.has_seal,
            sealText: patch.seal_text,
            bagType: patch.bag_type,
            containerType: patch.container_type,
            spec: patch.spec,
            version,
            ts: Date.now(),
          })
          setOfflinePending(true)
          onDetailsChange?.(itemId, nextSpec || null, nextCont || null, nextCard)
          toast('圏外のため設定変更を一時保存しました', { icon: '📡' })
          return
        } catch {}
      }
      toast.error(fieldErrorMessage(e, '設定の保存に失敗しました'))
    } finally {
      setSavingDetails(false)
    }
  }

  const fieldInput =
    'h-10 w-full rounded-lg border border-line-strong bg-white px-2.5 text-base sm:text-sm text-ink focus:outline-none focus:border-forest-600 focus:ring-2 focus:ring-forest-100'

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
              {isSmallSample ? (
                <span className="text-purple-800">🧪 サンプル {orderedQty}P</span>
              ) : (
                <>
                  {casesText}箱
                  {loosePacks > 0 ? `+${looseText}P` : ''}
                  <span className="text-xs font-bold text-ink-soft ml-1">
                    ({orderedQty}P)
                  </span>
                </>
              )}
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
          {/* 🧪 サンプル依頼（小口・手渡し／荷上げ用）の特大警告バナー */}
          {isSampleOrder && (
            <div className="mb-2.5 rounded-xl border-2 border-purple-500 bg-gradient-to-r from-purple-700 via-fuchsia-700 to-amber-600 px-3 py-2 text-white shadow-sm flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-lg shrink-0">🧪</span>
                <div className="min-w-0">
                  <div className="text-xs sm:text-sm font-black tracking-wide leading-tight">
                    {isThaiMode
                      ? `${THAI_LABELS.sampleOrder} / サンプル依頼（小口・別口手渡し用）`
                      : 'サンプル依頼（小口・手渡し／荷上げ用）'}
                  </div>
                  <div className="text-[11px] font-bold text-purple-100 truncate">
                    ※ 大口コンテナとは別口で {orderedQty} パック調製してください
                  </div>
                </div>
              </div>
              <span className="shrink-0 rounded-lg bg-amber-300 px-2.5 py-1 text-xs font-black text-purple-950 shadow-2xs">
                バラ {orderedQty}P
              </span>
            </div>
          )}

          {/* ① 見出し情報（薄い区切り線と十分な余白を設け、直下の規格・コンテナバッジとの衝突を完全解消） */}
          <div className="space-y-2.5 pb-3">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-slate-200/80">
              <div className="flex items-center gap-2 flex-wrap min-w-0">
                {isNextUp && !isDone && !isFutureOrNextDay && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-emerald-700 px-2 py-0.5 text-[11px] font-black text-white shadow-2xs shrink-0">
                    <span>🔥 次</span>
                  </span>
                )}
                <ColorDot color={customerColor} name={customerName} size="md" />
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 min-w-0">
                  <span className="font-black text-ink text-base sm:text-xl tracking-tight leading-snug">
                    {customerName}
                  </span>
                  {destinationName && customerName !== destinationName && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg bg-emerald-50 border border-emerald-300 text-emerald-900 font-black text-sm sm:text-base tracking-tight leading-snug shadow-2xs">
                      <span className="text-emerald-700 text-xs">▶</span>
                      <span>{destinationName}</span>
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                {changeDiffBadge && (
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-black shadow-2xs',
                      changeDiffBadge === '新規追加'
                        ? 'bg-emerald-100 border border-emerald-300 text-emerald-900'
                        : 'bg-amber-500 text-white',
                    )}
                  >
                    <span>{changeDiffBadge === '新規追加' ? '✨ 新規' : `🔄 ${changeDiffBadge}`}</span>
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

            {/* 規格 ＋ 資材レシピタグ（#06 規格バッジから冗長な (入数20) を除去し、数量バーの (20入) との重複を解消） */}
            <div className="flex flex-wrap items-center gap-2 pt-0.5">
              <span className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1 text-xs sm:text-sm font-black text-ink border border-slate-300">
                {isThaiMode && getThaiSpec(spec || masterLabelSpec, masterPacksPerCase) ? (
                  <>
                    <span>📐 {getThaiSpec(spec || masterLabelSpec, masterPacksPerCase)}</span>
                    <span className="text-[11px] font-bold text-ink-muted">({cleanSpecLabel})</span>
                  </>
                ) : (
                  <span>📐 {cleanSpecLabel}</span>
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
                    {partialCases}箱（{shippedPacks}P）完了
                  </span>
                </span>
                <span className="rounded-md bg-amber-600 text-white px-2 py-0.5 text-xs font-black shrink-0">
                  残り {remainingCases}箱（{remainingPacks}P）✎
                </span>
              </button>
            )}

            {/* 📝 本当の伝達事項がある時のみ表示 */}
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

          {/* ② 統合数量ブロック（サンプル時はバラパック特大表示、通常時は箱数＋総パック数を並置） */}
          <div
            className={cn(
              'rounded-xl px-4 py-2.5 text-white mb-2.5 shadow-sm transition-colors flex flex-wrap items-center justify-between gap-2',
              isSampleOrder
                ? 'bg-purple-900 border-2 border-amber-300'
                : isFutureOrNextDay
                ? 'bg-[#334155] border border-slate-500/30'
                : isTodayOrder
                ? 'bg-[#0369a1] border border-sky-600/30'
                : 'bg-[#1b5e20]',
            )}
          >
            {isSmallSample ? (
              <div className="flex items-baseline gap-2.5 flex-wrap">
                <span className="rounded-md bg-amber-300 px-2 py-0.5 text-xs font-black text-purple-950">
                  🧪 サンプル（小口バラ）
                </span>
                <span className="num text-3xl sm:text-4xl font-black tracking-tight text-white tabular-nums leading-none">
                  {orderedQty}
                  <span className="text-base sm:text-xl font-black text-amber-200 ml-1.5">
                    {isThaiMode ? `${THAI_LABELS.samplePacks} (パック)` : 'パック（箱なし・バラ）'}
                  </span>
                </span>
              </div>
            ) : (
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
                    ＋端数 {looseText}P (計{totalBoxes}箱)
                  </span>
                )}
              </div>
            )}

            <div className="flex items-baseline gap-1.5 rounded-lg bg-black/20 border border-white/15 px-3 py-1 tabular-nums">
              <span className="text-[11px] font-bold text-white/80">総数</span>
              <span className="num text-lg sm:text-xl font-black text-white">
                {orderedQty.toLocaleString()}
              </span>
              <span className="text-xs font-bold text-white/90">P</span>
              {!isSmallSample && (
                <span className="text-[11px] font-bold text-white/70 ml-0.5">
                  ({packsPerCase}入)
                </span>
              )}
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
      {/* ▼ 超スリム1シート統合型「詳細パネル」（4色の箱やボタンの段落ちを完全排除！） */}
      {/* ===================================================================== */}
      {open && (
        <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/80 p-3 space-y-2.5 animate-in fade-in duration-150">
          {/* ① 1段目：⏳ 途中数の記録（箱数メイン・横1行で完結・段落ちゼロ） */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="font-black text-ink flex items-center gap-1">
                <span>⏳ 途中数（いまできた箱数）</span>
              </span>
              <span className="font-bold text-ink-soft tabular-nums">
                目標 {totalBoxes}箱（{orderedQty}P）
                {partialBoxesStr !== '' && Number(partialBoxesStr) > 0 && (
                  <span className="text-emerald-800 font-black ml-1">
                    ／ 現在 {partialBoxesStr}箱（{Math.min(orderedQty, Number(partialBoxesStr) * packsPerCase)}P）
                  </span>
                )}
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={savingQuick}
                onClick={() => {
                  const cur = parseInt(partialBoxesStr, 10) || 0
                  const next = Math.max(0, cur - 1)
                  setPartialBoxesStr(next === 0 ? '' : String(next))
                  void savePartialBoxes(next === 0 ? null : next)
                }}
                className="min-h-[44px] h-11 px-3 rounded-xl border border-line-strong bg-white hover:bg-slate-100 text-xs sm:text-sm font-black text-ink shrink-0 active:scale-95 transition"
              >
                -1箱
              </button>

              <div className="flex items-center gap-1 bg-white border border-line-strong rounded-xl px-2.5 min-h-[44px] h-11 w-24 shrink-0">
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={Math.max(1, totalBoxes)}
                  value={partialBoxesStr}
                  onChange={(e) => setPartialBoxesStr(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                      e.preventDefault()
                      void savePartialBoxes()
                    }
                  }}
                  placeholder="0"
                  className="num w-full bg-transparent text-center font-black text-base text-ink focus:outline-none"
                />
                <span className="text-xs font-bold text-ink-soft shrink-0">箱</span>
              </div>

              <button
                type="button"
                disabled={savingQuick}
                onClick={() => {
                  const cur = parseInt(partialBoxesStr, 10) || 0
                  const next = Math.min(Math.max(1, totalBoxes), cur + 1)
                  setPartialBoxesStr(String(next))
                  void savePartialBoxes(next)
                }}
                className="min-h-[44px] h-11 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-xs sm:text-sm font-black text-white shrink-0 active:scale-95 transition shadow-2xs"
              >
                +1箱
              </button>

              {partialBoxesStr !== '' && (
                <button
                  type="button"
                  onClick={() => {
                    setPartialBoxesStr('')
                    void savePartialBoxes(null)
                  }}
                  className="min-h-[44px] h-11 px-2 rounded-lg text-xs font-bold text-ink-soft hover:text-ink underline shrink-0"
                >
                  クリア
                </button>
              )}

              <Button
                size="sm"
                onClick={() => savePartialBoxes()}
                isLoading={savingQuick}
                className="ml-auto min-h-[44px] h-11 px-3.5 shrink-0 text-xs font-black"
              >
                記録
              </Button>
            </div>
          </div>

          {/* ② 2段目：📝 メモ・伝達事項（横1行で完結） */}
          <div className="space-y-1 border-t border-slate-200/80 pt-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-black text-ink">📝 メモ・伝達事項</span>
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
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                className={cn(fieldInput, 'flex-1 font-bold')}
                value={memoText}
                onChange={(e) => setMemoText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                    e.preventDefault()
                    void saveUnifiedMemo()
                  }
                }}
                placeholder="内訳（ライフ40/サンプラザ20）・欠品注意など"
              />
              <Button
                size="sm"
                onClick={saveUnifiedMemo}
                isLoading={savingNote}
                className="h-9 px-3 shrink-0 text-xs font-black"
              >
                保存
              </Button>
            </div>
          </div>

          {/* 📄 受注原本リンク（ある時のみ1行で表示） */}
          {receipt?.hasOriginal && viewerHref && (
            <div className="flex items-center justify-between border-t border-slate-200/80 pt-2">
              <span className="text-xs font-bold text-ink-soft">📄 受注原本（FAX・注文書画像）</span>
              <Link
                href={viewerHref}
                className="h-8 px-3 rounded-lg bg-trust-700 text-white text-xs font-black shadow-2xs hover:bg-trust-800 active:scale-95 transition inline-flex items-center"
              >
                原本を見る →
              </Link>
            </div>
          )}

          {packInstructions && (
            <PackInstructions values={packInstructions} photos={packPhotos ?? []} variant="field" />
          )}

          {/* ③ 3段目：⚡ 1タップ即時切替（カード有無・シール・袋・コンテナ・規格）＆ 注文数変更（2段アコーディオン廃止） */}
          <div className="border-t border-slate-200/80 pt-2.5 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-black text-ink">
                ⚡ 資材・コンテナ 1タップ切替（タップで即時保存＆次回から自動適用）
              </span>
              {savingDetails && (
                <span className="text-[11px] font-bold text-emerald-700 animate-pulse">保存中...</span>
              )}
            </div>

            {/* 🃏 カード有無 / 🏷️ シール有無 / 🛍️ 袋種別 のワンタップピルボタン */}
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                disabled={savingDetails}
                onClick={() => void quickPatchAttributes({ has_card: !hasCard })}
                className={cn(
                  'min-h-[38px] px-3 rounded-xl border text-xs font-black transition active:scale-95',
                  hasCard
                    ? 'border-indigo-500 bg-indigo-600 text-white shadow-2xs'
                    : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-100',
                )}
              >
                {hasCard ? '🃏 カード有（タップで無へ）' : '🃏 カードなし（タップで有へ）'}
              </button>

              <button
                type="button"
                disabled={savingDetails}
                onClick={() => {
                  const next = !hasSeal
                  const nextText = next ? (sealText && sealText !== 'シールなし' ? sealText : 'シールあり') : 'シールなし'
                  void quickPatchAttributes({ has_seal: next, seal_text: nextText })
                }}
                className={cn(
                  'min-h-[38px] px-3 rounded-xl border text-xs font-black transition active:scale-95',
                  hasSeal
                    ? 'border-rose-500 bg-rose-600 text-white shadow-2xs'
                    : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-100',
                )}
              >
                {hasSeal ? '🏷️ シールあり' : '🏷️ シールなし'}
              </button>

              {['印字袋(FG)', '無地袋'].map((bt) => {
                const active = bagType === bt
                return (
                  <button
                    key={bt}
                    type="button"
                    disabled={savingDetails}
                    onClick={() => void quickPatchAttributes({ bag_type: active ? null : bt })}
                    className={cn(
                      'min-h-[38px] px-3 rounded-xl border text-xs font-black transition active:scale-95',
                      active
                        ? 'border-amber-500 bg-amber-500 text-white shadow-2xs'
                        : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-100',
                    )}
                  >
                    🛍️ {bt}
                  </button>
                )
              })}
            </div>

            {/* 🟦 コンテナ種別 1タップピルボタン */}
            <div className="space-y-1">
              <span className="text-[11px] font-bold text-ink-soft block">📦 コンテナ種別（1タップで切替）</span>
              <div className="flex flex-wrap items-center gap-1.5">
                {[
                  { label: '🟦 青コン', value: '青コン' },
                  { label: '🟫 茶コン', value: '茶コン' },
                  { label: '🟩 NSKオリコン', value: '農業総研専用折りたたみコンテナ' },
                  { label: '🟦 房総青コン', value: '房総青コン' },
                  { label: '🟩 緑コン', value: '緑コン' },
                ].map((cOpt) => {
                  const active = container === cOpt.value || (cOpt.value === '農業総研専用折りたたみコンテナ' && container.includes('NSK'))
                  return (
                    <button
                      key={cOpt.value}
                      type="button"
                      disabled={savingDetails}
                      onClick={() => void quickPatchAttributes({ container_type: cOpt.value })}
                      className={cn(
                        'min-h-[36px] px-2.5 rounded-xl border text-xs font-black transition active:scale-95',
                        active
                          ? 'border-sky-700 bg-sky-700 text-white shadow-2xs'
                          : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100',
                      )}
                    >
                      {cOpt.label}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* 📐 1箱の入数 ＆ 規格プリセット（1タップで即時保存・箱数再計算・次回から自動適用） */}
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-1.5">
                <span className="text-[11px] font-bold text-ink-soft">🔢 1箱の入数（1タップで箱数再計算＆記憶）</span>
                <div className="flex flex-wrap items-center gap-1">
                  {[10, 20, 24, 25, 30].map((ppcOpt) => {
                    const active = packsPerCase === ppcOpt
                    return (
                      <button
                        key={ppcOpt}
                        type="button"
                        disabled={savingDetails}
                        onClick={() => {
                          const baseClean =
                            (spec || masterLabelSpec || '2〜3株')
                              .replace(/[（(]?\s*(?:入数|1箱|1ケース)\s*[:：]?\s*\d+\s*[Pパック入]*\s*[）)]?/gi, '')
                              .replace(/\b\d+\s*入(?:り)?\b/g, '')
                              .trim() || '2〜3株'
                          const nextSpec = `${baseClean} (入数${ppcOpt})`
                          void quickPatchAttributes({ spec: nextSpec })
                        }}
                        className={cn(
                          'min-h-[32px] px-2.5 rounded-lg border text-xs font-black transition active:scale-95',
                          active
                            ? 'border-emerald-700 bg-emerald-700 text-white shadow-2xs'
                            : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100',
                        )}
                      >
                        {ppcOpt}入
                      </button>
                    )
                  })}
                </div>
              </div>

              <span className="text-[11px] font-bold text-ink-soft block">📐 規格（プリセット1タップ または 直接入力）</span>
              <div className="flex flex-wrap items-center gap-1.5">
                {[
                  `2〜3株 (入数${packsPerCase})`,
                  `200g (入数${packsPerCase})`,
                  `200gUP (入数${packsPerCase})`,
                ].map((spPreset) => {
                  const active = spec === spPreset
                  return (
                    <button
                      key={spPreset}
                      type="button"
                      disabled={savingDetails}
                      onClick={() => void quickPatchAttributes({ spec: spPreset })}
                      className={cn(
                        'min-h-[34px] px-2.5 rounded-lg border text-xs font-bold transition active:scale-95',
                        active
                          ? 'border-forest-700 bg-forest-700 text-white font-black'
                          : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100',
                      )}
                    >
                      {spPreset}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* 📦 注文数の変更 ＆ 規格手入力・削除 */}
            <div className="rounded-xl border border-slate-200 bg-white p-2.5 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-black text-ink">📦 注文数の変更（1箱＝{packsPerCase}P）</span>
                <div className="flex items-center gap-1.5">
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
                    className={cn(fieldInput, 'num w-18 text-center font-black')}
                  />
                  <span className="text-xs font-bold text-ink">箱 ＝</span>
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
                    className={cn(fieldInput, 'num w-22 text-center font-black')}
                  />
                  <span className="text-xs font-bold text-ink">P</span>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-100">
                <input
                  className={cn(fieldInput, 'flex-1 min-w-[160px]')}
                  value={spec}
                  onChange={(e) => setSpec(e.target.value)}
                  placeholder="規格を自由入力（例: 2〜3株 (入数20)）"
                />
                <div className="flex items-center gap-2 ml-auto">
                  <button
                    type="button"
                    onClick={() => setDeleteOpen(true)}
                    className="inline-flex items-center gap-1 rounded-lg px-2.5 py-2 text-xs font-bold text-alert hover:bg-alert/10"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    <span>{isThaiMode ? 'ลบ (削除)' : '削除'}</span>
                  </button>
                  <Button size="sm" onClick={executeSaveAllSpecsAndQty} isLoading={savingDetails} className="h-10 px-3.5 text-xs font-black">
                    ✓ 数量・規格を保存
                  </Button>
                </div>
              </div>
            </div>
          </div>

          {/* ④ 最下部クイックアクション（削除ボタンを常時・最前面に配置） */}
          <div className="flex items-center justify-between border-t border-slate-200/80 pt-2.5">
            <button
              type="button"
              onClick={() => setDeleteOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-alert/30 bg-rose-50 hover:bg-rose-100 px-3 py-2 text-xs font-black text-alert transition active:scale-95 shadow-2xs"
            >
              <Trash2 className="h-4 w-4 text-alert" aria-hidden />
              <span>{isThaiMode ? 'ลบรายการนี้ (この明細を削除)' : 'この明細を削除'}</span>
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg border border-line bg-white px-3 py-2 text-xs font-bold text-ink-soft hover:bg-bg-soft"
            >
              閉じる ▲
            </button>
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
        message={`受注数 ${orderedQty}P（${totalBoxes}箱）に対し、現在 途中数 ${shippedPacks ?? 0}P が記録されています。全数（${orderedQty}P）の袋詰めが完了した場合のみ「パック済にする」を押してください。`}
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
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={reset}
        title="ステータスを未完了に戻しますか？"
        message={`「${customerName} / ${totalBoxes}箱 (${orderedQty}P)」を ${meta.label} から1段戻します。`}
        confirmLabel="戻す"
        isLoading={busy}
      />

      <ConfirmModal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={deleteItem}
        title="この明細を削除しますか？"
        message={`「${customerName} / ${totalBoxes}箱 (${orderedQty}P)」を削除します。この操作は取り消せません。`}
        confirmLabel="削除する"
        isLoading={deleting}
      />
    </div>
  )
}
