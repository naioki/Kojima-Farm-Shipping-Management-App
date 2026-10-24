'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ChevronDown, Check, AlertTriangle, ShieldCheck, Trash2, Undo2 } from 'lucide-react'
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

/**
 * ステータス別の配色は lib/field/status-style.ts（単一の正）から取る。
 * カードは左ボーダー＋背景トーンで4区分を一目で分からせる（打消し線・○囲みは使わない）。
 * 色だけに頼らず、中央のステータスラベル文字と併用する（WCAG・design.md）。
 */

/** ステータス変更後、その場に留まって「元に戻す」を出す時間（ms）。誤タップ対策。 */
const UNDO_GRACE_MS = 5000

export interface ShipmentRowProps {
  itemId: string
  customerName: string
  /** 取引先の識別色（hex or null → 名前から自動生成） */
  customerColor?: string | null
  /** 納入先名（取引先の配下の届け先。無ければ非表示。表示は常に「取引先＞納入先」） */
  destinationName?: string | null
  /** 総数表示（"120" や "6c0" など、呼び出し側で整形） */
  quantityText: string
  /** 受注総数（中断時の「できた数」との比較・部分完了判定に使う） */
  orderedQty: number
  initialStatus: FieldStatus
  initialVersion: number
  /** 荷姿まわり（規則から自動補完済みの初期値） */
  initialSpec: string | null
  initialContainer: string | null
  initialHasCard: boolean | null
  initialLineNote: string | null
  /** 現場の記録（中断時の部分完了数・現場メモ） */
  initialShippedQty: number | null
  initialFieldNote: string | null
  /** 梱包時注意事項（禁止事項・必須事項）。常時表示 */
  specWarnings?: SpecWarning[] | null
  /** マスタ（customer_product_rules）の参考情報。ここでは編集不可（取引先詳細の規格編集で変更）。 */
  masterLabelSpec?: string | null
  masterTapeColor?: string | null
  masterPackingNotes?: string | null
  masterPacksPerCase?: number | null
  /** 荷姿が組合指定等で自動確定できない（pack_configs.needs_manual_confirm）。常時警告表示。 */
  needsManualConfirm?: boolean
  /** 荷姿マスタの作業指示（値駆動表示）。値が入っている項目だけバッジ/行で出す。 */
  packInstructions?: PackInstructionValues | null
  /** 荷姿の作業写真（完成見本/注意点）。横スクロールのサムネイル帯＋タップで拡大。 */
  packPhotos?: PackInstructionPhoto[]
  /** 規格を直す導線に使う（取引先詳細への直リンク／規格報告への事前入力）。 */
  customerId?: string | null
  productId?: string
  /** admin: 取引先詳細の規格編集へ直リンクできる */
  canEditRulesDirectly?: boolean
  /** staff/admin: 規格報告が使える（STAFF_CAN_REPORT_SPEC。adminは常時true） */
  canReportSpec?: boolean
  /** V5 パッキング資材指示（袋・シール・日付） */
  bagType?: string | null
  sealText?: string | null
  hasSeal?: boolean | null
  deliveryDate?: string
  isAdmin?: boolean
  /** 翌日以降の先行予定カード（薄グレー背景＋視覚的分離表示） */
  isNextDay?: boolean
  onMoveUp?: () => void
  onMoveDown?: () => void
  /** 出荷済ボタンを表示するかどうか（出荷専用画面でのみ true、パック画面では非表示にしてパック済ボタンを大きく配置） */
  showShippingButton?: boolean
  /** 受注原本（FAX/PDF・メール本文）。無ければリンク非表示（手動追加など） */
  receipt?: ReceiptOriginalInfo | null
  /** ステータス変更直後（即時）に呼ばれる。親Stateの status と version を同期する */
  onStatusChange?: (itemId: string, newStatus: FieldStatus, newVersion: number) => void
  /** ステータス確定（Undo猶予経過 or 戻す操作）時に呼ばれる。親がステータス順に並べ替える */
  onStatusSettled?: (itemId: string, status: RowStatusKey) => void
  /** 削除された瞬間に呼ばれる（親が並びから除く） */
  onDeleted?: (itemId: string) => void
  /** 途中数（できた数）が更新された瞬間に呼ばれる。親のリアルタイム進捗メーターと即時同期する */
  onShippedQtyChange?: (itemId: string, newQty: number | null) => void
  /** 規格・荷姿が更新された瞬間に呼ばれる。親の内訳メーターと即時同期する */
  onDetailsChange?: (itemId: string, newSpec: string | null, newContainer: string | null) => void
}

