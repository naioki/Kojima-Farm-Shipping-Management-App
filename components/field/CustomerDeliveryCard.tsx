'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Truck,
  CheckCircle2,
  ChevronDown,
  AlertTriangle,
  Clock,
  Edit3,
  Check,
  Undo2,
  Loader2,
  Package,
  Plus,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { cn } from '@/lib/cn'
import { ColorDot } from '@/components/ui/ColorDot'
import { Button } from '@/components/ui/Button'
import { fieldErrorMessage } from '@/lib/field/net-error'

export interface DestinationDetail {
  destinationId: string | null
  destinationName: string
  shippingRouteName?: string | null
  departureTime?: string | null
  cases: number
  loose: number
  totalQty: number
  items: Array<{
    id: string
    productName: string
    quantityText: string
    unit: string
    noteText: string
    quantity: number
  }>
  status: 'planned' | 'loaded' | 'delivered'
}

export interface CustomerDeliveryCardProps {
  customerId: string
  customerName: string
  customerColor?: string | null
  deliveryDate: string
  totalCases: number
  totalLoose: number
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
}

/**
 * 手書き伝票思想の「取引先ワンボックス集約」配送カード。
 * - 取引先単位で総コンテナ数＋端数を最重要位置に特大表示。
 * - 事前アクション喚起型メモ（空コンテナ持参など）を注意ハイライト枠で表示。
 * - 指で押しやすい大きな「積込OK」トグルボタンで一括チェック。完了時は斜線を引いたようにトーンダウン。
 * - 納品先・便ごとの個別内訳はアコーディオン内に格納（デフォルト非表示）。
 */
