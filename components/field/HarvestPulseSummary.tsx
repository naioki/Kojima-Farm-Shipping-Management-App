'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, Box, CheckCircle2, Clock } from 'lucide-react'
import { cn } from '@/lib/cn'
import toast from 'react-hot-toast'
import { jstTodayStr, shiftDateStr } from '@/lib/dates'
import { useFieldLang } from '@/lib/field/lang-context'
import { getThaiContainer, getContainerColorEmoji, THAI_LABELS } from '@/lib/field/thai-dict'

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
  isTodayTarget?: boolean
}

export function HarvestPulseSummary({
  productId,
  date,
  totalPacks,
  totalBoxes,
  completedBoxes: propCompletedBoxes,
  completedPacks: propCompletedPacks,
  prevCarryover = 0,
  initialCarryover = 0,
  interimPackedBoxes = 0,
  containerBreakdown,
  specBreakdown,
  isTodayTarget = true,
}: HarvestPulseSummaryProps) {
  const router = useRouter()
  const { isThaiMode } = useFieldLang()
  const completedBoxes = propCompletedBoxes ?? interimPackedBoxes
  const completedPacks = propCompletedPacks ?? 0
  const remainingBoxes = Math.max(0, totalBoxes - completedBoxes)
  const remainingPacks = Math.max(0, totalPacks - completedPacks)
  const progressPct =
    totalPacks > 0 ? Math.min(100, Math.round((completedPacks / totalPacks) * 100)) : 0

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

  const isTodayWork = isTodayTarget && (date === shiftDateStr(jstTodayStr(), 1) || date === jstTodayStr())
  const activeContainers = containerBreakdown.filter((cb) => cb.boxes > 0)
  const activeSpecs = specBreakdown.filter((sb) => sb.packs > 0 || sb.boxes > 0)

  return (
    <div className="space-y-2">
      {/* 省スペース・高視認性進捗コックピット（左：主役の箱数 ｜ 右：総パック数） */}
      <div
        className={cn(
          'rounded-2xl p-3 text-white shadow-sm space-y-2 transition-colors',
          isTodayWork ? 'bg-[#155c39]' : 'bg-[#1e293b] border border-slate-700',
        )}
      >
        {prevCarryover > 0 && (
          <div className="flex items-center justify-between gap-2 rounded-xl bg-amber-400/20 border border-amber-300/40 px-3 py-1.5 text-xs font-black text-amber-100">
            <span className="flex items-center gap-1.5">
              <span>🌅</span>
              <span>
                {isThaiMode
                  ? `${THAI_LABELS.inheritedCarryover}: ${prevCarryover} ลัง`
                  : `前日からの持ち越し: ${prevCarryover} 箱（約 ${prevCarryover * 20} P）`}
              </span>
            </span>
            <span className="rounded bg-amber-300 text-amber-950 px-1.5 py-0.5 text-[10px] font-black shrink-0">
              畑からの追加収穫目安: あと {Math.max(0, remainingBoxes - prevCarryover)} 箱
            </span>
          </div>
        )}

        <div className="rounded-xl bg-black/25 border border-white/15 px-3 py-2.5 text-center space-y-2 shadow-inner">
          <div className="grid grid-cols-2 divide-x divide-white/15 items-center">
            {/* ① 左カラム（主役）：箱数（ケース） */}
            <div className="flex flex-col items-center justify-center px-1">
              <span className="text-[11px] font-black tracking-wider text-emerald-200 mb-0.5">
                {isThaiMode ? 'จำนวนลัง (箱数・ケース)' : '完成箱数 / 目標箱数'}
              </span>
              <div className="flex items-baseline justify-center gap-1 font-display">
                <span className="text-3xl sm:text-4xl font-black text-white tracking-tight tabular-nums">
                  {completedBoxes.toLocaleString()}
                </span>
                <span className="text-lg font-bold text-white/40">/</span>
                <span className="text-2xl sm:text-3xl font-extrabold tabular-nums text-emerald-200">
                  {totalBoxes.toLocaleString()}
                </span>
                <span className="text-xs sm:text-sm font-black ml-0.5 text-emerald-300">
                  {isThaiMode ? 'ลัง' : '箱'}
                </span>
              </div>
            </div>

            {/* ② 右カラム：総パック数 */}
            <div className="flex flex-col items-center justify-center px-1">
              <span className="text-[11px] font-bold tracking-wider text-white/80 mb-0.5">
                {isThaiMode ? 'จำนวนถุง (総パック数)' : '完成パック数 / 総数'}
              </span>
              <div className="flex items-baseline justify-center gap-1 font-display">
                <span className="text-2xl sm:text-3xl font-black text-white tracking-tight tabular-nums">
                  {completedPacks.toLocaleString()}
                </span>
                <span className="text-base font-bold text-white/40">/</span>
                <span className="text-xl sm:text-2xl font-extrabold tabular-nums text-white/90">
                  {totalPacks.toLocaleString()}
                </span>
                <span className="text-xs font-black ml-0.5 text-white/80">
                  P
                </span>
              </div>
            </div>
          </div>

          {/* 下段：残り箱数・パック数 ＋ プログレスバー */}
          <div className="space-y-1.5 pt-1 border-t border-white/10">
            <div className="flex items-center justify-between gap-2 px-1">
              {remainingPacks > 0 ? (
                <div className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-bold text-emerald-100">
                  <Clock className="h-3.5 w-3.5 text-emerald-300 shrink-0" />
                  <span>残り:</span>
                  <span className="font-black text-white text-sm sm:text-base tabular-nums">
                    あと {remainingBoxes.toLocaleString()} 箱
                  </span>
                  <span className="text-xs text-white/80 font-bold tabular-nums">
                    （{remainingPacks.toLocaleString()} P）
                  </span>
                </div>
              ) : totalPacks > 0 ? (
                <div className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-black text-emerald-300">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  <span>🎉 全 {totalBoxes}箱（{totalPacks.toLocaleString()}P）完了！</span>
                </div>
              ) : (
                <div className="text-xs text-white/60">この日の注文はありません</div>
              )}
              <span className="text-xs sm:text-sm font-black text-white tabular-nums">{progressPct}%</span>
            </div>

            <div className="h-2 w-full rounded-full bg-black/30 p-0.5 overflow-hidden shadow-inner">
              <div
                style={{ width: `${progressPct}%` }}
                className={cn(
                  'h-full rounded-full transition-all duration-300',
                  progressPct >= 100
                    ? 'bg-gradient-to-r from-emerald-300 to-teal-200'
                    : 'bg-gradient-to-r from-emerald-400 to-teal-300',
                )}
              />
            </div>
          </div>
        </div>

        {/* #08 タップ不要で一目でわかるコンテナ別・規格別1行ピルバー */}
        {activeContainers.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            {activeContainers.map((cb) => {
              const shortLabel = cb.type === '農業総研専用折りたたみコンテナ' ? 'NSKオリコン' : cb.type
              return (
                <span
                  key={cb.type}
                  className="inline-flex items-center gap-1 rounded-lg bg-white/15 border border-white/25 px-2 py-0.5 text-[11px] font-black text-white"
                >
                  <span>{getContainerColorEmoji(cb.type)}</span>
                  <span>{shortLabel}:</span>
                  <span className="text-emerald-200 tabular-nums">{cb.boxes}箱</span>
                </span>
              )
            })}
          </div>
        )}
      </div>

      {/* 折りたたみ内訳アコーディオン（コンテナ別・規格別・翌朝持ち越し） */}
      <details className="group rounded-xl border border-line bg-white shadow-2xs">
        <summary className="flex cursor-pointer items-center justify-between px-3.5 py-2 text-xs font-bold text-ink-soft select-none hover:bg-bg-soft/50">
          <span className="flex items-center gap-1.5 flex-wrap">
            <Box className="h-4 w-4 text-emerald-600 shrink-0" />
            <span>コンテナ別・規格別の詳細内訳 ／ 翌朝持ち越し登録</span>
            {carryover > 0 && (
              <span className="rounded bg-amber-100 text-amber-900 px-1.5 py-0.5 text-[10px] font-black">
                引継 {carryover}箱
              </span>
            )}
          </span>
          <ChevronDown className="h-4 w-4 text-ink-muted transition-transform group-open:rotate-180 shrink-0" />
        </summary>

        <div className="border-t border-line/60 px-3.5 py-3 space-y-3 text-xs bg-bg-soft/20">
          {activeContainers.length > 0 && (
            <div>
              <div className="font-extrabold text-ink mb-1.5 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-600"></span>
                <span>コンテナ種別内訳</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                {activeContainers.map((cb) => (
                  <div
                    key={cb.type}
                    className="rounded-lg border border-line bg-white p-2 text-center"
                  >
                    <span className="block text-xs font-black text-ink truncate">
                      {isThaiMode && getThaiContainer(cb.type)
                        ? `${getContainerColorEmoji(cb.type)} ${getThaiContainer(cb.type)}`
                        : `${getContainerColorEmoji(cb.type)} ${cb.type === '農業総研専用折りたたみコンテナ' ? 'NSKオリコン' : cb.type}`}
                    </span>
                    <span className="text-base font-black text-ink tabular-nums">
                      {cb.boxes} <small className="text-xs font-bold text-ink-soft">箱</small>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeSpecs.length > 0 && (
            <div>
              <div className="font-extrabold text-ink mb-1.5 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-600"></span>
                <span>規格別内訳（畑への収穫指示用）</span>
              </div>
              <div className="space-y-1">
                {activeSpecs.map((sb) => (
                  <div
                    key={sb.spec}
                    className="flex items-center justify-between rounded bg-white px-2.5 py-1.5 border border-line"
                  >
                    <span className="font-bold text-ink">{sb.spec || '標準規格'}</span>
                    <span className="font-black text-ink tabular-nums">
                      {sb.boxes} 箱{' '}
                      <span className="text-ink-soft text-xs font-bold">({sb.packs.toLocaleString()} P)</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="pt-2 border-t border-line/60">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-bold text-ink">夕方の翌朝持ち越し登録:</span>
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
                  {[-5, -1, 1, 5].map((delta) => (
                    <button
                      key={delta}
                      type="button"
                      onClick={() => {
                        const cur = Math.max(0, parseInt(tempCarryoverStr, 10) || 0)
                        setTempCarryoverStr(String(Math.max(0, cur + delta)))
                      }}
                      className="h-8 rounded bg-bg-soft text-xs font-black text-ink hover:bg-slate-200 active:scale-95 border border-line"
                    >
                      {delta > 0 ? `+${delta}` : delta}
                    </button>
                  ))}
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
