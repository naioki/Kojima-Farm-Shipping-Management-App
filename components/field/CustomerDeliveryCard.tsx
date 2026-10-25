'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Truck,
  CheckCircle2,
  ChevronDown,
  AlertTriangle,
  Edit3,
  Check,
  Loader2,
  Plus,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { cn } from '@/lib/cn'
import { ColorDot } from '@/components/ui/ColorDot'
import { Button } from '@/components/ui/Button'
import { ConfirmModal } from '@/components/ui/Modal'
import { fieldErrorMessage } from '@/lib/field/net-error'
import { getContainerColorStyle } from '@/lib/field/container-style'
import { QuickDepartureTimeEditor } from '@/components/field/QuickDepartureTimeEditor'

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
  notes: string[] // 注文や配送の特記事項
  isCompleted: boolean // 属する納品先がすべて積込OK
  destinations: DestinationDetail[]
  routeSummaries?: Array<{
    title: string
    departureTime: string | null
  }>
  shippingRouteName?: string | null
  departureTime?: string | null
  earliestDepartureTime?: string | null
  onCompletionChange?: (customerId: string, isCompleted: boolean) => void
}

/**
 * 手書き伝票思想の「取引先ワンボックス集約」配送カード。
 * - 案1（物理積込総数最優先型）：右上に「総積込数 24箱」を特大28〜32pxで表示。
 * - サブ内訳：「満杯 22ケース ＋ 端数 2箱 (11P)」
 * - 内訳一覧：コンテナ色（青コン・茶コン等）のカラーバッジ＋太字2段レイアウト。
 */