export function CustomerDeliveryCard({
  customerId,
  customerName,
  customerColor,
  deliveryDate,
  totalCases,
  totalLoose,
  grandTotalContainers,
  totalQty,
  notes: initialNotes,
  isCompleted: initialIsCompleted,
  destinations,
  routeSummaries = [],
  shippingRouteName,
  departureTime,
}: CustomerDeliveryCardProps) {
  const router = useRouter()
  const [isCompleted, setIsCompleted] = useState<boolean>(initialIsCompleted)
  const [open, setOpen] = useState<boolean>(false)
  const [busy, setBusy] = useState<boolean>(false)

  // 親からの Props 更新を同期
  useEffect(() => {
    setIsCompleted(initialIsCompleted)
  }, [initialIsCompleted])

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

  // 特大数量テキストの生成（例: "23 ケース + 端数 2" または "10 ケース"）
  const quantityHeroText = (() => {
    if (totalCases > 0) {
      if (totalLoose > 0) {
        return (
          <span>
            {totalCases} <span className="text-base sm:text-lg font-bold text-ink-soft">ケース</span>
            <span className="mx-1 text-sm font-bold text-ink-muted">＋</span>
            端数 {totalLoose}
          </span>
        )
      }
      return (
        <span>
          {totalCases} <span className="text-base sm:text-lg font-bold text-ink-soft">ケース</span>
        </span>
      )
    }
    if (totalLoose > 0) {
      return <span>端数 {totalLoose}</span>
    }
    return <span>{totalQty} 点</span>
  })()

  // 取引先単位の一括ワンタップ積込OKトグル
  async function toggleLoaded() {
    if (busy) return
    const nextAction = isCompleted ? 'revert' : 'loaded'
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
      setIsCompleted(!isCompleted)
      toast.success(isCompleted ? '未積込に戻しました' : '🚚 積込チェックを完了しました')
      router.refresh()
    } catch (e) {
      toast.error(fieldErrorMessage(e, '更新に失敗しました'))
    } finally {
      setBusy(false)
    }
  }

  // アコーディオン内の個別納品先積込トグル
  async function toggleDestination(destId: string | null, currentStatus: string) {
    if (busy) return
    const nextAction = currentStatus === 'loaded' || currentStatus === 'delivered' ? 'revert' : 'loaded'
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
        {/* ① 上段: 取引先名 & 最重要【総コンテナ数＋端数】特大表示 */}
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

            {/* 所属便・ルートバッジ一覧 */}
            <div className="flex flex-wrap items-center gap-1.5 text-xs font-bold text-ink-soft">
              {routeSummaries.length > 0 ? (
                routeSummaries.map((r, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1 rounded-md bg-slate-100 text-slate-800 border border-slate-200 px-2 py-0.5 text-[11px] font-bold"
                  >
                    <Clock className="h-3 w-3 text-sky-600 shrink-0" />
                    <span>{r.title}</span>
                  </span>
                ))
              ) : (departureTime || shippingRouteName) ? (
                <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 text-slate-800 border border-slate-200 px-2 py-0.5 text-[11px] font-bold">
                  <Clock className="h-3 w-3 text-sky-600 shrink-0" />
                  <span>
                    {departureTime ? `${departureTime}発` : ''}
                    {shippingRouteName ? ` ${shippingRouteName}` : ''}
                  </span>
                </span>
              ) : null}

              {destinations.length > 1 && (
                <span className="text-[11px] text-ink-muted font-bold">
                  (全{destinations.length}納品先)
                </span>
              )}
            </div>
          </div>

          {/* 最重要位置: 特大フォントの総コンテナ数・端数表示 */}
          <div className="text-right shrink-0">
            <div className="text-xs font-bold text-ink-muted">総コンテナ数</div>
            <div
              className={cn(
                'num text-2xl sm:text-3xl font-black tabular-nums tracking-tight',
                isCompleted ? 'text-slate-500' : 'text-ink',
              )}
            >
              {quantityHeroText}
            </div>
            <div className="text-xs font-semibold text-ink-muted">
              (計 {totalQty.toLocaleString()} 点)
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
            onClick={toggleLoaded}
            className={cn(
              'h-12 px-5 sm:px-7 rounded-xl font-black text-sm sm:text-base transition-all active:scale-97 shadow-sm flex items-center justify-center gap-2 shrink-0',
              isCompleted
                ? 'border-2 border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
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
                <span>🚚 積込 OK</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* ④ アコーディオン展開時（各納品先・便ごとの個別数量・品目一覧） */}
      {open && (
        <div className="bg-bg-soft/50 border-t border-line/60 p-3 space-y-2.5 animate-fadeIn">
          <div className="text-xs font-bold text-ink-muted uppercase tracking-wider">
            ▼ 納品先・便別 内訳一覧（全 {destinations.length} 件）
          </div>

          <div className="space-y-2">
            {destinations.map((dest, idx) => {
              const isDestLoaded = dest.status === 'loaded' || dest.status === 'delivered'
              return (
                <div
                  key={dest.destinationId ?? idx}
                  className={cn(
                    'rounded-xl border p-3 space-y-2 transition-all',
                    isDestLoaded ? 'border-emerald-200 bg-emerald-50/40' : 'border-line bg-white shadow-2xs',
                  )}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    {/* 納品先名 & 便情報 */}
                    <div className="flex items-center gap-2 min-w-0 flex-wrap">
                      <span className="text-sm font-black text-ink">
                        📍 {dest.destinationName}
                      </span>
                      {(dest.departureTime || dest.shippingRouteName) && (
                        <span className="inline-flex items-center gap-1 rounded bg-slate-100 text-slate-800 border border-slate-200 px-2 py-0.5 text-xs font-bold shrink-0">
                          <Clock className="h-3 w-3 text-sky-600" />
                          {dest.departureTime ? `${dest.departureTime}発 ` : ''}
                          {dest.shippingRouteName || ''}
                        </span>
                      )}
                    </div>

                    {/* 納品先別ケース数・端数 ＆ 個別チェックボタン */}
                    <div className="flex items-center gap-2">
                      <span className="num text-xs sm:text-sm font-bold text-ink tabular-nums">
                        {dest.cases > 0
                          ? dest.loose > 0
                            ? `${dest.cases}ケース ＋ 端数${dest.loose}`
                            : `${dest.cases}ケース`
                          : `端数${dest.loose}`}
                        <span className="ml-1 text-xs text-ink-muted">({dest.totalQty}点)</span>
                      </span>

                      {/* 個別トグルボタン */}
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => toggleDestination(dest.destinationId, dest.status)}
                        className={cn(
                          'inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-black transition-all active:scale-95',
                          isDestLoaded
                            ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                            : 'border border-line bg-white text-ink-soft hover:border-emerald-500 hover:text-emerald-700',
                        )}
                      >
                        {isDestLoaded ? (
                          <>
                            <Check className="h-3.5 w-3.5 text-emerald-600 stroke-[3]" />
                            <span>積込済</span>
                          </>
                        ) : (
                          <span>個別積込</span>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* 明細品目リスト */}
                  <div className="space-y-1 border-t border-line/40 pt-1.5">
                    {dest.items.map((it) => (
                      <div
                        key={it.id}
                        className="flex items-center justify-between text-xs text-ink-soft py-0.5"
                      >
                        <span className="font-bold text-ink truncate pr-2">
                          {it.productName}
                        </span>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {it.noteText !== '—' && (
                            <span className="rounded bg-bg-soft px-1.5 py-0.5 text-[11px] font-bold text-ink-muted">
                              {it.noteText}
                            </span>
                          )}
                          <span className="num font-bold text-ink tabular-nums">
                            {it.quantityText}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}