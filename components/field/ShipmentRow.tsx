'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft, ChevronRight, ChevronDown, Circle, Check, Truck, IdCard, PauseCircle, StickyNote, AlertTriangle, ShieldCheck, Trash2, Settings, Camera, Undo2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { cn } from '@/lib/cn'
import type { FieldStatus, SpecWarning } from '@/types/database'
import { ColorDot } from '@/components/ui/ColorDot'
import { nextFieldStatus, canAdvance, FIELD_STATUS_META } from '@/lib/field/tap-loop'
import { rowStatusKey, type RowStatusKey } from '@/lib/field/shipment-sort'
import { FIELD_STATUS_STYLE, fieldStatusStyle } from '@/lib/field/status-style'
import { ConfirmModal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { PackInstructions, type PackInstructionValues, type PackInstructionPhoto } from '@/components/admin/PackInstructions'
import { ReceiptOriginalTrigger } from '@/components/admin/ReceiptOriginalViewer'
import { fieldErrorMessage } from '@/lib/field/net-error'
import type { ReceiptOriginalInfo } from '@/lib/orders/pending'

const ICONS = { circle: Circle, check: Check, truck: Truck } as const

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
  onMoveUp?: () => void
  onMoveDown?: () => void
  /** 出荷済ボタンを表示するかどうか（出荷専用画面でのみ true、パック画面では非表示にしてパック済ボタンを大きく配置） */
  showShippingButton?: boolean
  /** 受注原本（FAX/PDF・メール本文）。無ければリンク非表示（手動追加など） */
  receipt?: ReceiptOriginalInfo | null
  /** ステータス確定（Undo猶予経過 or 戻す操作）時に呼ばれる。親がステータス順に並べ替える */
  onStatusSettled?: (itemId: string, status: RowStatusKey) => void
  /** 削除された瞬間に呼ばれる（親が並びから除く） */
  onDeleted?: (itemId: string) => void
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
  customerId,
  productId,
  canEditRulesDirectly,
  canReportSpec,
  bagType,
  sealText,
  hasSeal,
  deliveryDate,
  isAdmin,
  onMoveUp,
  onMoveDown,
  showShippingButton = false,
  receipt,
  onStatusSettled,
  onDeleted,
}: ShipmentRowProps) {
  const router = useRouter()
  const [status, setStatus] = useState<FieldStatus>(initialStatus)
  const [version, setVersion] = useState(initialVersion)
  const [busy, setBusy] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
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

  const meta = FIELD_STATUS_META[status]
  const Icon = ICONS[meta.icon]
  const hasDetails = spec || container || hasCard || lineNote || masterLabelSpec || masterTapeColor || masterPackingNotes
  // 「途中で止まった」= できた数が受注総数に満たない。出荷前でも記録できる。
  const shippedNum = shippedQty.trim() === '' ? null : Number(shippedQty)
  const isPartial = shippedNum != null && Number.isFinite(shippedNum) && shippedNum < orderedQty
  // 中断＝できた数が受注未満で、まだ出荷していない。梱包完了（全量）と明確に区別する。
  const interrupted = isPartial && status !== 'shipped'
  const statusKey = rowStatusKey(status, isPartial ? shippedNum : null, orderedQty)

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
    }, UNDO_GRACE_MS)
  }

  async function advanceTo(target: FieldStatus) {
    if (busy || status === target) return
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
      startUndoGrace(prev, target)
    } catch (e) {
      setStatus(prev)
      toast.error(fieldErrorMessage(e, '更新に失敗しました'))
    } finally {
      setBusy(false)
    }
  }

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
      // すぐには並べ替えず、猶予中は「元に戻す」を出す（誤タップ対策・Issue#5）
      startUndoGrace(prev, target)
    } catch (e) {
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
      // 戻した結果は即座に確定として親へ通知（並び順を最新化）
      onStatusSettled?.(
        itemId,
        rowStatusKey(json.item.field_status, isPartial ? shippedNum : null, orderedQty),
      )
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

  async function saveDetails() {
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
      toast.success('記録を保存しました')
    } catch (e) {
      toast.error(fieldErrorMessage(e, '保存に失敗しました'))
    } finally {
      setSavingDetails(false)
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
      toast.success('できた数を記録しました')
      setQuickOpen(false)
    } catch (e) {
      toast.error(fieldErrorMessage(e, '保存に失敗しました'))
    } finally {
      setSavingQuick(false)
    }
  }

  const fieldInput =
    'h-10 w-full rounded border border-line-strong bg-bg-card px-3 text-sm text-ink focus:outline-none focus:border-trust-500 focus:ring-2 focus:ring-trust-100'

  return (
    <div
      className={cn(
        'rounded-2xl border bg-bg-card p-3.5 shadow-sm transition-all duration-200',
        status === 'shipped'
          ? 'border-sky-300 bg-sky-50/15'
          : status === 'packed'
          ? 'border-emerald-300 bg-emerald-50/15'
          : 'border-line',
        conflict ? 'animate-pulse-alert border-alert' : '',
      )}
    >
      {/* ① 見出し情報: 納品先 ＆ 品名・規格 */}
      <div className="space-y-1 pb-3">
        <div className="flex flex-wrap items-center justify-between gap-1.5 text-xs text-ink-soft">
          <div className="flex items-center gap-1.5">
            <ColorDot color={customerColor} name={customerName} size="sm" />
            <span>納品先 : </span>
            <span className="font-bold text-ink">{destinationName || customerName}</span>
            {destinationName && customerName !== destinationName && (
              <span className="text-[11px] text-ink-muted">({customerName})</span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {lineNote?.includes('★新規追加') && (
              <span className="inline-flex items-center rounded-md bg-orange-500 px-2 py-0.5 text-[11px] font-black text-white shadow-xs">
                新規 ★
              </span>
            )}
            {(needsManualConfirm || lineNote?.includes('⚠') || lineNote?.includes('数量変更:')) && (
              <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 border border-amber-300 px-2 py-0.5 text-[11px] font-black text-amber-900">
                ⚠️ 要確認
              </span>
            )}
          </div>
        </div>
        <div className="flex items-start justify-between gap-2">
          <div className="text-base font-extrabold text-ink leading-tight">
            {spec || masterLabelSpec ? `${spec || masterLabelSpec}` : (customerName)}
          </div>
          {isAdmin && (onMoveUp || onMoveDown) && (
            <div className="flex items-center gap-1 shrink-0">
              {onMoveUp && (
                <button
                  type="button"
                  onClick={onMoveUp}
                  className="h-7 w-7 rounded-lg border border-line bg-white text-xs font-bold text-ink-soft hover:bg-bg-soft"
                  title="上へ移動"
                >
                  ▲
                </button>
              )}
              {onMoveDown && (
                <button
                  type="button"
                  onClick={onMoveDown}
                  className="h-7 w-7 rounded-lg border border-line bg-white text-xs font-bold text-ink-soft hover:bg-bg-soft"
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
            🔄 {lineNote}
          </div>
        )}

        {/* 資材タグバー（袋・シール・カード） */}
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          {bagType && (
            <span className="inline-flex items-center rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-800 border border-amber-200">
              🛍️ {bagType}
            </span>
          )}
          {(hasSeal || sealText) && (
            <span className="inline-flex items-center rounded-md bg-rose-50 px-2 py-0.5 text-[11px] font-bold text-rose-800 border border-rose-200">
              🏷️ {sealText || 'シール有'}
            </span>
          )}
          {hasCard && (
            <span className="inline-flex items-center rounded-md bg-indigo-50 px-2 py-0.5 text-[11px] font-bold text-indigo-800 border border-indigo-200">
              🃏 カード有
            </span>
          )}
        </div>
      </div>

      {/* ② 数量グリッド（ケース数 / 端数パック） */}
      <div className="grid grid-cols-2 gap-2 mb-2">
        <div className="rounded-xl border border-line bg-bg-soft/40 p-2.5 text-center">
          <span className="block text-[11px] font-medium text-ink-soft">ケース数</span>
          <span className="num mt-0.5 block text-xl font-black text-ink tabular-nums">
            {casesText !== '—' ? `${casesText} ケース` : `${quantityText}`}
          </span>
        </div>
        <div className="rounded-xl border border-line bg-bg-soft/40 p-2.5 text-center">
          <span className="block text-[11px] font-medium text-ink-soft">端数パック</span>
          <span className="num mt-0.5 block text-xl font-black text-ink tabular-nums">
            {looseText !== '—' ? `${looseText} P` : '0 P'}
          </span>
        </div>
      </div>

      {/* ③ 【最重要】総パック数カード（フォレストグリーンの巨大ハイライトブロック） */}
      <div className="rounded-xl bg-[#1b5e20] p-3.5 text-white mb-2 shadow-sm">
        <div className="text-[11px] font-bold text-white/90 tracking-wide">総パック数</div>
        <div className="num mt-0.5 text-3xl font-black tracking-tight text-white tabular-nums">
          {orderedQty} <span className="text-lg font-bold text-white/80">P</span>
        </div>
      </div>

      {/* ④ コンテナ・箱数カード */}
      <div className="rounded-xl border border-line bg-bg-card p-2.5 flex items-center justify-between mb-3 shadow-xs">
        <span className="text-xs font-semibold text-ink-soft">コンテナ・箱数</span>
        <div className="flex items-center gap-1.5">
          <span className="inline-flex items-center rounded-md bg-sky-100 px-2 py-0.5 text-xs font-bold text-sky-800">
            {container || '青コン'}
          </span>
          <span className="num text-base font-black text-ink tabular-nums">
            {casesText !== '—' ? `${casesText} 箱` : `${orderedQty} 箱`}
          </span>
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

        {/* 2段目: 補助ボタン [ 途中数 ] [ 追記 ] [ ✏️ 編集 ] [ 原本を開く ] */}
        <div className="grid grid-cols-4 gap-1.5">
          <button
            type="button"
            onClick={() => setQuickOpen(!quickOpen)}
            className={cn(
              'h-10 rounded-xl border text-xs font-bold transition-all active:scale-[0.97]',
              isPartial
                ? 'border-harvest-300 bg-harvest-100 text-earth-800 font-extrabold'
                : 'border-line bg-white text-ink-soft hover:bg-bg-soft',
            )}
          >
            {isPartial ? `途中(${shippedNum})` : '途中数'}
          </button>

          <button
            type="button"
            onClick={() => setOpen(!open)}
            className="h-10 rounded-xl border border-line bg-white text-xs font-bold text-ink-soft hover:bg-bg-soft active:scale-[0.97]"
          >
            追記
          </button>

          <button
            type="button"
            onClick={() => {
              if (
                window.confirm(
                  '⚠️【注意】注文数量や荷姿を変更すると、記録されたパック済・途中数がリセットされ、収穫・出荷の総数が変わります。変更を続けますか？',
                )
              ) {
                setOpen(true)
              }
            }}
            className="h-10 rounded-xl border border-line bg-white text-xs font-bold text-ink-soft hover:bg-bg-soft active:scale-[0.97]"
          >
            ✏️ 編集
          </button>

          {receipt?.id ? (
            <a
              href={`/field/viewer/${receipt.id}?date=${deliveryDate || ''}`}
              className="inline-flex h-10 items-center justify-center rounded-xl border border-sky-300 bg-sky-50 text-xs font-bold text-sky-700 hover:bg-sky-100 active:scale-[0.97]"
            >
              原本を開く
            </a>
          ) : receipt?.originalUrl ? (
            <a
              href={receipt.originalUrl}
              target="_blank"
              rel="noopener"
              className="inline-flex h-10 items-center justify-center rounded-xl border border-sky-300 bg-sky-50 text-xs font-bold text-sky-700 hover:bg-sky-100 active:scale-[0.97]"
            >
              原本を開く
            </a>
          ) : (
            <button
              type="button"
              disabled
              className="h-10 rounded-xl border border-line bg-bg-soft/50 text-xs font-medium text-ink-faint"
            >
              原本なし
            </button>
          )}
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
              <span key={i} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-bold text-alert bg-alert/10">
                <AlertTriangle className="h-3 w-3" aria-hidden />
                {w.text}
              </span>
            ) : (
              <span key={i} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-bold text-harvest-700 bg-harvest-50">
                <ShieldCheck className="h-3 w-3" aria-hidden />
                {w.text}
              </span>
            ),
          )}
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
            <span className="block text-[10px] font-bold text-ink-muted">状態</span>
            <span className="text-xs font-bold text-ink">
              {status === 'shipped' ? '出荷済' : status === 'packed' ? 'パック済' : '有効（未着手）'}
            </span>
          </div>

          {/* 注文キーカード */}
          <div className="rounded-xl border border-line bg-bg-card p-2.5">
            <span className="block text-[10px] font-bold text-ink-muted">注文キー</span>
            <span className="num break-all text-xs font-medium text-ink">
              {`${customerName}|${destinationName ?? customerName}|${spec || masterLabelSpec || '規格未設定'}`}
            </span>
          </div>

          {/* 数量（原文）カード */}
          <div className="rounded-xl border border-line bg-bg-card p-2.5">
            <span className="block text-[10px] font-bold text-ink-muted">数量（原文）</span>
            <span className="num text-xs font-bold text-ink">
              総数{orderedQty}点（{casesText !== '—' ? `${casesText}ケース＋端数${looseText}点` : quantityText}）
            </span>
          </div>

          {/* コンテナ（原文）カード */}
          <div className="rounded-xl border border-line bg-bg-card p-2.5">
            <span className="block text-[10px] font-bold text-ink-muted">コンテナ（原文）</span>
            <span className="text-xs font-bold text-ink">
              {container ? `${container}: ${casesText !== '—' ? casesText : orderedQty}箱` : '—'}
            </span>
          </div>

          {/* 備考カード */}
          <div className="rounded-xl border border-line bg-bg-card p-2.5">
            <span className="block text-[10px] font-bold text-ink-muted">備考</span>
            <span className="text-xs text-ink">{lineNote || '—'}</span>
          </div>

          {/* 原本ファイルカード */}
          {receipt?.originalUrl && (
            <div className="rounded-xl border border-line bg-bg-card p-2.5">
              <span className="block text-[10px] font-bold text-ink-muted">原本ファイル</span>
              <a
                href={receipt.originalUrl}
                target="_blank"
                rel="noopener"
                className="text-xs font-bold text-trust-700 hover:underline inline-flex items-center gap-1"
              >
                原本を開く ↗
              </a>
            </div>
          )}

          {/* 追記メモカード */}
          <div className="rounded-xl border border-line bg-bg-card p-2.5">
            <span className="block text-[10px] font-bold text-ink-muted">追記メモ</span>
            <span className="text-xs text-ink">{fieldNote || '—'}</span>
          </div>

          {/* 登録元カード */}
          <div className="rounded-xl border border-line bg-bg-card p-2.5">
            <span className="block text-[10px] font-bold text-ink-muted">登録元</span>
            <span className="text-xs text-ink">{receipt ? '受信明細 (FAX/OCR)' : '受注明細'}</span>
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
              <Button size="sm" onClick={saveDetails} isLoading={savingDetails}>
                保存
              </Button>
            </div>
          </div>
        </div>
      )}

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