export function CustomerDeliveryCard({
  customerId,
  customerName,
  customerColor,
  deliveryDate,
  totalCases,
  totalFractionBoxes,
  totalFractionPacks,
  grandTotalContainers,
  totalQty,
  notes: initialNotes,
  isCompleted: initialIsCompleted,
  destinations: initialDestinations,
  routeSummaries = [],
  earliestDepartureTime,
  onCompletionChange,
}: CustomerDeliveryCardProps) {
  const router = useRouter()
  const [isCompleted, setIsCompleted] = useState<boolean>(initialIsCompleted)
  const [destinations, setDestinations] = useState<DestinationDetail[]>(initialDestinations)
  const [open, setOpen] = useState<boolean>(false)
  const [busy, setBusy] = useState<boolean>(false)
  const [unpackedConfirmOpen, setUnpackedConfirmOpen] = useState<boolean>(false)

  // パック進捗連動（全明細のうち何件が packed / shipped か）
  const allDeliveryItems = destinations.flatMap((d) => d.items).filter((it) => (Number(it.quantity) || 0) > 0)
  const packedItemCount = allDeliveryItems.filter(
    (it) => it.fieldStatus === 'packed' || it.fieldStatus === 'shipped',
  ).length
  const unpackedItemCount = Math.max(0, allDeliveryItems.length - packedItemCount)

  // 親からの Props 更新を同期
  useEffect(() => {
    setIsCompleted(initialIsCompleted)
  }, [initialIsCompleted])

  useEffect(() => {
    setDestinations(initialDestinations)
  }, [initialDestinations])

  // メモ編集用の State
  const [notes, setNotes] = useState<string[]>(initialNotes)
  const [editingNote, setEditingNote] = useState<boolean>(false)
  const [noteInput, setNoteInput] = useState<string>(notes.join(' / '))
  const [savingNote, setSavingNote] = useState<boolean>(false)

  useEffect(() => {
    setNotes(initialNotes)
    setNoteInput(initialNotes.join(' / '))
  }, [initialNotes])

  // 納品先ID一覧
  const destinationIds = destinations.map((d) => d.destinationId)

  // サブ内訳テキストの生成（文字拡大 ＆ （満杯 22ケース ＋ 端数 2箱 (11P)）と全体をカッコで囲む）
  const subBreakdownText = (() => {
    if (totalCases > 0 && totalFractionBoxes > 0) {
      return `（満杯 ${totalCases}ケース ＋ 端数 ${totalFractionBoxes}箱 (${totalFractionPacks}P)）`
    }
    if (totalCases > 0) {
      return `（満杯 ${totalCases}ケース）`
    }
    if (totalFractionBoxes > 0) {
      return `（端数 ${totalFractionBoxes}箱 (${totalFractionPacks}P)）`
    }
    return null
  })()

  // 取引先単位の一括ワンタップ積込OKトグル
  async function toggleLoaded() {
    if (busy) return
    const nextCompleted = !isCompleted
    const nextAction = isCompleted ? 'revert' : 'loaded'
    const prevCompleted = isCompleted
    const prevDestinations = destinations
    setIsCompleted(nextCompleted)
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

  // アコーディオン内の個別納品先積込トグル
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

  // メモの保存
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

  return (
    <div
      className={cn(
        'rounded-2xl border transition-all duration-200 overflow-hidden',
        isCompleted
          ? 'border-slate-300 bg-slate-50/80 opacity-75 shadow-2xs'
          : 'border-slate-300 bg-white shadow-md border-l-4 border-l-emerald-600',
      )}
    >
      <div className="p-3.5 space-y-3">
        {/* ① 上段: 取引先名 & 最重要【総積込数（案1: 物理箱数最優先型）】特大表示 */}
        <div className="flex items-start justify-between gap-3">
          {/* 取引先情報 */}
          <div className="space-y-1.5 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <ColorDot color={customerColor} name={customerName} size="md" />
              <h2
                className={cn(
                  'font-display text-lg sm:text-xl font-black truncate',
                  isCompleted ? 'text-slate-600 line-through decoration-slate-400 decoration-2' : 'text-ink',
                )}
              >
                {customerName}
              </h2>

              {/* 完了時の済印風スタンプ */}
              {isCompleted && (
                <span className="inline-flex items-center gap-1 rounded-md border-2 border-emerald-600 bg-emerald-50 px-2 py-0.5 text-xs font-black text-emerald-800 shadow-2xs rotate-[-3deg] select-none">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                  <span>済</span>
                </span>
              )}
            </div>

            {/* 時間指定・所属便設定（タップで即座に変更可能） */}
            <div className="flex flex-wrap items-center gap-1.5 text-xs font-bold text-ink-soft">
              <QuickDepartureTimeEditor
                deliveryDate={deliveryDate}
                customerId={customerId ?? ''}
                destinationId={destinations[0]?.destinationId ?? null}
                customerName={customerName}
                destinationName={destinations[0]?.destinationName ?? null}
                currentDepartureTime={earliestDepartureTime ?? (destinations[0]?.departureTime || null)}
                currentShippingRouteName={destinations[0]?.shippingRouteName || (routeSummaries[0]?.title ?? null)}
                variant="chip"
              />

              {destinations.length > 1 && (
                <span className="text-[11px] text-ink-muted font-bold">
                  (全{destinations.length}納品先)
                </span>
              )}

              {/* パック作業の完了連動バッジ（未作成のまま誤って積込完了にする事故を防止） */}
              {allDeliveryItems.length > 0 && (
                unpackedItemCount > 0 ? (
                  <span className="inline-flex items-center gap-1 rounded-md border border-amber-400 bg-amber-100 px-2 py-0.5 text-[11px] font-black text-amber-950 shadow-2xs">
                    <span>⚠️ パック未完了 {unpackedItemCount}件</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11px] font-black text-emerald-800">
                    <span>✓ 全パック済</span>
                  </span>
                )
              )}
            </div>
          </div>

          {/* 最重要位置: 特大フォントの総積込数（案1: 物理箱数最優先型 28〜32px） */}
          <div className="text-right shrink-0">
            <div className="text-xs font-bold text-ink-muted">総積込数</div>
            <div
              className={cn(
                'num text-[28px] sm:text-[32px] font-black tabular-nums tracking-tight leading-none my-0.5',
                isCompleted ? 'text-slate-500' : 'text-ink',
              )}
            >
              {grandTotalContainers} <span className="text-base sm:text-lg font-black text-ink-soft">箱</span>
            </div>
            {subBreakdownText && (
              <div className="text-sm sm:text-base font-extrabold text-ink-soft my-0.5">
                {subBreakdownText}
              </div>
            )}
            <div className="text-[11px] sm:text-xs font-medium text-ink-muted">
              (総 {totalQty.toLocaleString()}点)
            </div>
          </div>
        </div>

        {/* ② 中段: 事前アクション喚起型メモ（特記事項） */}
        {hasNote && !editingNote && (
          <div
            onClick={() => setEditingNote(true)}
            className="rounded-xl border-l-4 border-amber-500 bg-amber-50/90 p-2.5 text-xs sm:text-sm font-bold text-amber-950 flex items-center justify-between gap-2 cursor-pointer hover:bg-amber-100/90 transition-colors shadow-2xs"
            title="タップして編集"
          >
            <span className="flex items-center gap-1.5 min-w-0">
              <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
              <span className="truncate">⚠️ 注意: 「{noteDisplay}」</span>
            </span>
            <span className="text-xs text-amber-800 underline shrink-0 flex items-center gap-0.5">
              <Edit3 className="h-3 w-3" />
              編集
            </span>
          </div>
        )}

        {/* メモ編集フォーム */}
        {editingNote && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-2.5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-amber-950">⚠️ 特記事項・積み込み前メモ:</span>
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

        {/* ③ 下段: 内訳展開ボタン ＆ 【積込 OK】大ボタン */}
        <div className="flex items-center justify-between gap-3 pt-1 border-t border-line/60">
          {/* 左: 納品先内訳（アコーディオン）開閉トリガー */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setOpen(!open)}
              className="inline-flex items-center gap-1 rounded-lg border border-line bg-bg-soft/70 px-2.5 py-1.5 text-xs font-bold text-ink-soft hover:text-ink hover:bg-bg-soft transition-colors active:scale-98"
            >
              <span>納品先内訳 ({destinations.length}件)</span>
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

          {/* 右: 指で押しやすい特大「積込 OK」ボタン */}
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
              <>
                <Check className="h-5 w-5 text-emerald-600 stroke-[3]" />
                <span>✓ 積込済 (戻す)</span>
              </>
            ) : (
              <>
                <Truck className="h-5 w-5" />
                <span>{unpackedItemCount > 0 ? '⚠️ 積込 OK' : '🚚 積込 OK'}</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* ④ アコーディオン展開時（納品先・便ごとの個別内訳：2段構造＆コンテナカラー化） */}
      {open && (
        <div className="bg-bg-soft/50 border-t border-line/60 p-3 space-y-3 animate-fadeIn">
          <div className="text-xs font-bold text-ink-muted uppercase tracking-wider">
            ▼ 納品先・便別 内訳一覧（全 {destinations.length} 件）
          </div>

          <div className="space-y-2.5">
            {destinations.map((dest, idx) => {
              const isDestLoaded = dest.status === 'loaded' || dest.status === 'delivered'
              const colorStyle = getContainerColorStyle(dest.containerType)

              // 納品先ごとの数量テキスト
              const destQtyText = (() => {
                if (dest.cases > 0 && dest.fractionBoxes > 0) {
                  return `${dest.cases}ケース ＋ 端数 ${dest.fractionBoxes}箱 (${dest.loose}P)`
                }
                if (dest.cases > 0) {
                  return `${dest.cases}ケース`
                }
                if (dest.fractionBoxes > 0) {
                  return `端数 ${dest.fractionBoxes}箱 (${dest.loose}P)`
                }
                return `${dest.totalQty}点`
              })()

              return (
                <div
                  key={dest.destinationId ?? idx}
                  className={cn(
                    'rounded-xl border p-3.5 space-y-2.5 transition-all border-l-4 shadow-xs',
                    colorStyle.leftBorder,
                    isDestLoaded ? 'border-emerald-200 bg-emerald-50/40 opacity-70' : 'border-line bg-white',
                  )}
                >
                  {/* 上段（納品先名 ＋ 時間指定変更チップ）: 16〜17px 太字 */}
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line/50 pb-2">
                    <div className="flex items-center gap-2 flex-wrap min-w-0">
                      <span className="text-[16px] sm:text-[17px] font-black text-ink">
                        📍 {dest.destinationName}
                      </span>
                    </div>

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

                  {/* 下段（コンテナ色バッジ ＋ 必要数量・荷姿 ＆ 個別積込ボタン） */}
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      {/* コンテナ種別のカラーバッジ（14px太字＋太め枠線） */}
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 px-3 py-1 rounded-lg text-sm font-black shadow-2xs',
                          colorStyle.badgeClass,
                        )}
                      >
                        📦 {colorStyle.label}
                      </span>

                      {/* 数量・荷姿（16px 太字） */}
                      <span className="num text-[16px] sm:text-[17px] font-black text-ink tabular-nums">
                        {destQtyText}
                        <span className="ml-1.5 text-xs font-semibold text-ink-muted">
                          (計 {dest.totalBoxes}箱 ／ {dest.totalQty}点)
                        </span>
                      </span>
                    </div>

                    {/* 個別積込ボタン */}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => toggleDestination(dest.destinationId, dest.status)}
                      className={cn(
                        'h-10 px-4 rounded-xl text-sm font-black transition-all active:scale-95 shadow-2xs shrink-0 flex items-center gap-1.5',
                        isDestLoaded
                          ? 'bg-emerald-100 text-emerald-800 border border-emerald-300 hover:bg-emerald-200'
                          : 'border-2 border-emerald-600 bg-white text-emerald-700 hover:bg-emerald-50',
                      )}
                    >
                      {isDestLoaded ? (
                        <>
                          <Check className="h-4 w-4 text-emerald-600 stroke-[3]" />
                          <span>積込済</span>
                        </>
                      ) : (
                        <span>個別積込</span>
                      )}
                    </button>
                  </div>

                  {/* 明細品目リスト（数量0の品目は非表示） */}
                  {dest.items.filter((it) => (Number(it.quantity) || 0) > 0).length > 0 && (
                    <div className="space-y-1 border-t border-line/40 pt-2 text-xs">
                      {dest.items
                        .filter((it) => (Number(it.quantity) || 0) > 0)
                        .map((it) => (
                          <div
                            key={it.id}
                            className="flex items-center justify-between text-ink-soft py-0.5"
                          >
                            <span className="font-bold text-ink truncate pr-2">
                              {it.productName}
                            </span>
                            <div className="flex items-center gap-2 shrink-0">
                              {it.noteText !== '—' && (
                                <span className="rounded bg-bg-soft px-1.5 py-0.5 text-[11px] font-bold text-ink-muted">
                                  {it.noteText}
                                </span>
                              )}
                              <span className="num font-black text-ink tabular-nums">
                                {it.quantityText}
                              </span>
                            </div>
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      <ConfirmModal
        open={unpackedConfirmOpen}
        onClose={() => setUnpackedConfirmOpen(false)}
        onConfirm={async () => {
          setUnpackedConfirmOpen(false)
          await toggleLoaded()
        }}
        title="⚠️ パック未完了の品目があります。積込OKにしますか？"
        message={`「${customerName}」には収穫・袋詰めボード上でまだ「パック済」になっていない明細が ${unpackedItemCount} 件あります。実物がすべて揃って積み込み完了しているか確認してください。`}
        confirmLabel="実物確認済・積込OKにする"
        isLoading={busy}
      />
    </div>
  )
}
