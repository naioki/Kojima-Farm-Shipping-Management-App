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
import {
  rowStatusKey,
  resolvePacksPerCase,
  splitCasesAndPacks,
  formatCasesAndPacks,
  type RowStatusKey,
} from '@/lib/field/shipment-sort'
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

/** 袋の種類の表示名（保存値は変えない）。FG袋＝OPP防曇袋・印字なし。FAXの表記どおり「FG袋」と出す */
const BAG_DISPLAY_LABELS: Record<string, string> = {
  '印字袋(FG)': 'FG袋',
  無地袋: '無地袋',
}
function bagDisplayLabel(bag: string): string {
  return BAG_DISPLAY_LABELS[bag] ?? bag
}

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
  customerId,
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
  const [isSpotlighted, setIsSpotlighted] = useState(false)
  const rowRef = useRef<HTMLDivElement | null>(null)

  const [open, setOpen] = useState(false)
  const [spec, setSpec] = useState(initialSpec ?? '')
  const [container, setContainer] = useState(
    initialContainer && !isGenericOrInvalidContainer(initialContainer) ? initialContainer : '青コン',
  )
  const [hasCard, setHasCard] = useState(Boolean(initialHasCard))
  const [hasSeal, setHasSeal] = useState<boolean | null>(initialHasSeal ?? null)
  const [sealText, setSealText] = useState<string>(initialSealText ?? (initialHasSeal ? 'シールあり' : ''))
  const [bagType, setBagType] = useState<string>(initialBagType ?? '')

  const packsPerCase: number = resolvePacksPerCase({ customerName, spec, masterLabelSpec, masterPacksPerCase })

  const isSampleOrder = isSampleOrderText(destinationName, currentLineNote, initialFieldNote, spec)
  const isSmallSample = isSampleOrder && orderedQty < packsPerCase
  const totalBoxes = isSmallSample ? 0 : Math.ceil(orderedQty / packsPerCase)
  const fullCases = isSmallSample ? 0 : Math.floor(orderedQty / packsPerCase)
  const loosePacks = isSmallSample ? orderedQty : orderedQty % packsPerCase
  const casesText = String(fullCases)
  const looseText = String(loosePacks)

  // 途中数は「満杯の箱数＋端数パック」で操作・表示（箱は切り捨て。25P・20入 → 1箱+5P）。
  // 切り上げで初期化すると 25P が「2箱」と表示され、そのまま記録すると 40P＝全数完了になってしまう。
  const [shippedPacks, setShippedPacks] = useState<number | null>(initialShippedQty)
  const [partialBoxesStr, setPartialBoxesStr] = useState<string>(() =>
    initialShippedQty != null && initialShippedQty > 0
      ? String(splitCasesAndPacks(initialShippedQty, packsPerCase).cases)
      : '',
  )
  const [partialLooseStr, setPartialLooseStr] = useState<string>(() =>
    initialShippedQty != null && initialShippedQty > 0
      ? String(splitCasesAndPacks(initialShippedQty, packsPerCase).loose || '')
      : '',
  )
  const [memoText, setMemoText] = useState(() => buildUnifiedMemo(initialLineNote, initialFieldNote))
  const [editOrderBoxes, setEditOrderBoxes] = useState<string>(() =>
    String(Math.floor(initialOrderedQty / packsPerCase)),
  )
  const [editOrderLoose, setEditOrderLoose] = useState<string>(() =>
    String(initialOrderedQty % packsPerCase),
  )
  const [editOrderPacks, setEditOrderPacks] = useState<string>(() => String(initialOrderedQty))
  const [showOrderEdit, setShowOrderEdit] = useState(false)

  // カスタム追加されたコンテナ・袋種別（全カード共有）
  const [customContainers, setCustomContainers] = useState<string[]>([])
  const [customBags, setCustomBags] = useState<string[]>([])
  const [addingMaterialCat, setAddingMaterialCat] = useState<'container' | 'bag' | null>(null)
  const [newMaterialInput, setNewMaterialInput] = useState('')
  const [savingMaterialOpt, setSavingMaterialOpt] = useState(false)

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
  // 入力欄（箱＋端数P）から計算した「いまの途中数」
  const partialInputPacks =
    (Math.max(0, parseInt(partialBoxesStr, 10) || 0)) * packsPerCase +
    Math.max(0, parseInt(partialLooseStr, 10) || 0)

  useEffect(() => {
    if (!busy && !undoGrace) {
      setStatus(initialStatus)
      setVersion(initialVersion)
    }
  }, [initialStatus, initialVersion, busy, undoGrace])

  useEffect(() => {
    setOrderedQty(initialOrderedQty)
    setEditOrderBoxes(String(Math.floor(initialOrderedQty / packsPerCase)))
    setEditOrderLoose(String(initialOrderedQty % packsPerCase))
    setEditOrderPacks(String(initialOrderedQty))
  }, [initialOrderedQty, packsPerCase])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    fetch('/api/field/material-options')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { containers?: string[]; bags?: string[] } | null) => {
        if (cancelled || !data) return
        setCustomContainers(Array.isArray(data.containers) ? data.containers : [])
        setCustomBags(Array.isArray(data.bags) ? data.bags : [])
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [open])

  async function handleAddCustomMaterial(category: 'container' | 'bag') {
    const val = newMaterialInput.trim()
    if (!val) return
    setSavingMaterialOpt(true)
    try {
      const res = await fetch('/api/field/material-options', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ category, value: val }),
      })
      if (!res.ok) throw new Error('追加に失敗しました')
      const data = (await res.json()) as { containers: string[]; bags: string[] }
      setCustomContainers(data.containers ?? [])
      setCustomBags(data.bags ?? [])
      setNewMaterialInput('')
      setAddingMaterialCat(null)
      if (category === 'container') {
        void quickPatchAttributes({ container_type: val })
      } else {
        void quickPatchAttributes({ bag_type: val })
      }
      toast.success(`「${val}」を選択肢に追加しました`)
    } catch (e) {
      toast.error(fieldErrorMessage(e, '追加に失敗しました'))
    } finally {
      setSavingMaterialOpt(false)
    }
  }

  async function handleRemoveCustomMaterial(category: 'container' | 'bag', val: string) {
    setSavingMaterialOpt(true)
    try {
      const res = await fetch('/api/field/material-options', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ category, value: val }),
      })
      if (!res.ok) throw new Error('削除に失敗しました')
      const data = (await res.json()) as { containers: string[]; bags: string[] }
      setCustomContainers(data.containers ?? [])
      setCustomBags(data.bags ?? [])
      toast.success(`「${val}」を選択肢から削除しました`)
    } catch (e) {
      toast.error(fieldErrorMessage(e, '削除に失敗しました'))
    } finally {
      setSavingMaterialOpt(false)
    }
  }

  useEffect(() => {
    setShippedPacks(initialShippedQty)
    const split =
      initialShippedQty != null && initialShippedQty > 0
        ? splitCasesAndPacks(initialShippedQty, packsPerCase)
        : null
    setPartialBoxesStr(split ? String(split.cases) : '')
    setPartialLooseStr(split && split.loose > 0 ? String(split.loose) : '')
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

  // ✨ AIコンシェルジュ等の「今すぐ現場画面で確認する」から遷移した際のスポットライト点滅＆自動スクロール
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const hlItem = params.get('highlightItem')
    const hlCust = params.get('highlightCustomer')
    const matched =
      (hlItem && hlItem === itemId) ||
      (!hlItem && hlCust && customerId && hlCust === customerId)
    if (!matched) return

    setIsSpotlighted(true)
    setExpandedWhenDone(true)
    const scrollTimer = window.setTimeout(() => {
      rowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 150)
    const clearTimer = window.setTimeout(() => {
      setIsSpotlighted(false)
    }, 6000)
    return () => {
      window.clearTimeout(scrollTimer)
      window.clearTimeout(clearTimer)
    }
  }, [itemId, customerId])

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

  /**
   * 途中数（満杯の箱数＋端数パック）の保存。null でクリア。
   * 全数以上になる値は「途中」ではないので保存しない（全数できたら「パック済にする」を押す運用）。
   */
  async function savePartial(override?: { boxes: number; loose: number } | null) {
    const ppc = packsPerCase && packsPerCase > 0 ? packsPerCase : 20
    const boxes =
      override === null ? 0 : override ? override.boxes : Math.max(0, parseInt(partialBoxesStr, 10) || 0)
    const loose =
      override === null ? 0 : override ? override.loose : Math.max(0, parseInt(partialLooseStr, 10) || 0)
    const rawPacks = boxes * ppc + loose
    if (rawPacks >= orderedQty) {
      toast.error(
        `途中数が注文数（${formatCasesAndPacks(orderedQty, ppc)}）以上です。全部できたら「パック済にする」を押してください`,
        { id: `partial-over-${itemId}` },
      )
      const prev = splitCasesAndPacks(shippedPacks ?? 0, ppc)
      setPartialBoxesStr(shippedPacks ? String(prev.cases) : '')
      setPartialLooseStr(shippedPacks && prev.loose > 0 ? String(prev.loose) : '')
      return
    }
    const val = rawPacks > 0 ? rawPacks : null
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
      {
        // 「1箱+25P」のような入力も「2箱+5P」に整える
        const norm = splitCasesAndPacks(val ?? 0, ppc)
        setPartialBoxesStr(val ? String(norm.cases) : '')
        setPartialLooseStr(val && norm.loose > 0 ? String(norm.loose) : '')
      }
      onShippedQtyChange?.(itemId, val)
      toast.success(
        val ? `途中数 ${formatCasesAndPacks(val, ppc)}（${val}P）を記録しました` : '途中数をクリアしました',
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
    'h-10 w-full rounded-lg border border-line-strong bg-bg-card px-2.5 text-base sm:text-sm text-ink focus:outline-none focus:border-forest-600 focus:ring-2 focus:ring-forest-100'

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
      ref={rowRef}
      id={`shipment-item-${itemId}`}
      className={cn(
        'rounded-2xl border shadow-sm transition-all duration-300',
        isCollapsedDone ? 'px-3.5 py-2.5' : 'p-3.5',
        isFutureOrNextDay
          ? 'border-line-strong bg-bg-soft/95 text-ink shadow-xs'
          : isTodayOrder
          ? status === 'shipped'
            ? 'border-trust-400 bg-trust-100/80'
            : status === 'packed'
            ? 'border-trust-400 bg-trust-50/80 ring-1 ring-trust-400'
            : 'border-trust-400 bg-trust-50/60 shadow-xs'
          : isTomorrowOrder
          ? status === 'shipped'
            ? 'border-harvest-400 bg-harvest-100/80'
            : status === 'packed'
            ? 'border-harvest-400 bg-harvest-50/80 ring-1 ring-harvest-400'
            : 'border-harvest-400/80 bg-bg-card shadow-xs'
          : status === 'shipped'
          ? 'border-trust-400 bg-trust-50/30'
          : status === 'packed'
          ? 'border-harvest-400 bg-harvest-50/30'
          : 'border-line bg-bg-card shadow-xs',
        isNextUp && !isDone && !isFutureOrNextDay
          ? 'ring-2 ring-harvest-600 border-harvest-600 bg-bg-card shadow-md'
          : '',
        isSpotlighted
          ? 'ring-4 ring-warning border-warning bg-warning-bg/95 shadow-xl scale-[1.01]'
          : '',
        conflict ? 'animate-pulse-alert border-alert ring-2 ring-alert/20' : '',
      )}
    >
      {isSpotlighted && (
        <div className="mb-2.5 flex items-center justify-between gap-2 rounded-xl bg-warning px-3 py-2 text-xs sm:text-sm font-black text-white shadow-sm animate-pulse">
          <span>✨ ここです！AIおまかせ相談から今登録・反映されたカードです</span>
          <button
            type="button"
            onClick={() => setIsSpotlighted(false)}
            className="min-h-10 shrink-0 rounded-md bg-white/20 px-3 text-xs font-bold hover:bg-white/30"
          >
            閉じる
          </button>
        </div>
      )}
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
            className="min-h-10 shrink-0 flex items-center gap-1 rounded-lg bg-alert text-white px-3 text-xs font-bold shadow-xs hover:bg-alert/90 transition-colors"
          >
            最新データを反映
          </button>
        </div>
      )}

      {offlinePending && (
        <div className="mb-2 flex items-center gap-1.5 rounded-lg bg-warning-bg border border-warning px-2.5 py-1 text-xs font-bold text-ink">
          <span>📡 圏外のため一時保存中（電波復帰時に自動送信されます）</span>
        </div>
      )}

      {isCollapsedDone ? (
        <div
          onClick={() => setExpandedWhenDone(true)}
          className="space-y-1.5 cursor-pointer select-none"
          title="タップしてカードを展開"
        >
          {/* 1段目: 状態・取引先・数量（取引先名は幅を確保して切れても title で全文） */}
          <div className="flex items-center gap-2 min-w-0">
            <span className="whitespace-nowrap inline-flex items-center gap-0.5 rounded-md bg-harvest-600 px-2 py-0.5 text-xs font-black text-white shrink-0 shadow-2xs">
              <Check className="h-3.5 w-3.5" aria-hidden />
              <span>{status === 'shipped' ? '出荷済' : '済'}</span>
            </span>
            <ColorDot color={customerColor} name={customerName} size="sm" />
            <span className="min-w-0 flex-1 font-black text-ink text-sm sm:text-base truncate" title={customerName}>
              {customerName}
            </span>
            <span className="num shrink-0 text-sm sm:text-base font-black text-ink tabular-nums">
              {isSmallSample ? (
                <span className="text-grape-700">サンプル {orderedQty}P</span>
              ) : (
                <>
                  {casesText}箱
                  {loosePacks > 0 ? `+${looseText}P` : ''}
                  <span className="text-xs font-bold text-ink-soft ml-1">({orderedQty}P)</span>
                </>
              )}
            </span>
          </div>
          {/* 2段目: 納入先（取引先 ＞ 納入先）・操作ボタン */}
          <div className="flex items-center gap-2 min-w-0">
            <div className="min-w-0 flex-1">
              {destinationName && customerName !== destinationName && (
                <span
                  className="inline-flex max-w-full items-center gap-1 rounded bg-harvest-100 border border-harvest-400 px-1.5 py-0.5 text-xs font-black text-forest-900"
                  title={destinationName}
                >
                  <span aria-hidden>▶</span>
                  <span className="truncate">{destinationName}</span>
                </span>
              )}
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={(e) => {
                e.stopPropagation()
                setConfirmOpen(true)
              }}
              className="min-h-10 h-10 shrink-0 rounded-lg border border-line-strong bg-bg-card px-3 text-xs font-bold text-ink-soft hover:bg-bg-soft active:scale-95 transition"
              title="未完了に戻す"
            >
              戻す
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setExpandedWhenDone(true)
              }}
              className="h-10 w-10 shrink-0 rounded-lg border border-line bg-bg-card flex items-center justify-center text-ink-soft hover:text-ink"
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
            <div className="mb-2.5 rounded-xl border-2 border-grape-500 bg-gradient-to-r from-grape-700 via-grape-700 to-warning px-3 py-2 text-white shadow-sm flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-lg shrink-0">🧪</span>
                <div className="min-w-0">
                  <div className="text-xs sm:text-sm font-black tracking-wide leading-tight">
                    {isThaiMode
                      ? `${THAI_LABELS.sampleOrder} / サンプル依頼（小口・別口手渡し用）`
                      : 'サンプル依頼（小口・手渡し／荷上げ用）'}
                  </div>
                  <div className="text-xs font-bold text-grape-100 truncate">
                    ※ 大口コンテナとは別口で {orderedQty} パック調製してください
                  </div>
                </div>
              </div>
              <span className="whitespace-nowrap shrink-0 rounded-lg bg-warning-bg px-2.5 py-1 text-xs font-black text-ink shadow-2xs">
                バラ {orderedQty}P
              </span>
            </div>
          )}

          {/* ① 見出し情報（薄い区切り線と十分な余白を設け、直下の規格・コンテナバッジとの衝突を完全解消） */}
          <div className="space-y-2.5 pb-3">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-line/80">
              <div className="flex items-center gap-2 flex-wrap min-w-0">
                {isNextUp && !isDone && !isFutureOrNextDay && (
                  <span className="whitespace-nowrap inline-flex items-center gap-1 rounded-md bg-harvest-700 px-2 py-0.5 text-xs font-black text-white shadow-2xs shrink-0">
                    <span>🔥 次</span>
                  </span>
                )}
                <ColorDot color={customerColor} name={customerName} size="md" />
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 min-w-0">
                  <span className="font-black text-ink text-base sm:text-xl tracking-tight leading-snug">
                    {customerName}
                  </span>
                  {destinationName && customerName !== destinationName && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg bg-harvest-50 border border-harvest-400 text-forest-900 font-black text-sm sm:text-base tracking-tight leading-snug shadow-2xs">
                      <span className="text-harvest-700 text-xs">▶</span>
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
                        ? 'bg-harvest-100 border border-harvest-400 text-forest-900'
                        : 'bg-warning text-white',
                    )}
                  >
                    <span>{changeDiffBadge === '新規追加' ? '✨ 新規' : `🔄 ${changeDiffBadge}`}</span>
                  </span>
                )}
                {needsManualConfirm && !changeDiffBadge && (
                  <span className="whitespace-nowrap inline-flex items-center gap-1 rounded-md bg-warning-bg border border-warning px-2 py-0.5 text-xs font-black text-ink">
                    ⚠️ 要確認
                  </span>
                )}
                {isDone && expandedWhenDone && (
                  <button
                    type="button"
                    onClick={() => setExpandedWhenDone(false)}
                    className="min-h-10 rounded-lg border border-line bg-bg-card px-3 text-xs font-bold text-ink-soft hover:bg-bg-soft"
                  >
                    1行に畳む ▲
                  </button>
                )}
              </div>
            </div>

            {/* 規格 ＋ 資材レシピタグ（#06 規格バッジから冗長な (入数20) を除去し、数量バーの (20入) との重複を解消） */}
            <div className="flex flex-wrap items-center gap-2 pt-0.5">
              <span title={cleanSpecLabel ? String(cleanSpecLabel) : undefined} className="truncate max-w-[14rem] inline-flex items-center gap-1 rounded-lg bg-bg-soft px-2.5 py-1 text-xs sm:text-sm font-black text-ink border border-line-strong">
                {isThaiMode && getThaiSpec(spec || masterLabelSpec, masterPacksPerCase) ? (
                  <>
                    <span>📐 {getThaiSpec(spec || masterLabelSpec, masterPacksPerCase)}</span>
                    <span className="text-xs font-bold text-ink-muted">({cleanSpecLabel})</span>
                  </>
                ) : (
                  <span>📐 {cleanSpecLabel}</span>
                )}
              </span>

              {container && (
                <span className="whitespace-nowrap inline-flex items-center gap-1 rounded-lg bg-trust-50 px-2.5 py-1 text-xs sm:text-sm font-black text-trust-700 border border-trust-400">
                  {isThaiMode && getThaiContainer(container) ? (
                    <>
                      <span>{getContainerColorEmoji(container)} {getThaiContainer(container)}</span>
                      <span className="text-xs font-bold text-trust-700">({container})</span>
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
                <span title={sealText || 'シールあり'} className="max-w-[12rem] min-w-0 inline-flex items-center gap-1 rounded-lg bg-alert-bg px-2.5 py-1 text-xs sm:text-sm font-black text-alert border border-alert">
                  <span className="truncate">🏷️ {sealText || 'シールあり'}</span>
                </span>
              )}
              {hasSeal === false && (
                <span className="whitespace-nowrap inline-flex items-center gap-1 rounded-lg bg-bg-soft px-2 py-1 text-xs font-bold text-ink-soft border border-line-strong">
                  <span>シールなし</span>
                </span>
              )}

              {hasCard && (
                <span className="whitespace-nowrap inline-flex items-center gap-1 rounded-lg bg-grape-50 px-2.5 py-1 text-xs sm:text-sm font-black text-grape-700 border border-grape-200">
                  <span>🃏 カード有</span>
                </span>
              )}

              {bagType && (
                <span className="whitespace-nowrap inline-flex items-center gap-1 rounded-lg bg-warning-bg px-2.5 py-1 text-xs sm:text-sm font-black text-ink border border-warning">
                  <span>{getBagEmoji(bagType)} {bagDisplayLabel(bagType)}</span>
                </span>
              )}

              {masterTapeColor && (
                <span className="whitespace-nowrap inline-flex items-center gap-1 rounded-lg bg-harvest-50 px-2.5 py-1 text-xs sm:text-sm font-black text-forest-900 border border-harvest-400">
                  <span>{getTapeColorEmoji(masterTapeColor)} テープ: {masterTapeColor}</span>
                </span>
              )}
            </div>

            {isPartial && (
              <button
                type="button"
                onClick={() => setOpen(true)}
                className="w-full mt-1 min-h-10 rounded-xl border-2 border-warning bg-warning-bg hover:bg-warning-bg/80 px-3 py-1.5 text-left flex flex-wrap items-center justify-between gap-x-2 gap-y-1 transition"
                title="途中数を直す"
              >
                <span className="text-xs sm:text-sm font-black text-ink flex flex-wrap items-center gap-x-1.5">
                  <span>⏳ 途中経過:</span>
                  <span className="tabular-nums">
                    {formatCasesAndPacks(shippedPacks ?? 0, packsPerCase)}
                    {(shippedPacks ?? 0) >= packsPerCase ? `（${shippedPacks}P）` : ''}完了
                  </span>
                </span>
                <span className="whitespace-nowrap rounded-md bg-bg-card border border-warning text-ink px-2 py-0.5 text-xs font-black shrink-0 tabular-nums">
                  残り {formatCasesAndPacks(remainingPacks, packsPerCase)}
                  {remainingPacks >= packsPerCase ? `（${remainingPacks}P）` : ''} ✎
                </span>
              </button>
            )}

            {/* 📝 本当の伝達事項がある時のみ表示 */}
            {(memoText || masterPackingNotes) && (
              <button
                type="button"
                onClick={() => setOpen(true)}
                className="w-full mt-1 min-h-10 rounded-xl border-l-4 border-warning bg-warning-bg hover:bg-warning-bg/70 px-3 py-1.5 text-left text-xs font-bold text-ink flex items-center justify-between gap-2 transition"
              >
                <span className="flex items-center gap-1.5">
                  <span>📝</span>
                  <span>{[memoText, masterPackingNotes].filter(Boolean).join(' / ')}</span>
                </span>
                <span className="text-xs font-black text-ink shrink-0 underline">編集</span>
              </button>
            )}
          </div>

          {/* ② 統合数量ブロック（サンプル時はバラパック特大表示、通常時は箱数＋総パック数を並置） */}
          <div
            className={cn(
              'rounded-xl px-4 py-2.5 text-white mb-2.5 shadow-sm transition-colors flex flex-wrap items-center justify-between gap-2',
              isSampleOrder
                ? 'bg-grape-700 border-2 border-warning'
                : isFutureOrNextDay
                ? 'bg-night-soft border border-white/20'
                : isTodayOrder
                ? 'bg-trust-600 border border-trust-600/30'
                : 'bg-forest-800',
            )}
          >
            {isSmallSample ? (
              <div className="flex items-baseline gap-2.5 flex-wrap">
                <span className="whitespace-nowrap rounded-md bg-warning-bg px-2 py-0.5 text-xs font-black text-ink">
                  🧪 サンプル（小口バラ）
                </span>
                <span className="num text-3xl sm:text-4xl font-black tracking-tight text-white tabular-nums leading-none">
                  {orderedQty}
                  <span className="text-base sm:text-xl font-black text-earth-100 ml-1.5">
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
                  <span className="text-base sm:text-xl font-black text-harvest-100 ml-1">
                    {isThaiMode ? 'ลัง (箱)' : '箱'}
                  </span>
                </span>
                {loosePacks > 0 && (
                  <span className="whitespace-nowrap rounded-lg bg-warning-bg text-ink px-2 py-0.5 text-xs sm:text-sm font-black shadow-2xs">
                    ＋端数 {looseText}P (計{totalBoxes}箱)
                  </span>
                )}
              </div>
            )}

            <div className="flex items-baseline gap-1.5 rounded-lg bg-black/20 border border-white/15 px-3 py-1 tabular-nums">
              <span className="text-xs font-bold text-white/80">総数</span>
              <span className="num text-lg sm:text-xl font-black text-white">
                {orderedQty.toLocaleString()}
              </span>
              <span className="text-xs font-bold text-white/90">P</span>
              {!isSmallSample && (
                <span className="text-xs font-bold text-white/70 ml-0.5">
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
                  ? 'bg-harvest-600 text-white ring-2 ring-harvest-600 ring-offset-1'
                  : status === 'shipped'
                  ? 'border border-line bg-bg-soft/70 text-ink-muted'
                  : isFutureOrNextDay
                  ? 'border-2 border-ink-faint bg-bg-card text-ink hover:bg-bg-soft'
                  : 'border-2 border-harvest-600 bg-bg-card text-ink hover:bg-harvest-50',
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
                    ? 'bg-trust-600 text-white ring-2 ring-trust-600 ring-offset-1'
                    : status === 'packed'
                    ? 'border-2 border-trust-600/60 bg-bg-card text-ink hover:bg-trust-50'
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
                  ? 'border-warning bg-warning-bg text-ink hover:opacity-90'
                  : 'border-line-strong bg-bg-card text-ink hover:bg-bg-soft',
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
          className="mt-2 flex items-center justify-between gap-2 rounded-xl border border-harvest-100 bg-harvest-50/80 px-3 py-2"
        >
          <span className="flex items-center gap-1.5 text-xs font-bold text-harvest-700">
            <Check className="h-4 w-4" aria-hidden />
            <span>{meta.label}に更新しました</span>
          </span>
          <button
            type="button"
            onClick={undoAdvance}
            disabled={busy}
            className="inline-flex min-h-[40px] h-10 shrink-0 items-center gap-1.5 rounded-xl border border-line-strong bg-bg-card px-3 text-xs font-black text-ink hover:bg-bg-soft active:scale-95 transition"
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
        <div className="mt-3 rounded-xl border border-line bg-bg-soft/80 p-3 space-y-2.5 animate-in fade-in duration-150">
          {/* ① 1段目：⏳ 途中数の記録（満杯の箱数＋端数パック。全数以上は記録しない） */}
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-xs">
              <span className="font-black text-ink">⏳ 途中数（いまできた分）</span>
              <span className="font-bold text-ink-soft tabular-nums">
                注文 {formatCasesAndPacks(orderedQty, packsPerCase)}（{orderedQty}P）
                {partialInputPacks > 0 && (
                  <span className="text-ink font-black ml-1">
                    ／ 現在 {formatCasesAndPacks(partialInputPacks, packsPerCase)}（{partialInputPacks}P）
                  </span>
                )}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                disabled={savingQuick}
                onClick={() => {
                  const cur = parseInt(partialBoxesStr, 10) || 0
                  const loose = parseInt(partialLooseStr, 10) || 0
                  const next = Math.max(0, cur - 1)
                  if (next === 0 && loose === 0) {
                    setPartialBoxesStr('')
                    void savePartial(null)
                    return
                  }
                  setPartialBoxesStr(String(next))
                  void savePartial({ boxes: next, loose })
                }}
                className="min-h-11 h-11 px-3 rounded-xl border border-line-strong bg-bg-card hover:bg-bg-soft text-xs sm:text-sm font-black text-ink shrink-0 active:scale-95 transition"
              >
                -1箱
              </button>

              <label className="flex items-center gap-1 bg-bg-card border border-line-strong rounded-xl px-2 min-h-11 h-11 w-20 shrink-0">
                <span className="sr-only">できた箱数</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={Math.max(0, totalBoxes)}
                  value={partialBoxesStr}
                  onChange={(e) => setPartialBoxesStr(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                      e.preventDefault()
                      void savePartial()
                    }
                  }}
                  placeholder="0"
                  className="num w-full min-w-0 bg-transparent text-center font-black text-base text-ink focus:outline-none"
                />
                <span className="text-xs font-bold text-ink-soft shrink-0">箱</span>
              </label>

              <button
                type="button"
                disabled={savingQuick}
                onClick={() => {
                  const cur = parseInt(partialBoxesStr, 10) || 0
                  const loose = parseInt(partialLooseStr, 10) || 0
                  const next = cur + 1
                  setPartialBoxesStr(String(next))
                  void savePartial({ boxes: next, loose })
                }}
                className="min-h-11 h-11 px-3 rounded-xl bg-harvest-600 hover:bg-harvest-700 text-xs sm:text-sm font-black text-white shrink-0 active:scale-95 transition shadow-2xs"
              >
                +1箱
              </button>

              <label className="flex items-center gap-1 bg-bg-card border border-line-strong rounded-xl px-2 min-h-11 h-11 w-20 shrink-0">
                <span className="text-xs font-bold text-ink-soft shrink-0">＋</span>
                <span className="sr-only">端数のパック数</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={Math.max(0, packsPerCase - 1)}
                  value={partialLooseStr}
                  onChange={(e) => setPartialLooseStr(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                      e.preventDefault()
                      void savePartial()
                    }
                  }}
                  placeholder="0"
                  className="num w-full min-w-0 bg-transparent text-center font-black text-base text-ink focus:outline-none"
                />
                <span className="text-xs font-bold text-ink-soft shrink-0">P</span>
              </label>

              <div className="ml-auto flex items-center gap-1.5">
                {(partialBoxesStr !== '' || partialLooseStr !== '') && (
                  <button
                    type="button"
                    onClick={() => {
                      setPartialBoxesStr('')
                      setPartialLooseStr('')
                      void savePartial(null)
                    }}
                    className="min-h-11 h-11 px-2 rounded-lg text-xs font-bold text-ink-soft hover:text-ink underline shrink-0"
                  >
                    クリア
                  </button>
                )}
                <Button
                  size="sm"
                  onClick={() => savePartial()}
                  isLoading={savingQuick}
                  className="min-h-11 h-11 px-3.5 shrink-0 text-xs font-black"
                >
                  記録
                </Button>
              </div>
            </div>
          </div>

          {/* ② 2段目：📝 メモ・伝達事項（横1行で完結） */}
          <div className="space-y-1 border-t border-line/80 pt-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-black text-ink">📝 メモ・伝達事項</span>
              {memoText.trim() !== '' && (
                <button
                  type="button"
                  onClick={() => setMemoText('')}
                  className="min-h-10 px-2 text-xs text-ink-soft hover:text-ink font-bold underline"
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
                className="h-10 px-3 shrink-0 text-xs font-black"
              >
                保存
              </Button>
            </div>
          </div>

          {/* 📄 受注原本リンク（ある時のみ1行で表示） */}
          {receipt?.hasOriginal && viewerHref && (
            <div className="flex items-center justify-between border-t border-line/80 pt-2">
              <span className="text-xs font-bold text-ink-soft">📄 受注原本（FAX・注文書画像）</span>
              <Link
                href={viewerHref}
                className="h-10 px-3 shrink-0 rounded-lg bg-trust-700 text-white text-xs font-black shadow-2xs hover:bg-trust-600 active:scale-95 transition inline-flex items-center"
              >
                原本を見る →
              </Link>
            </div>
          )}

          {packInstructions && (
            <PackInstructions values={packInstructions} photos={packPhotos ?? []} variant="field" />
          )}

          {/* ③ 3段目：⚡ 1タップ即時切替（カード有無・シール・袋・コンテナ・規格）＆ 注文数変更（2段アコーディオン廃止） */}
          <div className="border-t border-line/80 pt-2.5 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-black text-ink">
                ⚡ 資材・コンテナ 1タップ切替（タップで即時保存＆次回から自動適用）
              </span>
              {savingDetails && (
                <span className="text-xs font-bold text-harvest-700 animate-pulse">保存中...</span>
              )}
            </div>

            {/* 🃏 カード有無 / 🏷️ シール有無 / 🛍️ 袋種別 のワンタップピルボタン */}
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                disabled={savingDetails}
                onClick={() => void quickPatchAttributes({ has_card: !hasCard })}
                aria-pressed={hasCard}
                title={hasCard ? 'タップで「カードは入れない」に切り替え' : 'タップで「カードを入れる」に切り替え'}
                className={cn(
                  'min-h-10 px-3 rounded-xl border text-xs font-black transition active:scale-95',
                  hasCard
                    ? 'border-grape-500 bg-grape-600 text-white shadow-2xs'
                    : 'border-line-strong bg-bg-card text-ink-soft hover:bg-bg-soft',
                )}
              >
                {hasCard ? '🃏 カードを入れる' : '🃏 カードは入れない'}
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
                  'min-h-10 px-3 rounded-xl border text-xs font-black transition active:scale-95',
                  hasSeal
                    ? 'border-alert bg-alert text-white shadow-2xs'
                    : 'border-line-strong bg-bg-card text-ink-soft hover:bg-bg-soft',
                )}
              >
                {hasSeal ? '🏷️ シールあり' : '🏷️ シールなし'}
              </button>

              {['印字袋(FG)', '無地袋', ...customBags.filter((b) => b !== '印字袋(FG)' && b !== '無地袋')].map((bt) => {
                const active = bagType === bt
                const isCustom = bt !== '印字袋(FG)' && bt !== '無地袋'
                return (
                  <span key={bt} className="inline-flex items-center gap-0.5">
                    <button
                      type="button"
                      disabled={savingDetails}
                      onClick={() => void quickPatchAttributes({ bag_type: active ? null : bt })}
                      aria-pressed={active}
                      title={active ? `「${bagDisplayLabel(bt)}」の指定を外す` : `袋を「${bagDisplayLabel(bt)}」にする`}
                      className={cn(
                        'min-h-10 px-3 rounded-xl border text-xs font-black transition active:scale-95',
                        active
                          ? 'border-warning bg-warning text-white shadow-2xs'
                          : 'border-line-strong bg-bg-card text-ink-soft hover:bg-bg-soft',
                      )}
                    >
                      {bagDisplayLabel(bt)}
                    </button>
                    {isCustom && (
                      <button
                        type="button"
                        disabled={savingMaterialOpt}
                        onClick={() => void handleRemoveCustomMaterial('bag', bt)}
                        title={`「${bt}」を選択肢から削除`}
                        className="h-10 w-10 rounded-full text-sm font-bold text-ink-faint hover:bg-alert-bg hover:text-alert"
                      >
                        ×
                      </button>
                    )}
                  </span>
                )
              })}
              <button
                type="button"
                onClick={() => {
                  setAddingMaterialCat(addingMaterialCat === 'bag' ? null : 'bag')
                  setNewMaterialInput('')
                }}
                className="min-h-10 px-2.5 rounded-xl border border-dashed border-line-strong bg-bg-card text-xs font-bold text-ink-soft hover:border-ink-faint hover:text-ink"
              >
                ＋袋・資材を追加
              </button>
            </div>

            {addingMaterialCat === 'bag' && (
              <div className="flex items-center gap-1.5 rounded-xl border border-warning bg-warning-bg/70 p-2">
                <input
                  type="text"
                  value={newMaterialInput}
                  onChange={(e) => setNewMaterialInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                      e.preventDefault()
                      void handleAddCustomMaterial('bag')
                    }
                  }}
                  placeholder="新しい袋・資材名（例: ボードン11号）"
                  className={cn(fieldInput, 'flex-1 min-w-0 text-xs')}
                />
                <Button
                  size="sm"
                  onClick={() => void handleAddCustomMaterial('bag')}
                  isLoading={savingMaterialOpt}
                  className="h-10 px-3 shrink-0 text-xs font-black"
                >
                  追加して適用
                </Button>
                <button
                  type="button"
                  onClick={() => setAddingMaterialCat(null)}
                  className="min-h-10 shrink-0 px-2 text-xs font-bold text-ink-soft hover:text-ink"
                >
                  閉じる
                </button>
              </div>
            )}

            {/* 🟦 コンテナ種別 1タップピルボタン */}
            <div className="space-y-1">
              <div className="flex flex-wrap items-center justify-between gap-x-2">
                <span className="text-xs font-bold text-ink-soft">📦 コンテナ種別（1タップで切替）</span>
                <button
                  type="button"
                  onClick={() => {
                    setAddingMaterialCat(addingMaterialCat === 'container' ? null : 'container')
                    setNewMaterialInput('')
                  }}
                  className="min-h-10 px-2 text-xs font-bold text-trust-700 hover:underline whitespace-nowrap"
                >
                  ＋新しいコンテナを追加
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {[
                  { label: '🟦 青コン', value: '青コン', isCustom: false },
                  { label: '🟫 茶コン', value: '茶コン', isCustom: false },
                  { label: '🟩 NSKオリコン', value: '農業総研専用折りたたみコンテナ', isCustom: false },
                  { label: '🟦 房総青コン', value: '房総青コン', isCustom: false },
                  { label: '🟩 緑コン', value: '緑コン', isCustom: false },
                  ...customContainers
                    .filter(
                      (c) =>
                        !['青コン', '茶コン', '農業総研専用折りたたみコンテナ', '房総青コン', '緑コン'].includes(c),
                    )
                    .map((c) => ({ label: `📦 ${c}`, value: c, isCustom: true })),
                ].map((cOpt) => {
                  const active = container === cOpt.value || (cOpt.value === '農業総研専用折りたたみコンテナ' && container.includes('NSK'))
                  return (
                    <span key={cOpt.value} className="inline-flex items-center gap-0.5">
                      <button
                        type="button"
                        disabled={savingDetails}
                        onClick={() => void quickPatchAttributes({ container_type: cOpt.value })}
                        className={cn(
                          'min-h-10 px-2.5 rounded-xl border text-xs font-black transition active:scale-95',
                          active
                            ? 'border-trust-700 bg-trust-700 text-white shadow-2xs'
                            : 'border-line-strong bg-bg-card text-ink-soft hover:bg-bg-soft',
                        )}
                      >
                        {cOpt.label}
                      </button>
                      {cOpt.isCustom && (
                        <button
                          type="button"
                          disabled={savingMaterialOpt}
                          onClick={() => void handleRemoveCustomMaterial('container', cOpt.value)}
                          title={`「${cOpt.value}」を選択肢から削除`}
                          className="h-10 w-10 rounded-full text-sm font-bold text-ink-faint hover:bg-alert-bg hover:text-alert"
                        >
                          ×
                        </button>
                      )}
                    </span>
                  )
                })}
              </div>
              {addingMaterialCat === 'container' && (
                <div className="mt-1.5 flex items-center gap-1.5 rounded-xl border border-trust-400 bg-trust-50/70 p-2">
                  <input
                    type="text"
                    value={newMaterialInput}
                    onChange={(e) => setNewMaterialInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                        e.preventDefault()
                        void handleAddCustomMaterial('container')
                      }
                    }}
                    placeholder="新しいコンテナ名（例: 黄コン、赤コン、段ボール）"
                    className={cn(fieldInput, 'flex-1 min-w-0 text-xs')}
                  />
                  <Button
                    size="sm"
                    onClick={() => void handleAddCustomMaterial('container')}
                    isLoading={savingMaterialOpt}
                    className="h-10 px-3 shrink-0 text-xs font-black"
                  >
                    追加して適用
                  </Button>
                  <button
                    type="button"
                    onClick={() => setAddingMaterialCat(null)}
                    className="min-h-10 shrink-0 px-2 text-xs font-bold text-ink-soft hover:text-ink"
                  >
                    閉じる
                  </button>
                </div>
              )}
            </div>

            {/* 📐 1箱の入数 ＆ 規格プリセット（1タップで即時保存・箱数再計算・次回から自動適用） */}
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-1.5">
                <span className="text-xs font-bold text-ink-soft">🔢 1箱の入数（1タップで箱数再計算＆記憶）</span>
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
                          'min-h-10 min-w-10 px-2.5 rounded-lg border text-xs font-black transition active:scale-95',
                          active
                            ? 'border-harvest-700 bg-harvest-700 text-white shadow-2xs'
                            : 'border-line-strong bg-bg-card text-ink-soft hover:bg-bg-soft',
                        )}
                      >
                        {ppcOpt}入
                      </button>
                    )
                  })}
                </div>
              </div>

              <span className="text-xs font-bold text-ink-soft block">📐 規格（プリセット1タップ または 直接入力）</span>
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
                        'min-h-10 px-2.5 rounded-lg border text-xs font-bold transition active:scale-95',
                        active
                          ? 'border-forest-700 bg-forest-700 text-white font-black'
                          : 'border-line-strong bg-bg-card text-ink-soft hover:bg-bg-soft',
                      )}
                    >
                      {spPreset}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* 📦 注文数の変更 ＆ 規格手入力（普段は折りたたんで途中数と誤認しない設計） */}
            <div className="rounded-xl border border-line bg-bg-card p-2.5 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-ink-soft">
                  📦 現在の注文数：<strong className="font-black text-ink">{fullCases}箱{loosePacks > 0 ? `＋${loosePacks}P` : ''}（計{orderedQty}P / 1箱{packsPerCase}入）</strong>
                </span>
                <button
                  type="button"
                  onClick={() => setShowOrderEdit(!showOrderEdit)}
                  className={cn(
                    'min-h-10 shrink-0 rounded-lg border px-3 text-xs font-black transition',
                    showOrderEdit
                      ? 'border-night-soft bg-night text-white'
                      : 'border-line-strong bg-bg-soft text-ink hover:opacity-90',
                  )}
                >
                  {showOrderEdit ? '閉じる ▲' : '📦 注文数・規格を変更する ✎'}
                </button>
              </div>

              {showOrderEdit && (
                <div className="space-y-2.5 pt-2 border-t border-line">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-black text-ink">注文数の変更（1箱＝{packsPerCase}P）</span>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        value={editOrderBoxes}
                        onChange={(e) => {
                          const b = e.target.value
                          setEditOrderBoxes(b)
                          const bNum = parseInt(b, 10)
                          const lNum = parseInt(editOrderLoose, 10) || 0
                          if (!isNaN(bNum) && bNum >= 0) {
                            setEditOrderPacks(String(bNum * packsPerCase + Math.max(0, lNum)))
                          }
                        }}
                        className={cn(fieldInput, 'num w-16 text-center font-black')}
                      />
                      <span className="text-xs font-bold text-ink">箱 ＋ 端数</span>
                      <input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={Math.max(0, packsPerCase - 1)}
                        value={editOrderLoose}
                        onChange={(e) => {
                          const l = e.target.value
                          setEditOrderLoose(l)
                          const bNum = parseInt(editOrderBoxes, 10) || 0
                          const lNum = parseInt(l, 10)
                          if (!isNaN(lNum) && lNum >= 0) {
                            setEditOrderPacks(String(Math.max(0, bNum) * packsPerCase + lNum))
                          }
                        }}
                        className={cn(fieldInput, 'num w-14 text-center font-black')}
                      />
                      <span className="text-xs font-bold text-ink">P ＝ 計</span>
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
                            setEditOrderLoose(String(pNum % packsPerCase))
                          }
                        }}
                        className={cn(fieldInput, 'num w-20 text-center font-black')}
                      />
                      <span className="text-xs font-bold text-ink">P</span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-line">
                    <input
                      className={cn(fieldInput, 'flex-1 min-w-[160px]')}
                      value={spec}
                      onChange={(e) => setSpec(e.target.value)}
                      placeholder="規格を自由入力（例: 2〜3株 (入数20)）"
                    />
                    <div className="flex items-center gap-2 ml-auto">
                      <Button size="sm" onClick={executeSaveAllSpecsAndQty} isLoading={savingDetails} className="h-10 px-3.5 text-xs font-black">
                        ✓ 数量・規格を保存
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ④ 最下部クイックアクション（削除ボタンを常時・最前面に配置） */}
          <div className="flex items-center justify-between border-t border-line/80 pt-2.5">
            <button
              type="button"
              onClick={() => setDeleteOpen(true)}
              className="min-h-10 inline-flex items-center gap-1.5 rounded-lg border border-alert/30 bg-alert-bg hover:bg-alert/10 px-3 text-xs font-black text-alert transition active:scale-95 shadow-2xs"
            >
              <Trash2 className="h-4 w-4 text-alert" aria-hidden />
              <span>{isThaiMode ? 'ลบรายการนี้ (この明細を削除)' : 'この明細を削除'}</span>
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="min-h-10 rounded-lg border border-line bg-bg-card px-3 text-xs font-bold text-ink-soft hover:bg-bg-soft"
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
