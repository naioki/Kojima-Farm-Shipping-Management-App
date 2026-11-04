'use client'

import { useEffect, useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import {
  Truck,
  ChevronDown,
  AlertTriangle,
  Edit3,
  Check,
  Loader2,
  Plus,
  FileDown,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { cn } from '@/lib/cn'
import { ColorDot } from '@/components/ui/ColorDot'
import { Button } from '@/components/ui/Button'
import { ConfirmModal } from '@/components/ui/Modal'
import { fieldErrorMessage } from '@/lib/field/net-error'
import { getContainerColorStyle } from '@/lib/field/container-style'
import { QuickDepartureTimeEditor } from '@/components/field/QuickDepartureTimeEditor'
import { extractActionableNote } from '@/lib/field/clean-note'
import { useFieldLang } from '@/lib/field/lang-context'
import { getThaiContainer, getContainerColorEmoji, THAI_LABELS } from '@/lib/field/thai-dict'
import { isDriverDeliveryNoteCustomer, resolveDefaultIssuerPreset } from '@/lib/delivery-notes/driver-note'

export interface DestinationDetail {
  destinationId: string | null
  destinationName: string
  shippingRouteName?: string | null
  departureTime?: string | null
  containerType?: string | null
  cases: number
  loose: number
  fractionBoxes: number
  totalBoxes: number
  totalQty: number
  items: Array<{
    id: string
    productName: string
    quantityText: string
    unit: string
    noteText: string
    quantity: number
    fieldStatus?: string
  }>
  status: 'planned' | 'loaded' | 'delivered'
}

export interface CustomerDeliveryCardProps {
  customerId: string
  customerName: string
  customerColor?: string | null
  deliveryDate: string
  totalCases: number
  totalFractionBoxes: number
  totalFractionPacks: number
  grandTotalContainers: number
  totalQty: number
  notes: string[]
  isCompleted: boolean
  destinations: DestinationDetail[]
  routeSummaries?: Array<{
    title: string
    departureTime: string | null
  }>
  shippingRouteName?: string | null
  departureTime?: string | null
  earliestDepartureTime?: string | null
  /** 便・時間順グループ表示時にセクション見出しとの時刻二重表示を避けるフラグ（#15） */
  hideParentTimeChip?: boolean
  onCompletionChange?: (customerId: string, isCompleted: boolean) => void
}

/**
 * 便別積込・配送リストの1カードコンポーネント（v5.1.10 重複完全排除版）。
 * - 【#15 解消】「便・時間順」モードでセクション見出しに時刻が出ている場合は、カード内の時刻チップをスリムな「⏰ 出荷時間」ボタンにして同じ時刻文字列の反復を排除。
 */
export function CustomerDeliveryCard({
  customerId,
  customerName,
  customerColor,
  deliveryDate,
  totalFractionBoxes,
  totalFractionPacks,
  grandTotalContainers,
  totalQty,
  notes: initialNotes,
  isCompleted: initialIsCompleted,
  destinations: initialDestinations,
  routeSummaries = [],
  earliestDepartureTime,
  hideParentTimeChip = false,
  onCompletionChange,
}: CustomerDeliveryCardProps) {
  const router = useRouter()
  const { isThaiMode } = useFieldLang()
  const [isCompleted, setIsCompleted] = useState<boolean>(initialIsCompleted)
  const [destinations, setDestinations] = useState<DestinationDetail[]>(initialDestinations)
  const [open, setOpen] = useState<boolean>(() => initialDestinations.length > 1 && !initialIsCompleted)
  const [expandedWhenDone, setExpandedWhenDone] = useState<boolean>(false)
  const [busy, setBusy] = useState<boolean>(false)
  const [unpackedConfirmOpen, setUnpackedConfirmOpen] = useState<boolean>(false)
  const [pendingDestConfirm, setPendingDestConfirm] = useState<{
    destId: string | null
    currentStatus: string
    destName: string
    unpackedCount: number
  } | null>(null)

  const allDeliveryItems = destinations.flatMap((d) => d.items).filter((it) => (Number(it.quantity) || 0) > 0)
  const packedItemCount = allDeliveryItems.filter(
    (it) => it.fieldStatus === 'packed' || it.fieldStatus === 'shipped',
  ).length
  const unpackedItemCount = Math.max(0, allDeliveryItems.length - packedItemCount)

  const isDriverNoteTarget = isDriverDeliveryNoteCustomer(customerName)
  const driverNoteDefaultIssuer = resolveDefaultIssuerPreset(customerName)
  const driverNotePdfHref = isDriverNoteTarget
    ? `/api/delivery-notes/pdf?customer=${customerId}&date=${deliveryDate}&amount=none&issuer=${driverNoteDefaultIssuer}&layout=2up`
    : null

  const containerSummary = (() => {
    const map = new Map<string, number>()
    for (const d of destinations) {
      if (d.totalBoxes <= 0) continue
      const cType = d.containerType || '通常コンテナ'
      map.set(cType, (map.get(cType) ?? 0) + d.totalBoxes)
    }
    return Array.from(map.entries()).map(([type, boxes]) => ({ type, boxes }))
  })()

  const productSummary = (() => {
    const map = new Map<string, { qty: number; unit: string }>()
    for (const it of allDeliveryItems) {
      const cur = map.get(it.productName) ?? { qty: 0, unit: it.unit || 'P' }
      cur.qty += Number(it.quantity) || 0
      map.set(it.productName, cur)
    }
    return Array.from(map.entries()).map(([name, v]) => ({ name, qty: v.qty, unit: v.unit }))
  })()

  useEffect(() => {
    setIsCompleted(initialIsCompleted)
  }, [initialIsCompleted])

  useEffect(() => {
    setDestinations(initialDestinations)
  }, [initialDestinations])

  const cleanedInitialNotes = useMemo(
    () =>
      Array.from(
        new Set(
          initialNotes
            .map((n) => extractActionableNote(n))
            .filter((n): n is string => Boolean(n && n.trim())),
        ),
      ),
    [initialNotes],
  )

  const [notes, setNotes] = useState<string[]>(cleanedInitialNotes)
  const [editingNote, setEditingNote] = useState<boolean>(false)
  const [noteInput, setNoteInput] = useState<string>(cleanedInitialNotes.join(' / '))
  const [savingNote, setSavingNote] = useState<boolean>(false)

  useEffect(() => {
    setNotes(cleanedInitialNotes)
    setNoteInput(cleanedInitialNotes.join(' / '))
  }, [cleanedInitialNotes])

  const destinationIds = destinations.map((d) => d.destinationId)

  async function toggleLoaded() {
    if (busy) return
    const nextCompleted = !isCompleted
    const nextAction = isCompleted ? 'revert' : 'loaded'
    const prevCompleted = isCompleted
    const prevDestinations = destinations
    setIsCompleted(nextCompleted)
    if (nextCompleted) setExpandedWhenDone(false)
    setDestinations((prev) =>
      prev.map((d) => ({ ...d, status: nextCompleted ? 'loaded' : 'planned' })),
    )
    onCompletionChange?.(customerId, nextCompleted)
    setBusy(true)
    try {
      const res = await fetch('/api/deliveries/confirm-customer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          delivery_date: deliveryDate,
          customer_id: customerId,
          destination_ids: destinationIds,
          action: nextAction,
        }),
      })
      if (!res.ok) {
        throw new Error('積込ステータスの更新に失敗しました')
      }
      toast.success(prevCompleted ? '未積込に戻しました' : '🚚 積込チェックを完了しました')
      router.refresh()
    } catch (e) {
      setIsCompleted(prevCompleted)
      setDestinations(prevDestinations)
      onCompletionChange?.(customerId, prevCompleted)
      toast.error(fieldErrorMessage(e, '更新に失敗しました'))
    } finally {
      setBusy(false)
    }
  }

  async function toggleDestination(destId: string | null, currentStatus: string) {
    if (busy) return
    const nextAction = currentStatus === 'loaded' || currentStatus === 'delivered' ? 'revert' : 'loaded'
    const nextStatus: DestinationDetail['status'] = nextAction === 'loaded' ? 'loaded' : 'planned'
    const prevDestinations = destinations
    const prevCompleted = isCompleted
    const updatedDestinations = destinations.map((d) =>
      d.destinationId === destId ? { ...d, status: nextStatus } : d,
    )
    const nextAllCompleted =
      updatedDestinations.length > 0 &&
      updatedDestinations.every((d) => d.status === 'loaded' || d.status === 'delivered')

    setDestinations(updatedDestinations)
    setIsCompleted(nextAllCompleted)
    if (nextAllCompleted) setExpandedWhenDone(false)
    onCompletionChange?.(customerId, nextAllCompleted)
    setBusy(true)
    try {
      const res = await fetch('/api/deliveries/confirm-customer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          delivery_date: deliveryDate,
          customer_id: customerId,
          destination_ids: [destId],
          action: nextAction,
        }),
      })
      if (!res.ok) {
        throw new Error('納品先ステータスの更新に失敗しました')
      }
      toast.success(nextAction === 'loaded' ? '納品先の積込をOKにしました' : '未積込に戻しました')
      router.refresh()
    } catch (e) {
      setDestinations(prevDestinations)
      setIsCompleted(prevCompleted)
      onCompletionChange?.(customerId, prevCompleted)
      toast.error(fieldErrorMessage(e, '更新に失敗しました'))
    } finally {
      setBusy(false)
    }
  }

  async function saveNote() {
    setSavingNote(true)
    try {
      const res = await fetch('/api/deliveries/note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          delivery_date: deliveryDate,
          customer_id: customerId,
          note: noteInput.trim() || null,
        }),
      })
      if (!res.ok) throw new Error('メモの保存に失敗しました')
      const updated = noteInput.trim() ? [noteInput.trim()] : []
      setNotes(updated)
      setEditingNote(false)
      toast.success('特記事項を保存しました')
      router.refresh()
    } catch (e) {
      toast.error(fieldErrorMessage(e, 'メモの保存に失敗しました'))
    } finally {
      setSavingNote(false)
    }
  }

  const hasNote = notes.length > 0 && notes.some((n) => n.trim().length > 0)
  const noteDisplay = notes.filter((n) => n.trim().length > 0).join(' ・ ')
  const isCollapsedDone = isCompleted && !expandedWhenDone

  return (
    <div
      className={cn(
        'rounded-2xl border transition-all duration-200 overflow-hidden',
        isCollapsedDone
          ? 'border-emerald-300 bg-emerald-50/70 px-3.5 py-2.5 shadow-2xs'
          : isCompleted
          ? 'border-slate-300 bg-slate-50/80 shadow-2xs'
          : 'border-slate-300 bg-white shadow-md border-l-4 border-l-emerald-600',
      )}
    >
      {/* 積込済1行スリム表示 */}
      {isCollapsedDone ? (
        <div
          onClick={() => setExpandedWhenDone(true)}
          className="flex items-center justify-between gap-2 cursor-pointer select-none print:hidden"
          title="タップしてカードを展開"
        >
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span className="inline-flex items-center gap-0.5 rounded-md bg-emerald-600 px-2 py-0.5 text-xs font-black text-white shrink-0 shadow-2xs">
              <Check className="h-3.5 w-3.5" />
              <span>積込済</span>
            </span>
            <ColorDot color={customerColor} name={customerName} size="sm" />
            <span className="font-black text-ink text-sm sm:text-base truncate">
              {customerName}
            </span>
            {destinations.length === 1 && destinations[0]?.destinationName && destinations[0].destinationName !== customerName && (
              <span className="inline-flex items-center gap-0.5 rounded bg-emerald-100/90 border border-emerald-300 px-1.5 py-0.5 text-xs font-black text-emerald-900 shrink-0">
                <span>▶</span>
                <span className="truncate max-w-[120px]">{destinations[0].destinationName}</span>
              </span>
            )}
            {destinations.length > 1 && (
              <span className="rounded bg-emerald-100 text-emerald-900 px-1.5 py-0.5 text-[11px] font-bold shrink-0">
                {destinations.length}納品先
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <span className="num text-sm sm:text-base font-black text-ink tabular-nums">
              {grandTotalContainers}箱
              <span className="text-xs font-bold text-ink-soft ml-1">
                ({totalQty.toLocaleString()}P)
              </span>
            </span>
            {driverNotePdfHref && (
              <a
                href={driverNotePdfHref}
                target="_blank"
                rel="noopener"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex h-8 items-center gap-1 rounded-lg border border-emerald-300 bg-white px-2 text-xs font-black text-emerald-900 hover:bg-emerald-50 transition"
                title="運転手渡し用の納品書（A4上下2連・金額なし）をPDFで開きます"
              >
                <FileDown className="h-3.5 w-3.5 text-emerald-700" />
                <span>納品書</span>
              </a>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={(e) => {
                e.stopPropagation()
                void toggleLoaded()
              }}
              className="h-8 rounded-lg border border-line-strong bg-white px-2.5 text-xs font-bold text-ink-soft hover:bg-bg-soft active:scale-95 transition"
              title="未積込に戻す"
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
          <div className="p-3.5 space-y-2.5">
            {/* ① 上段: 取引先名 & 特大表示の総積込数 */}
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-2 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <ColorDot color={customerColor} name={customerName} size="md" />
                  <h2
                    className={cn(
                      'font-display text-lg sm:text-xl font-black leading-snug',
                      isCompleted ? 'text-slate-600' : 'text-ink',
                    )}
                  >
                    {customerName}
                  </h2>
                  {destinations.length === 1 && destinations[0]?.destinationName && destinations[0].destinationName !== customerName && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg bg-emerald-50 border border-emerald-300 text-emerald-900 font-black text-sm tracking-tight leading-snug shadow-2xs">
                      <span className="text-emerald-700 text-xs">▶</span>
                      <span>{destinations[0].destinationName}</span>
                    </span>
                  )}
                  {isCompleted && (
                    <button
                      type="button"
                      onClick={() => setExpandedWhenDone(false)}
                      className="rounded-lg border border-line bg-white px-2 py-0.5 text-xs font-bold text-ink-soft hover:bg-bg-soft"
                    >
                      1行に畳む ▲
                    </button>
                  )}
                </div>

                {/* 時間指定（便・時間順モード時はグループヘッダーと時刻が重複しないようコンパクトボタン化 #15） ＆ パック進捗連動バッジ */}
                <div className="flex flex-wrap items-center gap-1.5 text-xs font-bold text-ink-soft">
                  {(destinations.length <= 1 || !open) && (
                    <QuickDepartureTimeEditor
                      deliveryDate={deliveryDate}
                      customerId={customerId ?? ''}
                      destinationId={destinations[0]?.destinationId ?? null}
                      customerName={customerName}
                      destinationName={destinations[0]?.destinationName ?? null}
                      currentDepartureTime={earliestDepartureTime ?? (destinations[0]?.departureTime || null)}
                      currentShippingRouteName={destinations[0]?.shippingRouteName || (routeSummaries[0]?.title ?? null)}
                      variant={hideParentTimeChip ? 'button' : 'chip'}
                    />
                  )}

                  {allDeliveryItems.length > 0 && (
                    unpackedItemCount > 0 ? (
                      <span className="inline-flex items-center gap-1 rounded-md border border-amber-400 bg-amber-100 px-2 py-0.5 text-xs font-black text-amber-950 shadow-2xs">
                        {isThaiMode ? (
                          <span>⚠️ {THAI_LABELS.notCompletedWarn} ({unpackedItemCount})</span>
                        ) : (
                          <span>⚠️ パック未完了 {unpackedItemCount}件</span>
                        )}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-xs font-black text-emerald-800">
                        {isThaiMode ? (
                          <span>✓ {THAI_LABELS.allPackedDone}</span>
                        ) : (
                          <span>✓ 全パック済</span>
                        )}
                      </span>
                    )
                  )}
                  {driverNotePdfHref && (
                    <a
                      href={driverNotePdfHref}
                      target="_blank"
                      rel="noopener"
                      className="inline-flex items-center gap-1 rounded-md border border-emerald-400 bg-emerald-50 px-2 py-0.5 text-xs font-black text-emerald-950 hover:bg-emerald-100 shadow-2xs transition"
                      title="運転手渡し用の納品書（A4上下2連・金額なし）をPDFで開きます"
                    >
                      <FileDown className="h-3 w-3 text-emerald-700" />
                      <span>📄 納品書PDF</span>
                    </a>
                  )}
                </div>

                {/* コンテナ種別箱数 ＋ 品目バッジ */}
                {(containerSummary.length > 0 || productSummary.length > 0) && (
                  <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                    {containerSummary.map((cs) => {
                      const style = getContainerColorStyle(cs.type)
                      const thaiContainer = isThaiMode ? getThaiContainer(style.label) : null
                      const emoji = getContainerColorEmoji(style.label)
                      return (
                        <span
                          key={cs.type}
                          className={cn(
                            'inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs sm:text-sm font-black shadow-2xs',
                            style.badgeClass,
                          )}
                        >
                          {thaiContainer ? (
                            <>
                              <span>{emoji} {thaiContainer}</span>
                              <span className="num underline decoration-2 ml-0.5">{cs.boxes} {THAI_LABELS.casesUnit}</span>
                            </>
                          ) : (
                            <>
                              <span>{emoji} {style.label}</span>
                              <span className="num underline decoration-2">{cs.boxes}箱</span>
                            </>
                          )}
                        </span>
                      )
                    })}
                    {productSummary.map((ps) => (
                      <span
                        key={ps.name}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-slate-50 px-2 py-0.5 text-xs font-black text-ink"
                      >
                        <span>🥬 {ps.name}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* 右側: 特大フォントの総積込箱数 ＋ 総パック数 */}
              <div className="text-right shrink-0">
                <div className="text-[11px] font-bold text-ink-muted">
                  {isThaiMode ? THAI_LABELS.totalLoadBoxes : '総積込箱数'}
                </div>
                <div
                  className={cn(
                    'num text-3xl sm:text-4xl font-black tabular-nums tracking-tight leading-none my-0.5',
                    isCompleted ? 'text-slate-500' : 'text-ink',
                  )}
                >
                  {grandTotalContainers}
                  <span className="text-base sm:text-lg font-black text-ink-soft ml-1">
                    {isThaiMode ? THAI_LABELS.casesUnit : '箱'}
                  </span>
                </div>
                {totalFractionBoxes > 0 && (
                  <div className="inline-block rounded-md bg-amber-200 border border-amber-400 px-2 py-0.5 text-xs font-black text-amber-950 my-0.5">
                    ＋端数 {totalFractionBoxes}箱 ({totalFractionPacks}P)
                  </div>
                )}
                <div className="text-xs font-bold text-ink-soft tabular-nums">
                  ({totalQty.toLocaleString()} P)
                </div>
              </div>
            </div>

            {/* ② 中段: 特記事項・メモ */}
            {hasNote && !editingNote && (
              <div
                onClick={() => setEditingNote(true)}
                className="rounded-xl border-l-4 border-amber-500 bg-amber-50/90 p-2.5 text-xs sm:text-sm font-bold text-amber-950 flex items-center justify-between gap-2 cursor-pointer hover:bg-amber-100/90 transition-colors shadow-2xs"
                title="タップして編集"
              >
                <span className="flex items-center gap-1.5 min-w-0">
                  <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                  <span className="truncate">📝 {noteDisplay}</span>
                </span>
                <span className="text-xs text-amber-800 underline shrink-0 flex items-center gap-0.5">
                  <Edit3 className="h-3 w-3" />
                  編集
                </span>
              </div>
            )}

            {editingNote && (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-2.5 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-amber-950">📝 特記事項・積み込み前メモ:</span>
                  <button
                    type="button"
                    onClick={() => setNoteInput('')}
                    className="text-xs text-ink-faint hover:text-ink font-bold"
                  >
                    クリア
                  </button>
                </div>
                <input
                  type="text"
                  value={noteInput}
                  onChange={(e) => setNoteInput(e.target.value)}
                  placeholder="例: 空コンテナ20個持参 / 手前に積むこと / 伝票別添え 等"
                  className="w-full h-10 rounded-lg border border-amber-300 bg-white px-3 text-xs sm:text-sm font-bold text-ink focus:outline-none focus:ring-2 focus:ring-amber-400"
                  autoFocus
                />
                <div className="flex items-center justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setEditingNote(false)}
                    className="rounded-lg border border-line bg-white px-3 py-1 text-xs font-bold text-ink-soft hover:bg-bg-soft"
                  >
                    キャンセル
                  </button>
                  <Button size="sm" onClick={saveNote} isLoading={savingNote}>
                    保存する
                  </Button>
                </div>
              </div>
            )}

            {/* ③ 下段: 内訳開閉ボタン ＆ 【積込 OK】大ボタン */}
            <div className="flex items-center justify-between gap-3 pt-1 border-t border-line/60">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(!open)}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-bold transition-colors active:scale-98',
                    open
                      ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
                      : 'border-line bg-bg-soft/70 text-ink-soft hover:text-ink hover:bg-bg-soft',
                  )}
                >
                  <span>{open ? `内訳を閉じる (${destinations.length}件)` : `納品先・品目内訳 (${destinations.length}件)`}</span>
                  <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
                </button>

                {!hasNote && !editingNote && (
                  <button
                    type="button"
                    onClick={() => setEditingNote(true)}
                    className="inline-flex items-center gap-1 rounded-lg border border-dashed border-line px-2 py-1 text-xs font-bold text-ink-muted hover:text-ink hover:border-line-strong transition-colors"
                    title="特記事項を追加"
                  >
                    <Plus className="h-3 w-3" />
                    <span>メモ</span>
                  </button>
                )}
              </div>

              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (!isCompleted && unpackedItemCount > 0) {
                    setUnpackedConfirmOpen(true)
                    return
                  }
                  toggleLoaded()
                }}
                className={cn(
                  'h-12 px-5 sm:px-7 rounded-xl font-black text-sm sm:text-base transition-all active:scale-97 shadow-sm flex items-center justify-center gap-2 shrink-0',
                  isCompleted
                    ? 'border-2 border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
                    : unpackedItemCount > 0
                    ? 'bg-amber-600 hover:bg-amber-700 text-white ring-2 ring-amber-500 ring-offset-1 shadow-amber-600/20'
                    : 'bg-emerald-600 hover:bg-emerald-700 text-white ring-2 ring-emerald-600 ring-offset-1 shadow-emerald-600/20',
                )}
              >
                {busy ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : isCompleted ? (
                  <div className="flex items-center gap-1.5">
                    <Check className="h-5 w-5 text-emerald-600 stroke-[3]" />
                    <span>✓ 積込済 (戻す)</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <Truck className="h-5 w-5" />
                    <span>{unpackedItemCount > 0 ? '⚠️ 積込 OK' : '🚚 積込 OK'}</span>
                  </div>
                )}
              </button>
            </div>
          </div>

          {/* ④ 納品先・便別 内訳一覧 */}
          <div
            className={cn(
              'bg-bg-soft/50 border-t border-line/60 p-3 space-y-2.5 animate-fadeIn',
              open ? 'block' : 'hidden print:block',
            )}
          >
            <div className="space-y-2">
              {destinations.map((dest, idx) => {
                const isDestLoaded = dest.status === 'loaded' || dest.status === 'delivered'
                const colorStyle = getContainerColorStyle(dest.containerType)

                return (
                  <div
                    key={dest.destinationId ?? idx}
                    className={cn(
                      'rounded-xl border p-3 space-y-2 transition-all border-l-4 shadow-xs',
                      colorStyle.leftBorder,
                      isDestLoaded ? 'border-emerald-200 bg-emerald-50/40 opacity-75' : 'border-line bg-white',
                    )}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line/50 pb-1.5">
                      <span className="text-base font-black text-ink">
                        📍 {dest.destinationName}
                      </span>

                      <QuickDepartureTimeEditor
                        deliveryDate={deliveryDate}
                        customerId={customerId ?? ''}
                        destinationId={dest.destinationId}
                        customerName={customerName}
                        destinationName={dest.destinationName}
                        currentDepartureTime={dest.departureTime ?? null}
                        currentShippingRouteName={dest.shippingRouteName ?? null}
                        variant="chip"
                      />
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className={cn(
                            'inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs sm:text-sm font-black shadow-2xs',
                            colorStyle.badgeClass,
                          )}
                        >
                          {isThaiMode && getThaiContainer(colorStyle.label) ? (
                            <span>
                              {getContainerColorEmoji(colorStyle.label)} {getThaiContainer(colorStyle.label)}
                            </span>
                          ) : (
                            <span>
                              {getContainerColorEmoji(colorStyle.label)} {colorStyle.label}
                            </span>
                          )}
                        </span>

                        <span className="num text-base sm:text-lg font-black text-ink tabular-nums">
                          {dest.totalBoxes} 箱
                          {dest.fractionBoxes > 0 && (
                            <span className="ml-1.5 rounded bg-amber-100 border border-amber-300 px-1.5 py-0.5 text-xs font-black text-amber-950">
                              うち端数 {dest.fractionBoxes}箱 ({dest.loose}P)
                            </span>
                          )}
                          <span className="ml-1.5 text-xs font-bold text-ink-soft">
                            ({dest.totalQty.toLocaleString()} P)
                          </span>
                        </span>
                      </div>

                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          const destUnpacked = dest.items.filter(
                            (it) =>
                              (Number(it.quantity) || 0) > 0 &&
                              it.fieldStatus !== 'packed' &&
                              it.fieldStatus !== 'shipped',
                          ).length
                          if (!isDestLoaded && destUnpacked > 0) {
                            setPendingDestConfirm({
                              destId: dest.destinationId,
                              currentStatus: dest.status,
                              destName: dest.destinationName,
                              unpackedCount: destUnpacked,
                            })
                            return
                          }
                          toggleDestination(dest.destinationId, dest.status)
                        }}
                        className={cn(
                          'h-9 px-3.5 rounded-xl text-xs sm:text-sm font-black transition-all active:scale-95 shadow-2xs shrink-0 flex items-center gap-1 print:hidden',
                          isDestLoaded
                            ? 'bg-emerald-100 text-emerald-800 border border-emerald-300 hover:bg-emerald-200'
                            : 'border-2 border-emerald-600 bg-white text-emerald-700 hover:bg-emerald-50',
                        )}
                      >
                        {isDestLoaded ? (
                          <>
                            <Check className="h-3.5 w-3.5 text-emerald-600 stroke-[3]" />
                            <span>積込済 (戻す)</span>
                          </>
                        ) : (
                          <span>個別積込 OK</span>
                        )}
                      </button>
                    </div>

                    {dest.items.filter((it) => (Number(it.quantity) || 0) > 0).length > 0 && (
                      <div className="space-y-1 border-t border-line/40 pt-1.5 text-xs">
                        {dest.items
                          .filter((it) => (Number(it.quantity) || 0) > 0)
                          .map((it) => {
                            const cleanedItemNote = extractActionableNote(it.noteText === '—' ? null : it.noteText)
                            return (
                              <div
                                key={it.id}
                                className="flex items-center justify-between text-ink-soft py-0.5"
                              >
                                <span className="font-bold text-ink truncate pr-2">
                                  {it.productName}
                                </span>
                                <div className="flex items-center gap-2 shrink-0">
                                  {cleanedItemNote && (
                                    <span className="rounded bg-bg-soft px-1.5 py-0.5 text-[11px] font-bold text-ink-muted">
                                      {cleanedItemNote}
                                    </span>
                                  )}
                                  <span className="num font-black text-ink tabular-nums">
                                    {it.quantityText}
                                  </span>
                                </div>
                              </div>
                            )
                          })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}

      <ConfirmModal
        open={unpackedConfirmOpen}
        onClose={() => setUnpackedConfirmOpen(false)}
        onConfirm={async () => {
          setUnpackedConfirmOpen(false)
          await toggleLoaded()
        }}
        title="⚠️ パック未完了の品目があります。積込OKにしますか？"
        message={`「${customerName}」には収穫・パックボード上でまだ「パック済」になっていない明細が ${unpackedItemCount} 件あります。実物がすべて揃って積み込み完了しているか確認してください。`}
        confirmLabel="実物確認済・積込OKにする"
        isLoading={busy}
      />

      <ConfirmModal
        open={Boolean(pendingDestConfirm)}
        onClose={() => setPendingDestConfirm(null)}
        onConfirm={async () => {
          const target = pendingDestConfirm
          setPendingDestConfirm(null)
          if (target) {
            await toggleDestination(target.destId, target.currentStatus)
          }
        }}
        title="⚠️ この納品先にパック未完了の品目があります"
        message={
          pendingDestConfirm
            ? `「${customerName}（${pendingDestConfirm.destName}）」には、まだ「パック済」になっていない明細が ${pendingDestConfirm.unpackedCount} 件あります。実物が揃って積み込み完了しているか確認してください。`
            : ''
        }
        confirmLabel="実物確認済・個別積込OKにする"
        isLoading={busy}
      />
    </div>
  )
}