/**
 * 出荷一覧の1行（Laravel版 画面2の ◀▶ ＋ 荷姿アコーディオン）。
 * ▶=前進、◀=確認付きで1段戻す（安全版タップループ・features.md §7）。
 * 「詳細」を開くと 規格・荷姿・カード有無・追記事項 を確認/上書きできる（規則から自動補完済み）。
 * 金額は一切表示しない（現場が品目と数量に集中するため）。
 */
export function ShipmentRow({
  itemId,
  customerName,
  customerColor,
  destinationName,
  quantityText,
  orderedQty,
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
  bagType,
  sealText,
  hasSeal,
  deliveryDate,
  onMoveUp,
  onMoveDown,
  showShippingButton = false,
  isNextDay = false,
  receipt,
  onStatusChange,
  onStatusSettled,
  onDeleted,
  onShippedQtyChange,
  onDetailsChange,
}: ShipmentRowProps) {
  const router = useRouter()
  const { enqueue } = useOutbox()
  const [status, setStatus] = useState<FieldStatus>(initialStatus)
  const [version, setVersion] = useState(initialVersion)
  const [busy, setBusy] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [offlinePending, setOfflinePending] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [specConfirmOpen, setSpecConfirmOpen] = useState(false)
  // ステータス変更直後の「元に戻す」猶予（誤タップ対策・Issue#5）。猶予中は並べ替えない。
  const [undoGrace, setUndoGrace] = useState<FieldStatus | null>(null)
  const undoTimerRef = useRef<number | null>(null)
  // 削除確認
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // アコーディオン（荷姿）
  const [open, setOpen] = useState(false)
  const [spec, setSpec] = useState(initialSpec ?? '')
  const [container, setContainer] = useState(initialContainer ?? '')
  const [hasCard, setHasCard] = useState(Boolean(initialHasCard))
  const [lineNote, setLineNote] = useState(initialLineNote ?? '')
  // 現場の記録（中断時の部分完了数・現場メモ）
  const [shippedQty, setShippedQty] = useState(initialShippedQty == null ? '' : String(initialShippedQty))
  const [fieldNote, setFieldNote] = useState(initialFieldNote ?? '')
  const [savingDetails, setSavingDetails] = useState(false)
  // 行から開かずに「できた数」を素早く記録するクイック入力
  const [quickOpen, setQuickOpen] = useState(false)
  const [savingQuick, setSavingQuick] = useState(false)
  // 現場メモ専用クイック入力
  const [noteOpen, setNoteOpen] = useState(false)
  const [savingNote, setSavingNote] = useState(false)

  const meta = FIELD_STATUS_META[status]
  // 「途中で止まった」= できた数が受注総数に満たない。出荷前でも記録できる。
  const shippedNum = shippedQty.trim() === '' ? null : Number(shippedQty)
  const isPartial = shippedNum != null && Number.isFinite(shippedNum) && shippedNum < orderedQty

  // ケース数・端数パックの計算（GAS版UI用）:
  // 1. masterPacksPerCase があれば最優先
  // 2. quantityText に "12c10" のような表記があればパース
  // 3. なければ規格（spec/masterLabelSpec/customerName）から入数を自動判定（チンゲン菜標準20、NSK24等）
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
        packsPerCase = 20 // チンゲン菜の標準入数
      }
    }
  }

  let casesText = '—'
  let looseText = '0'
  if (packsPerCase && packsPerCase > 0) {
    casesText = String(Math.floor(orderedQty / packsPerCase))
    looseText = String(orderedQty % packsPerCase)
  } else {
    casesText = String(Math.floor(orderedQty / 20))
    looseText = String(orderedQty % 20)
  }

  // 親からのProps変更を内部Stateへ安全に同期（通信中やUndo猶予中の上書きを防ぐガード付き）
  useEffect(() => {
    if (!busy && !undoGrace) {
      setStatus(initialStatus)
      setVersion(initialVersion)
    }
  }, [initialStatus, initialVersion, busy, undoGrace])

  useEffect(() => {
    setShippedQty(initialShippedQty == null ? '' : String(initialShippedQty))
  }, [initialShippedQty])

  useEffect(() => {
    setFieldNote(initialFieldNote ?? '')
  }, [initialFieldNote])

    // アンマウント時に猶予タイマーを掃除（画面遷移してもサーバー状態は反映済み）
  useEffect(() => {
    return () => {
      if (undoTimerRef.current != null) window.clearTimeout(undoTimerRef.current)
    }
  }, [])

  /** 猶予タイマーを開始。経過したら親に確定を通知し、所属グループへ並べ替えてもらう。 */
  function startUndoGrace(from: FieldStatus, settled: FieldStatus) {
    if (undoTimerRef.current != null) window.clearTimeout(undoTimerRef.current)
    setUndoGrace(from)
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
      const isNetworkOrAbort = (typeof navigator !== 'undefined' && !navigator.onLine) || err?.name === 'AbortError' || e instanceof TypeError
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

  /** 猶予中の「元に戻す」。既存の reset API（1段戻す・楽観ロック）をそのまま使う。 */
  async function undoAdvance() {
    if (undoTimerRef.current != null) {
      window.clearTimeout(undoTimerRef.current)
      undoTimerRef.current = null
    }
    setUndoGrace(null)
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
      // 戻した結果は即座に確定として親へ通知（並び順を最新化）
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
      // サーバー集計（品目グループ見出し・ステータス件数・「のこり」）を最新化する
      router.refresh()
    } catch (e) {
      toast.error(fieldErrorMessage(e, '削除に失敗しました'))
    } finally {
      setDeleting(false)
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
    try {
      const res = await fetch(`/api/order-items/${itemId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          spec: spec || null,
          container_type: container || null,
          has_card: hasCard,
          line_note: lineNote || null,
          shipped_qty: shippedNum != null && Number.isFinite(shippedNum) ? shippedNum : null,
          field_note: fieldNote || null,
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
      onShippedQtyChange?.(itemId, shippedNum != null && Number.isFinite(shippedNum) ? shippedNum : null)
      onDetailsChange?.(itemId, spec || null, container || null)
      if ((spec && spec !== initialSpec) || (container && container !== initialContainer)) {
        toast.success('記録を保存し、規格・荷姿を自動学習ループへ蓄積しました 💡')
      } else {
        toast.success('記録を保存しました')
      }
      router.refresh()
    } catch (e) {
      toast.error(fieldErrorMessage(e, '保存に失敗しました'))
    } finally {
      setSavingDetails(false)
    }
  }

  /** クイック入力：現場メモ（field_note）だけを即保存。集計値・画面状態も同期する。 */
  async function saveQuickNote() {
    setSavingNote(true)
    try {
      const res = await fetch(`/api/order-items/${itemId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          field_note: fieldNote.trim() || null,
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
      toast.success('メモを保存しました')
      setNoteOpen(false)
      router.refresh()
    } catch (e) {
      toast.error(fieldErrorMessage(e, 'メモの保存に失敗しました'))
    } finally {
      setSavingNote(false)
    }
  }

  /** クイック入力：できた数（shipped_qty）だけを即保存。荷姿・メモは触らない。 */
  async function saveQuick() {
    setSavingQuick(true)
    try {
      const res = await fetch(`/api/order-items/${itemId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          shipped_qty: shippedNum != null && Number.isFinite(shippedNum) ? shippedNum : null,
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
      onShippedQtyChange?.(itemId, shippedNum != null && Number.isFinite(shippedNum) ? shippedNum : null)
      toast.success('できた数を記録しました')
      setQuickOpen(false)
      router.refresh()
    } catch (e) {
      toast.error(fieldErrorMessage(e, '保存に失敗しました'))
    } finally {
      setSavingQuick(false)
    }
  }

  const fieldInput =
    'h-10 w-full rounded border border-line-strong bg-bg-card px-3 text-sm text-ink focus:outline-none focus:border-trust-500 focus:ring-2 focus:ring-trust-100'

  const todayStr = jstTodayStr()
  const tomorrowStr = shiftDateStr(todayStr, 1)

  const isTodayOrder = deliveryDate === todayStr && !isNextDay
  const isTomorrowOrder = deliveryDate === tomorrowStr && !isNextDay
  const isFutureOrNextDay = isNextDay || Boolean(deliveryDate && deliveryDate > tomorrowStr)

  return (
    <div
      className={cn(
        'rounded-2xl border p-3.5 shadow-sm transition-all duration-200',
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
            : 'border-emerald-300/80 bg-emerald-50/40 shadow-xs'
          : status === 'shipped'
          ? 'border-sky-300 bg-sky-50/30'
          : status === 'packed'
          ? 'border-emerald-300 bg-emerald-50/30'
          : 'border-line bg-white shadow-xs',
        conflict ? 'animate-pulse-alert border-alert ring-2 ring-alert/20' : '',
      )}
    >
      {/* 日付識別ヘッダーバッジ（今日＝スカイブルー 🚚 / 明日＝エメラルド 🥬 / 翌日先行＝スレートチャコール 📅） */}
      {isFutureOrNextDay ? (
        <div className="mb-2.5 flex items-center justify-between rounded-xl bg-slate-200 border border-slate-300 px-3 py-1.5 text-xs font-black text-slate-800 shadow-2xs">
          <span className="flex items-center gap-1.5">
            <span className="text-sm">📅</span>
            <span>翌日作業予定（先行作業・確認用）</span>
          </span>
          <span className="rounded bg-slate-700 text-white px-2 py-0.5 text-[10px] font-bold">
            {deliveryDate ? `${deliveryDate} 出荷` : '翌日出荷分'}
          </span>
        </div>
      ) : isTodayOrder ? (
        <div className="mb-2.5 flex items-center justify-between rounded-xl bg-sky-100 border border-sky-300 px-3 py-1.5 text-xs font-black text-sky-950 shadow-2xs">
          <span className="flex items-center gap-1.5">
            <span className="text-sm">🚚</span>
            <span>当日出荷分（本日便）</span>
          </span>
          <span className="rounded bg-sky-700 text-white px-2 py-0.5 text-[10px] font-bold">
            {deliveryDate} 出荷
          </span>
        </div>
      ) : isTomorrowOrder ? (
        <div className="mb-2.5 flex items-center justify-between rounded-xl bg-emerald-100/90 border border-emerald-300 px-3 py-1.5 text-xs font-black text-emerald-950 shadow-2xs">
          <span className="flex items-center gap-1.5">
            <span className="text-sm">🥬</span>
            <span>明日出荷分（本日パック作業対象）</span>
          </span>
          <span className="rounded bg-emerald-700 text-white px-2 py-0.5 text-[10px] font-bold">
            {deliveryDate} 出荷
          </span>
        </div>
      ) : null}

      {/* 競合・更新アラート（ワンタップ自己修復） */}
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

      {/* 圏外一時保存バッジ */}
      {offlinePending && (
        <div className="mb-2 flex items-center gap-1.5 rounded-lg bg-amber-50 border border-amber-200 px-2.5 py-1 text-[11px] font-bold text-amber-800">
          <span>📡 圏外のため一時保存中（電波復帰時に自動送信されます）</span>
        </div>
      )}

      {/* ① 見出し情報: 納品先 ＆ 品名・規格 */}
      <div className="space-y-1.5 pb-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 flex-wrap">
            <ColorDot color={customerColor} name={customerName} size="md" />
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              {/* 取引先名（最優先・特大フォント） */}
              <span className="font-black text-ink text-xl sm:text-2xl tracking-tight">
                {customerName}
              </span>

              {/* 納品先名（取引先の後に続く・大きく見やすいフォント） */}
              {destinationName && customerName !== destinationName && (
                <span className="font-extrabold text-forest-800 text-lg sm:text-xl tracking-tight flex items-center gap-1">
                  <span className="text-ink-muted text-base font-normal">▶</span>
                  {destinationName}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1">
            {lineNote?.includes('★新規追加') && (
              <span className="inline-flex items-center rounded-md bg-orange-500 px-2.5 py-0.5 text-xs font-black text-white shadow-xs">
                新規 ★
              </span>
            )}
            {(needsManualConfirm || lineNote?.includes('⚠') || lineNote?.includes('数量変更:')) && (
              <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 border border-amber-300 px-2 py-0.5 text-xs font-black text-amber-900 shadow-xs">
                ⚠️ 注意（要確認）
              </span>
            )}
          </div>
        </div>
        <div className="flex items-start justify-between gap-2">
          <div className="text-base font-extrabold text-ink leading-tight">
            {spec || masterLabelSpec ? `${spec || masterLabelSpec}` : (customerName)}
          </div>
          {(onMoveUp || onMoveDown) && (
            <div className="flex items-center gap-1 shrink-0">
              {onMoveUp && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onMoveUp()
                  }}
                  disabled={busy}
                  className="h-7 w-7 rounded-lg border border-line bg-white text-xs font-bold text-ink-soft hover:bg-bg-soft disabled:opacity-40"
                  title="上へ移動"
                >
                  ▲
                </button>
              )}
              {onMoveDown && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onMoveDown()
                  }}
                  disabled={busy}
                  className="h-7 w-7 rounded-lg border border-line bg-white text-xs font-bold text-ink-soft hover:bg-bg-soft disabled:opacity-40"
                  title="下へ移動"
                >
                  ▼
                </button>
              )}
            </div>
          )}
        </div>

        {/* GAS版準拠：数量変更・要確認のオレンジ警告バー（常時露出） */}
        {lineNote && (lineNote.includes('数量変更:') || lineNote.includes('⚠')) && (
          <div className="mt-1.5 rounded-xl border-l-4 border-orange-500 bg-orange-50 px-3 py-2 text-xs font-bold text-orange-950">
            ⚠️ 注意: {lineNote}
          </div>
        )}

        {/* 資材タグバー（実際に指定・存在する項目のみ表示・「カード不要」などの不要な否定記述は一切非表示） */}
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          {container && (
            <span className="inline-flex items-center gap-1 rounded-md bg-sky-50 px-2.5 py-0.5 text-xs font-bold text-sky-900 border border-sky-200">
              📦 {container}
            </span>
          )}
          {hasCard && (
            <span className="inline-flex items-center rounded-md bg-indigo-50 px-2.5 py-0.5 text-xs font-bold text-indigo-800 border border-indigo-200">
              🃏 カード有
            </span>
          )}
          {bagType && (
            <span className="inline-flex items-center rounded-md bg-amber-50 px-2.5 py-0.5 text-xs font-bold text-amber-800 border border-amber-200">
              🛍️ {bagType}
            </span>
          )}
          {(hasSeal || sealText) && (
            <span className="inline-flex items-center rounded-md bg-rose-50 px-2.5 py-0.5 text-xs font-bold text-rose-800 border border-rose-200">
              🏷️ {sealText || 'シール有'}
            </span>
          )}
          {masterTapeColor && (
            <span className="inline-flex items-center rounded-md bg-emerald-50 px-2.5 py-0.5 text-xs font-bold text-emerald-800 border border-emerald-200">
              テープ: {masterTapeColor}
            </span>
          )}
          {masterPackingNotes && (
            <span className="inline-flex items-center rounded-md bg-purple-50 px-2.5 py-0.5 text-xs font-bold text-purple-800 border border-purple-200">
              📝 {masterPackingNotes}
            </span>
          )}
        </div>
      </div>

      {/* ② 数量グリッド（ケース数 / 端数パック） */}
      <div className="grid grid-cols-2 gap-2 mb-2">
        <div className="rounded-xl border border-line bg-bg-soft/40 p-2.5 text-center">
          <span className="block text-xs sm:text-sm font-bold text-ink">ケース数</span>
          <span className="num mt-0.5 block text-xl font-black text-ink tabular-nums">
            {casesText !== '—' ? `${casesText} ケース` : `${quantityText}`}
          </span>
        </div>
        <div className="rounded-xl border border-line bg-bg-soft/40 p-2.5 text-center">
          <span className="block text-xs sm:text-sm font-bold text-ink">端数パック</span>
          <div className="num mt-0.5 flex items-center justify-center gap-1.5 tabular-nums">
            <span className="text-xl font-black text-ink">
              {looseText !== '—' ? `${looseText} P` : '0 P'}
            </span>
            {Number(looseText) > 0 && (
              <span className="inline-flex items-center rounded-md bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-900 border border-amber-300">
                1コンテナ
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ③ 【最重要】総パック数カード（今日便＝スカイネイビー / 本日パック＝フォレストグリーン / 翌日先行＝シックなチャコール） */}
      <div
        className={cn(
          'rounded-xl p-3.5 text-white mb-3 shadow-sm transition-colors',
          isFutureOrNextDay
            ? 'bg-[#334155] border border-slate-500/30'
            : isTodayOrder
            ? 'bg-[#0369a1] border border-sky-600/30'
            : 'bg-[#1b5e20]',
        )}
      >
        <div className="flex items-center justify-between text-sm font-black text-white/95 tracking-wide">
          <span>
            {isFutureOrNextDay
              ? '総パック数（翌日先行分）'
              : isTodayOrder
              ? '総パック数（当日出荷分）'
              : '総パック数'}
          </span>
          {isFutureOrNextDay ? (
            <span className="rounded bg-slate-800/80 px-2 py-0.5 text-[10px] font-bold text-slate-300">
              📅 翌日作業枠
            </span>
          ) : isTodayOrder ? (
            <span className="rounded bg-sky-900/80 px-2 py-0.5 text-[10px] font-bold text-sky-200">
              🚚 当日便
            </span>
          ) : (
            <span className="rounded bg-emerald-900/80 px-2 py-0.5 text-[10px] font-bold text-emerald-200">
              🥬 本日パック
            </span>
          )}
        </div>
        <div className="num mt-0.5 text-3xl font-black tracking-tight text-white tabular-nums">
          {orderedQty} <span className="text-lg font-bold text-white/80">P</span>
        </div>
      </div>

      {/* ⑤ アクションボタン（モバイル最適化・大きなタップターゲット） */}
      <div className="space-y-2">
        {/* 1段目: メインステータスボタン（パック画面では「パック済」のみを全幅で大きく表示） */}
        <div className={cn('grid gap-2', showShippingButton ? 'grid-cols-2' : 'grid-cols-1')}>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (status === 'not_started') {
                advanceTo('packed')
              } else if (status === 'packed') {
                setConfirmOpen(true)
              }
            }}
            className={cn(
              'h-12 rounded-xl text-base font-bold shadow-xs transition-all active:scale-[0.98]',
              status === 'packed'
                ? 'bg-emerald-600 text-white ring-2 ring-emerald-600 ring-offset-1'
                : status === 'shipped'
                ? 'border border-line bg-bg-soft/70 text-ink-muted'
                : 'border-2 border-emerald-600/50 bg-white text-emerald-800 hover:bg-emerald-50',
            )}
          >
            {status === 'packed' ? '✓ パック済' : 'パック済にする'}
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
                'h-12 rounded-xl text-base font-bold shadow-xs transition-all active:scale-[0.98]',
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
        </div>

        {/* 2段目: 補助ボタン [ 途中数 ] [ 💬 メモ ]（大きく押しやすい2大ボタン・排他制御） */}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => {
              setQuickOpen(!quickOpen)
              if (!quickOpen) setNoteOpen(false)
            }}
            className={cn(
              "h-12 rounded-xl border text-sm font-bold shadow-xs transition-all active:scale-[0.97]",
              isPartial
                ? "border-amber-400 bg-amber-100 text-amber-950 font-black ring-1 ring-amber-400"
                : "border-line-strong bg-white text-ink hover:bg-bg-soft",
            )}
          >
            {isPartial ? `途中 (${shippedNum}P)` : "途中数"}
          </button>

          <button
            type="button"
            onClick={() => {
              setNoteOpen(!noteOpen)
              if (!noteOpen) setQuickOpen(false)
            }}
            className={cn(
              "h-12 rounded-xl border text-sm font-bold shadow-xs transition-all active:scale-[0.97]",
              fieldNote.trim() !== ''
                ? "border-blue-400 bg-blue-50 text-blue-950 font-black ring-1 ring-blue-300"
                : "border-line-strong bg-white text-ink hover:bg-bg-soft",
            )}
          >
            {fieldNote.trim() !== '' ? '💬 メモあり' : '💬 メモ'}
          </button>
        </div>
      </div>

      {/* ⑥ 開閉トグルリンク */}
      <div className="pt-2 text-center">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="inline-flex items-center gap-1 text-xs font-semibold text-ink-soft hover:text-ink py-1"
        >
          <span>{open ? '詳細を閉じる' : '詳細を見る'}</span>
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
        </button>
      </div>

      {/* ステータス変更直後の「元に戻す」猶予バー */}
      {undoGrace && (
        <div
          data-guide="undo-bar"
          className="mt-2 flex items-center justify-between gap-2 rounded-xl border border-harvest-200 bg-harvest-50/80 px-3 py-2"
        >
          <span className="flex items-center gap-1.5 text-xs font-bold text-harvest-700">
            <Check className="h-4 w-4" aria-hidden />
            {meta.label}に更新しました
          </span>
          <button
            type="button"
            onClick={undoAdvance}
            disabled={busy}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-line-strong bg-white px-3 text-xs font-bold text-ink hover:bg-bg-soft"
          >
            <Undo2 className="h-3.5 w-3.5" aria-hidden />
            元に戻す
          </button>
        </div>
      )}

      {/* 規格警告（禁止事項・必須事項） */}
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

      {/* クイックメモ入力パネル */}
      {noteOpen && (
        <div className="mt-2 space-y-2 rounded-xl border border-blue-200 bg-blue-50/70 p-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-blue-950">現場メモ・特記事項:</span>
            {fieldNote.trim() !== '' && (
              <button
                type="button"
                onClick={() => setFieldNote('')}
                className="text-xs text-ink-faint hover:text-ink font-bold"
              >
                クリア
              </button>
            )}
          </div>
          <input
            type="text"
            className={cn(fieldInput, 'h-10 text-sm font-bold text-ink')}
            value={fieldNote}
            onChange={(e) => setFieldNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault()
                saveQuickNote()
              }
            }}
            placeholder="例: 午前便に積込 / 黄コンテナ使用 / 傷み注意 等"
            autoFocus
          />
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setNoteOpen(false)}
              className="rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-bold text-ink-soft hover:bg-bg-soft"
            >
              閉じる
            </button>
            <Button size="sm" onClick={saveQuickNote} isLoading={savingNote}>
              メモを保存
            </Button>
          </div>
        </div>
      )}

      {/* クイック途中数入力 */}
      {quickOpen && (
        <div className="mt-2 flex items-center gap-2 rounded-xl border border-harvest-200 bg-harvest-50/60 p-2.5">
          <span className="shrink-0 text-xs font-bold text-earth-800">できた数:</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            autoFocus
            className={cn(fieldInput, 'num h-10 w-24 tabular-nums font-bold')}
            value={shippedQty}
            onChange={(e) => setShippedQty(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault()
                saveQuick()
              }
            }}
            placeholder="例: 20"
          />
          <span className="shrink-0 text-xs text-ink-muted">／ 受注 {orderedQty}</span>
          <div className="ml-auto flex items-center gap-1.5">
            {shippedQty !== '' && (
              <button
                type="button"
                onClick={() => setShippedQty('')}
                className="rounded px-2 py-1 text-xs text-ink-faint hover:bg-bg-soft"
              >
                クリア
              </button>
            )}
            <Button size="sm" onClick={saveQuick} isLoading={savingQuick}>
              保存
            </Button>
          </div>
        </div>
      )}

      {/* ⑦ 詳細アコーディオンカード群（薄枠カードリスト形式） */}
      {open && (
        <div className="mt-2 space-y-2 border-t border-line/60 pt-3">
          {/* 状態カード */}
          <div className="rounded-xl border border-line bg-bg-card p-2.5">
            <span className="block text-xs font-bold text-ink-soft">状態</span>
            <span className="text-sm font-bold text-ink">
              {status === 'shipped' ? '出荷済' : status === 'packed' ? 'パック済' : '有効（未着手）'}
            </span>
          </div>

          {/* 注文キーカード */}
          <div className="rounded-xl border border-line bg-bg-card p-2.5">
            <span className="block text-xs font-bold text-ink-soft">注文キー</span>
            <span className="num break-all text-sm font-medium text-ink">
              {`${customerName}|${destinationName ?? customerName}|${spec || masterLabelSpec || '規格未設定'}`}
            </span>
          </div>

          {/* 数量（原文）カード */}
          <div className="rounded-xl border border-line bg-bg-card p-2.5">
            <span className="block text-xs font-bold text-ink-soft">数量（原文）</span>
            <span className="num text-sm font-bold text-ink">
              総数{orderedQty}点（
              {casesText !== '—'
                ? Number(looseText) > 0
                  ? `${casesText}ケース＋端数1コンテナ(${looseText}点) 計${Number(casesText) + 1}箱`
                  : `${casesText}ケース`
                : quantityText}
              ）
            </span>
          </div>

          {/* コンテナ（原文）カード */}
          <div className="rounded-xl border border-line bg-bg-card p-2.5">
            <span className="block text-xs font-bold text-ink-soft">コンテナ（原文）</span>
            <span className="text-sm font-bold text-ink">
              {container
                ? `${container}: ${
                    casesText !== '—'
                      ? Number(looseText) > 0
                        ? `${casesText}箱＋端数1コンテナ (計${Number(casesText) + 1}箱)`
                        : `${casesText}箱`
                      : `${orderedQty}箱`
                  }`
                : '—'}
            </span>
          </div>

          {/* 備考カード */}
          <div className="rounded-xl border border-line bg-bg-card p-2.5">
            <span className="block text-xs font-bold text-ink-soft">備考</span>
            <span className="text-sm text-ink">{lineNote || '—'}</span>
          </div>

          {/* 原本ファイルカード（FAX元データへの直接ジャンプ） */}
          {receipt?.hasOriginal && (receipt.originalUrl || receipt.id) ? (
            <div className="rounded-xl border border-trust-200 bg-trust-50/60 p-3 flex items-center justify-between gap-3 shadow-2xs">
              <div>
                <span className="block text-xs font-black text-trust-900">📄 受注原本（FAX / OCR）</span>
                <span className="text-xs text-ink-soft">受信した元FAX画像やPDFを全画面で確認</span>
              </div>
              <Link
                href={receipt.originalUrl || `/field/viewer/${receipt.id}?date=${deliveryDate ?? ''}`}
                className="h-9 px-3.5 rounded-lg bg-trust-700 text-white text-xs font-black shadow-xs hover:bg-trust-800 active:scale-95 transition flex items-center gap-1.5 shrink-0"
              >
                <span>原本を見る</span>
              </Link>
            </div>
          ) : receipt && !receipt.hasOriginal ? (
            <div className="rounded-xl border border-line bg-bg-card p-2.5 flex items-center justify-between gap-2">
              <div>
                <span className="block text-xs font-bold text-ink-soft">📄 受注原本（FAX / OCR）</span>
                <span className="text-xs text-ink-muted">原本ファイル未登録（テキストのみ取込または手動作成データ）</span>
              </div>
              <span className="rounded bg-bg-soft px-2 py-0.5 text-[11px] font-bold text-ink-muted shrink-0">
                原本なし
              </span>
            </div>
          ) : null}

          {/* 追記メモカード */}
          <div className="rounded-xl border border-line bg-bg-card p-2.5">
            <span className="block text-xs font-bold text-ink-soft">追記メモ</span>
            <span className="text-sm text-ink">{fieldNote || '—'}</span>
          </div>

          {/* 登録元カード */}
          <div className="rounded-xl border border-line bg-bg-card p-2.5">
            <span className="block text-xs font-bold text-ink-soft">登録元</span>
            <span className="text-sm text-ink">{receipt ? '受信明細 (FAX/OCR)' : '受注明細'}</span>
          </div>

          {/* 荷姿マスタ作業指示 */}
          {packInstructions && (
            <PackInstructions values={packInstructions} photos={packPhotos ?? []} variant="field" />
          )}

          {/* マスタ参考情報 */}
          {(masterLabelSpec || masterTapeColor || masterPackingNotes || masterPacksPerCase) && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-line bg-bg-card/60 p-2.5 text-xs text-ink-soft">
              <span className="font-bold text-ink-muted">マスタ（参考）</span>
              {masterPacksPerCase != null && <span>入り数 {masterPacksPerCase}</span>}
              {masterLabelSpec && <span>ラベル: {masterLabelSpec}</span>}
              {masterTapeColor && <span>テープ: {masterTapeColor}</span>}
              {masterPackingNotes && <span>{masterPackingNotes}</span>}
            </div>
          )}

          {/* 編集フォーム */}
          <div className="rounded-xl border border-line bg-bg-soft/30 p-3 space-y-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="space-y-1">
                <span className="text-xs font-medium text-ink-soft">荷姿</span>
                <input className={fieldInput} value={container} onChange={(e) => setContainer(e.target.value)} placeholder="青コン / 黄コン / 箱" />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium text-ink-soft">規格</span>
                <input className={fieldInput} value={spec} onChange={(e) => setSpec(e.target.value)} placeholder="2〜3株(入数20) / L / 200g 等" />
              </label>
            </div>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={hasCard} onChange={(e) => setHasCard(e.target.checked)} className="h-5 w-5 accent-earth-600 rounded" />
              <span className="text-xs font-medium text-ink">カード同梱</span>
            </label>
            <label className="space-y-1 block">
              <span className="text-xs font-medium text-ink-soft">追記事項</span>
              <textarea
                className={cn(fieldInput, 'h-auto py-2')}
                rows={2}
                value={lineNote}
                onChange={(e) => setLineNote(e.target.value)}
                placeholder="この出荷だけの指示"
              />
            </label>
            <div className="space-y-1">
              <span className="text-xs font-medium text-ink-soft">現場メモ（中断・気づき）</span>
              <textarea
                className={cn(fieldInput, 'h-auto py-2')}
                rows={2}
                value={fieldNote}
                onChange={(e) => setFieldNote(e.target.value)}
                placeholder="何かあれば（例: 20個で中断・続きは明日）"
              />
            </div>
            <div className="flex items-center justify-between gap-2 pt-1">
              <button
                type="button"
                onClick={() => setDeleteOpen(true)}
                className="inline-flex items-center gap-1 rounded px-2 py-1.5 text-xs font-medium text-alert hover:bg-alert/5"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
                この明細を削除
              </button>
              <Button size="sm" onClick={handleSaveDetails} isLoading={savingDetails}>
                保存
              </Button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        open={specConfirmOpen}
        onClose={() => setSpecConfirmOpen(false)}
        onConfirm={async () => {
          setSpecConfirmOpen(false)
          await executeSaveDetails()
        }}
        title="規格・荷姿を変更しますか？"
        message="規格や荷姿を変更すると、パック進捗や出荷集計に直接影響します。本当に変更しますか？"
        confirmLabel="変更して保存"
        isLoading={savingDetails}
      />

      <ConfirmModal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={reset}
        title="ステータスを1段戻しますか？"
        message={`「${customerName} / ${quantityText}」を ${meta.label} から1段戻します。出荷済みを戻す場合、出荷実績は取り消されます。`}
        confirmLabel="戻す"
        isLoading={busy}
      />

      <ConfirmModal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={deleteItem}
        title="この明細を削除しますか？"
        message={`「${customerName} / ${quantityText}」を削除します。この操作は取り消せません。出荷済み・請求確定済みの明細は削除できません。`}
        confirmLabel="削除する"
        isLoading={deleting}
      />
    </div>
  )
}
