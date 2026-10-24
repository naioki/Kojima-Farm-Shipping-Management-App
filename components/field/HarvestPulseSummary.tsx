'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, Box, RotateCcw, CheckCircle2, Clock } from 'lucide-react'
import { cn } from '@/lib/cn'
import toast from 'react-hot-toast'
import { jstTodayStr, shiftDateStr } from '@/lib/dates'

export interface ContainerBreakdownItem {
  type: string
  color?: string
  boxes: number
}

export interface SpecBreakdownItem {
  spec: string
  packs: number
  boxes: number
}

export interface HarvestPulseSummaryProps {
  productName: string
  productId: string
  date: string
  totalPacks: number
  totalBoxes: number
  completedBoxes?: number
  completedPacks?: number
  initialStock?: number
  prevCarryover?: number
  initialCarryover?: number
  interimPackedBoxes?: number
  hasManualStock?: boolean
  containerBreakdown: ContainerBreakdownItem[]
  specBreakdown: SpecBreakdownItem[]
  nextDayTotalBoxes?: number
  nextDayTotalPacks?: number
  onQuickBatch?: (deltaBoxes: number) => void
  onUndoQuickBatch?: () => void
  canUndoQuickBatch?: boolean
  isBusyQuickBatch?: boolean
}

export function HarvestPulseSummary({
  productName,
  productId,
  date,
  totalPacks,
  totalBoxes,
  completedBoxes: propCompletedBoxes,
  completedPacks: propCompletedPacks,
  initialCarryover = 0,
  interimPackedBoxes = 0,
  containerBreakdown,
  specBreakdown,
  onQuickBatch,
  onUndoQuickBatch,
  canUndoQuickBatch = false,
  isBusyQuickBatch = false,
}: HarvestPulseSummaryProps) {
  const router = useRouter()
  const completedBoxes = propCompletedBoxes ?? interimPackedBoxes
  const completedPacks =
    propCompletedPacks ??
    (totalBoxes > 0 ? Math.round(totalPacks * (completedBoxes / totalBoxes)) : 0)
  const remainingBoxes = Math.max(0, totalBoxes - completedBoxes)
  const remainingPacks = Math.max(0, totalPacks - completedPacks)
  const progressPct =
    totalBoxes > 0 ? Math.min(100, Math.round((completedBoxes / totalBoxes) * 100)) : 0

  const [carryover, setCarryover] = useState<number>(initialCarryover)
  const [tempCarryoverStr, setTempCarryoverStr] = useState<string>(String(initialCarryover))
  const [isEditingCarryover, setIsEditingCarryover] = useState<boolean>(false)
  const [busy, setBusy] = useState<boolean>(false)

  useEffect(() => {
    setCarryover(initialCarryover)
    setTempCarryoverStr(String(initialCarryover))
    setIsEditingCarryover(false)
  }, [productId, date, initialCarryover])

  const saveCarryover = async (newCarryover: number) => {
    const validCarryover = Math.max(0, Number(newCarryover) || 0)
    setBusy(true)
    try {
      const res = await fetch('/api/inventory/container', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date,
          productId,
          carryoverToNextDay: validCarryover,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? '翌朝持ち越しの保存に失敗しました')
      }
      setCarryover(validCarryover)
      setTempCarryoverStr(String(validCarryover))
      setIsEditingCarryover(false)
      toast.success('翌朝への持ち越しを登録しました（明日の在庫に自動反映されます）')
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '更新に失敗しました')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      {/* メインリアルタイム進捗メーターカード（ダークグリーン） */}
      <div className="rounded-2xl bg-[#155c39] p-4 text-white shadow-md space-y-3">
        {/* ヘッダー情報 */}
        <div className="flex items-center justify-between pb-2 border-b border-white/20">
          <div className="flex items-center gap-2">
            <span className="text-xl">🥬</span>
            <span className="text-base font-black tracking-wide">{productName} パック進捗</span>
          </div>
          <span className="text-xs font-bold text-emerald-100 bg-white/10 px-2.5 py-0.5 rounded-md">
            {date === shiftDateStr(jstTodayStr(), 1)
              ? `明日 ${date} 出荷分（本日パック）`
              : `${date} 出荷分`}
          </span>
        </div>

        {/* クイック完成投入バー（手袋でも押しやすいクイックボタン） */}
        {onQuickBatch && (
          <div className="flex items-center justify-between gap-1.5 pt-0.5">
            <span className="text-xs font-bold text-white/80 shrink-0">クイック完成:</span>
            <div className="flex items-center gap-1.5 flex-wrap justify-end">
              <button
                type="button"
                disabled={isBusyQuickBatch || remainingBoxes <= 0}
                onClick={() => onQuickBatch(10)}
                className="h-8 px-3 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 font-black text-white text-xs shadow-xs active:scale-95 transition"
                title="早い便順の未着手カードを＋10箱分パック済にする"
              >
                ＋10箱
              </button>
              <button
                type="button"
                disabled={isBusyQuickBatch || remainingBoxes <= 0}
                onClick={() => onQuickBatch(5)}
                className="h-8 px-3 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 font-black text-white text-xs shadow-xs active:scale-95 transition"
                title="早い便順の未着手カードを＋5箱分パック済にする"
              >
                ＋5箱
              </button>
              <button
                type="button"
                disabled={isBusyQuickBatch || completedBoxes <= 0}
                onClick={() => onQuickBatch(-5)}
                className="h-8 px-2.5 rounded-lg bg-white/20 hover:bg-white/30 disabled:opacity-40 font-bold text-white text-xs active:scale-95 transition"
                title="パック済みのカードを5箱分未着手に戻す"
              >
                −5箱
              </button>
              {canUndoQuickBatch && (
                <button
                  type="button"
                  disabled={isBusyQuickBatch}
                  onClick={onUndoQuickBatch}
                  className="h-8 px-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 font-bold text-white text-xs active:scale-95 flex items-center gap-1 shadow-xs transition"
                  title="直前のクイック変更を取り消す"
                >
                  <RotateCcw className="h-3 w-3" />
                  <span>戻す</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* 統合進捗ヒーローカード（上：特大 26/40箱 ｜ 下：通常 あと14箱） */}
        <div className="rounded-2xl bg-black/25 border border-white/15 p-3.5 sm:p-4 text-center space-y-2.5 shadow-inner">
          {/* 上段：特大サイズ（完成 / 目標 箱数 ＆ パック数） */}
          <div className="flex flex-col items-center justify-center">
            <div className="flex items-baseline justify-center gap-1.5 font-display">
              <span className="text-4xl sm:text-5xl font-black text-white tracking-tight tabular-nums drop-shadow-sm">
                {completedBoxes.toLocaleString()}
              </span>
              <span className="text-2xl sm:text-3xl font-bold text-white/50">/</span>
              <span className="text-3xl sm:text-4xl font-extrabold text-emerald-200/90 tabular-nums">
                {totalBoxes.toLocaleString()}
              </span>
              <span className="text-sm sm:text-base font-bold text-emerald-200 ml-1">箱</span>
            </div>
            <div className="text-xs font-bold text-emerald-100/70 tabular-nums mt-0.5">
              {completedPacks.toLocaleString()} / {totalPacks.toLocaleString()} P
            </div>
          </div>

          {/* 下段：通常サイズ（あと何箱 / 達成バッジ） */}
          <div className="flex items-center justify-center">
            {remainingBoxes > 0 ? (
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-400/20 border border-emerald-300/30 text-emerald-100 text-xs sm:text-sm font-bold shadow-xs">
                <Clock className="h-3.5 w-3.5 text-emerald-300 shrink-0" />
                <span>あと</span>
                <span className="font-black text-white text-sm sm:text-base tabular-nums">
                  {remainingBoxes.toLocaleString()}
                </span>
                <span>箱</span>
                <span className="text-[11px] text-emerald-200/80 font-normal">
                  (残り {remainingPacks.toLocaleString()} P)
                </span>
              </div>
            ) : totalBoxes > 0 ? (
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-400 text-emerald-950 text-xs sm:text-sm font-black shadow-xs">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>🎉 本日の目標達成！（全 {totalBoxes} 箱 パック完了）</span>
              </div>
            ) : (
              <div className="text-xs text-white/60">本日の注文はありません</div>
            )}
          </div>
        </div>

        {/* 進捗プログレスバー */}
        <div className="space-y-1.5 pt-1">
          <div className="flex items-center justify-between text-xs font-bold">
            <span className="text-emerald-100">進捗率</span>
            <span className="text-white font-black tabular-nums">{progressPct}%</span>
          </div>
          <div className="h-3.5 w-full rounded-full bg-black/30 p-0.5 overflow-hidden shadow-inner">
            <div
              style={{ width: `${progressPct}%` }}
              className={cn(
                'h-full rounded-full transition-all duration-300',
                progressPct >= 100
                  ? 'bg-gradient-to-r from-emerald-300 to-teal-200 shadow-xs'
                  : 'bg-gradient-to-r from-emerald-400 to-teal-300',
              )}
            />
          </div>
        </div>
      </div>

      {/* 折りたたみ内訳アコーディオン（普段は閉じて画面スッキリ） */}
      <details className="group rounded-xl border border-line bg-white shadow-xs">
        <summary className="flex cursor-pointer items-center justify-between px-3.5 py-2.5 text-xs font-bold text-ink-soft select-none hover:bg-bg-soft/50">
          <span className="flex items-center gap-1.5">
            <Box className="h-4 w-4 text-emerald-600" />
            <span>品目・コンテナ・規格ごとの内訳を見る</span>
          </span>
          <ChevronDown className="h-4 w-4 text-ink-muted transition-transform group-open:rotate-180" />
        </summary>

        <div className="border-t border-line/60 px-3.5 py-3 space-y-3 text-xs bg-bg-soft/20">
          {/* コンテナ別箱数 */}
          {containerBreakdown.length > 0 && (
            <div>
              <div className="font-extrabold text-ink mb-1.5 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-600"></span>
                <span>コンテナ種別内訳</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                {containerBreakdown.map((cb) => (
                  <div
                    key={cb.type}
                    className="rounded-lg border border-line bg-white p-2 text-center"
                  >
                    <span className="block text-xs font-bold text-ink">{cb.type}</span>
                    <span className="text-base font-black text-ink tabular-nums">
                      {cb.boxes} <small className="text-xs font-bold text-ink-soft">箱</small>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 規格別内訳 */}
          {specBreakdown.length > 0 && (
            <div>
              <div className="font-extrabold text-ink mb-1.5 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-600"></span>
                <span>規格別内訳（畑への収穫指示用）</span>
              </div>
              <div className="space-y-1">
                {specBreakdown.map((sb) => (
                  <div
                    key={sb.spec}
                    className="flex items-center justify-between rounded bg-white px-2.5 py-1.5 border border-line"
                  >
                    <span className="font-bold text-ink">{sb.spec || '標準規格'}</span>
                    <span className="font-black text-ink tabular-nums">
                      {sb.packs.toLocaleString()} P{' '}
                      <span className="text-ink-soft text-xs font-bold">({sb.boxes} 箱)</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 夕方の持ち越し入力 */}
          <div className="pt-2 border-t border-line/60">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs sm:text-sm font-bold text-ink">
                夕方の翌朝持ち越し登録:
              </span>
              <button
                type="button"
                onClick={() => {
                  setTempCarryoverStr(String(carryover))
                  setIsEditingCarryover(!isEditingCarryover)
                }}
                className="text-xs font-bold text-emerald-700 underline"
              >
                {isEditingCarryover
                  ? '閉じる'
                  : carryover > 0
                  ? `${carryover}箱を引継設定中 (変更)`
                  : '＋ 今日の余り箱数を登録'}
              </button>
            </div>

            {isEditingCarryover && (
              <div className="rounded-xl bg-white p-2.5 border border-line shadow-xs space-y-2 mt-1">
                <div className="grid grid-cols-4 gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      const cur = Math.max(0, parseInt(tempCarryoverStr, 10) || 0)
                      const next = Math.max(0, cur - 5)
                      setTempCarryoverStr(String(next))
                    }}
                    className="h-8 rounded bg-bg-soft text-xs font-black text-ink hover:bg-slate-200 active:scale-95 border border-line"
                  >
                    -5
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const cur = Math.max(0, parseInt(tempCarryoverStr, 10) || 0)
                      const next = Math.max(0, cur - 1)
                      setTempCarryoverStr(String(next))
                    }}
                    className="h-8 rounded bg-bg-soft text-xs font-black text-ink hover:bg-slate-200 active:scale-95 border border-line"
                  >
                    -1
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const cur = Math.max(0, parseInt(tempCarryoverStr, 10) || 0)
                      const next = cur + 1
                      setTempCarryoverStr(String(next))
                    }}
                    className="h-8 rounded bg-bg-soft text-xs font-black text-ink hover:bg-slate-200 active:scale-95 border border-line"
                  >
                    +1
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const cur = Math.max(0, parseInt(tempCarryoverStr, 10) || 0)
                      const next = cur + 5
                      setTempCarryoverStr(String(next))
                    }}
                    className="h-8 rounded bg-bg-soft text-xs font-black text-ink hover:bg-slate-200 active:scale-95 border border-line"
                  >
                    +5
                  </button>
                </div>

                <div className="flex items-center justify-end gap-1.5">
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={tempCarryoverStr}
                    onChange={(e) => setTempCarryoverStr(e.target.value)}
                    className="h-9 w-20 rounded border border-line bg-white px-2 py-1 text-center font-bold text-base shadow-inner outline-none"
                  />
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => saveCarryover(Math.max(0, parseInt(tempCarryoverStr, 10) || 0))}
                    className="h-9 rounded-lg bg-[#155c39] px-3 text-xs font-bold text-white hover:bg-[#10482c] disabled:opacity-50 active:scale-95 shadow-xs"
                  >
                    {busy ? '保存中...' : '確定'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </details>
    </div>
  )
}
