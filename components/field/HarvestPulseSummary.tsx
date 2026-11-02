'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, Box, CheckCircle2, RotateCw } from 'lucide-react'
import { cn } from '@/lib/cn'
import toast from 'react-hot-toast'
import { jstTodayStr, shiftDateStr, formatJpDateShort } from '@/lib/dates'
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
  onRefresh?: () => void
  isRefreshing?: boolean
}

/**
 * 収穫・パックボードの単一統合進捗コックピット（v5.1.10 重複完全排除版）。
 * - 【#01 解消】従来は「スティッキー進捗バー」と「HarvestPulseSummary」の2つの濃緑ボックスが上下に重なり、同じ「0/120箱 (残120)」が2回表示されていた問題を解消し、1つのスティッキー対応コックピットに一本化。
 * - 【#02 解消】表面のコンテナ別ピルバー（🟦 青コン 60箱 等）と `<details>` 内のコンテナ一覧グリッドの二重表示を廃止し、展開内は「規格別内訳」と「翌朝持ち越し登録」のみに整理。
 */
export function HarvestPulseSummary({
  productName,
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
  onRefresh,
  isRefreshing = false,
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
  const [drawerOpen, setDrawerOpen] = useState<boolean>(false)
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
    <div
      className={cn(
        'sticky top-13 z-20 rounded-2xl p-2.5 sm:p-3 text-white shadow-md space-y-2 transition-colors border',
        isTodayWork
          ? 'bg-[#124d30] border-emerald-600/80'
          : date === jstTodayStr()
          ? 'bg-[#0c2e4e] border-sky-600/80'
          : 'bg-[#1e293b] border-slate-600',
      )}
    >
      {/* 前日からの持ち越しがある場合の1行バナー */}
      {prevCarryover > 0 && (
        <div className="flex items-center justify-between gap-2 rounded-lg bg-amber-400/20 border border-amber-300/40 px-2.5 py-1 text-[11px] font-black text-amber-100">
          <span>
            🌅 {isThaiMode ? `${THAI_LABELS.inheritedCarryover}: ${prevCarryover} ลัง` : `前日持越: ${prevCarryover}箱（約${prevCarryover * 20}P）`}
          </span>
          <span className="rounded bg-amber-300 text-amber-950 px-1.5 py-0.2 text-[10px] font-black shrink-0">
            追加収穫目安: あと {Math.max(0, remainingBoxes - prevCarryover)}箱
          </span>
        </div>
      )}

      {/* メイン1行コックピット（品目・完成/目標箱数・総パック数・残り箱数・更新ボタンを1ブロックに凝縮） */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="rounded-md bg-white/15 px-2 py-0.5 text-xs font-black text-emerald-200 shrink-0">
            {formatJpDateShort(date)}納品・{productName}
          </span>
          <div className="flex items-baseline gap-1 font-display">
            <span className="text-2xl sm:text-3xl font-black text-white tracking-tight tabular-nums leading-none">
              {completedBoxes.toLocaleString()}
            </span>
            <span className="text-sm font-bold text-white/50">/</span>
            <span className="text-xl sm:text-2xl font-extrabold tabular-nums text-emerald-200 leading-none">
              {totalBoxes.toLocaleString()}
            </span>
            <span className="text-xs font-black text-emerald-300">
              {isThaiMode ? 'ลัง(箱)' : '箱'}
            </span>
          </div>
          <span className="text-xs font-bold text-white/80 tabular-nums">
            ({completedPacks.toLocaleString()}/{totalPacks.toLocaleString()}P)
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0 ml-auto">
          {remainingPacks > 0 ? (
            <span className="rounded-lg bg-black/30 border border-white/15 px-2.5 py-1 text-xs font-black text-emerald-200 tabular-nums">
              残り <strong className="text-white text-sm">{remainingBoxes.toLocaleString()}</strong>箱 ({progressPct}%)
            </span>
          ) : totalPacks > 0 ? (
            <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-400 text-emerald-950 px-2.5 py-1 text-xs font-black">
              <CheckCircle2 className="h-3.5 w-3.5" /> 全{totalBoxes}箱完了
            </span>
          ) : null}

          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              disabled={isRefreshing}
              title="最新データを再取得"
              aria-label="最新データを再取得"
              className="flex items-center justify-center h-7 w-7 rounded-lg bg-white/10 hover:bg-white/20 active:bg-white/30 text-white border border-white/15 transition disabled:opacity-50"
            >
              <RotateCw className={cn('h-3.5 w-3.5', isRefreshing && 'animate-spin')} />
            </button>
          )}
        </div>
      </div>

      {/* スリムプログレスバー */}
      <div className="h-1.5 w-full rounded-full bg-black/30 overflow-hidden">
        <div
          style={{ width: `${progressPct}%` }}
          className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-teal-200 transition-all duration-300"
        />
      </div>

      {/* 下段：コンテナ別ピルバー ＋ 規格別内訳・持越登録トグル（1行に統合し重複グリッドを排除） */}
      <div className="flex flex-wrap items-center justify-between gap-1.5 pt-0.5">
        <div className="flex flex-wrap items-center gap-1">
          {activeContainers.map((cb) => {
            const shortLabel = cb.type === '農業総研専用折りたたみコンテナ' ? 'NSKオリコン' : cb.type
            return (
              <span
                key={cb.type}
                className="inline-flex items-center gap-1 rounded-md bg-white/15 border border-white/20 px-2 py-0.5 text-[11px] font-black text-white"
              >
                <span>{getContainerColorEmoji(cb.type)}</span>
                <span>{isThaiMode && getThaiContainer(cb.type) ? getThaiContainer(cb.type) : shortLabel}:</span>
                <span className="text-emerald-200 tabular-nums">{cb.boxes}箱</span>
              </span>
            )
          })}
        </div>

        <button
          type="button"
          onClick={() => setDrawerOpen((prev) => !prev)}
          className="inline-flex items-center gap-1 rounded-md bg-white/10 hover:bg-white/20 border border-white/20 px-2 py-0.5 text-[11px] font-bold text-white/90 transition ml-auto"
        >
          <Box className="h-3 w-3 text-emerald-300" />
          <span>規格内訳・持越{carryover > 0 ? `(${carryover}箱)` : ''}</span>
          <ChevronDown className={cn('h-3 w-3 transition-transform', drawerOpen && 'rotate-180')} />
        </button>
      </div>

      {/* 開閉ドロワー：規格別内訳（畑への収穫指示用）＆ 翌朝持ち越し登録（コンテナ一覧の重複表示は排除済） */}
      {drawerOpen && (
        <div className="rounded-xl bg-white text-ink p-3 space-y-2.5 text-xs shadow-inner animate-in fade-in duration-150">
          {activeSpecs.length > 0 && (
            <div>
              <div className="font-black text-ink mb-1 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-600" />
                <span>規格別内訳（畑への収穫・袋詰め指示用）</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                {activeSpecs.map((sb) => (
                  <div
                    key={sb.spec}
                    className="flex items-center justify-between rounded-lg bg-slate-50 px-2.5 py-1.5 border border-line"
                  >
                    <span className="font-bold text-ink truncate pr-2">{sb.spec || '標準規格'}</span>
                    <span className="font-black text-ink tabular-nums shrink-0">
                      {sb.boxes}箱 <span className="text-ink-soft font-bold">({sb.packs.toLocaleString()}P)</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="pt-2 border-t border-line/60">
            <div className="flex items-center justify-between">
              <span className="text-xs font-black text-ink">🌅 夕方の翌朝持ち越し（余り箱数）登録:</span>
              <button
                type="button"
                onClick={() => {
                  setTempCarryoverStr(String(carryover))
                  setIsEditingCarryover(!isEditingCarryover)
                }}
                className="text-xs font-black text-emerald-700 underline"
              >
                {isEditingCarryover
                  ? '閉じる'
                  : carryover > 0
                  ? `${carryover}箱を引継設定中 (変更)`
                  : '＋ 余り箱数を登録'}
              </button>
            </div>

            {isEditingCarryover && (
              <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
                <div className="flex items-center gap-1">
                  {[-5, -1, 1, 5].map((delta) => (
                    <button
                      key={delta}
                      type="button"
                      onClick={() => {
                        const cur = Math.max(0, parseInt(tempCarryoverStr, 10) || 0)
                        setTempCarryoverStr(String(Math.max(0, cur + delta)))
                      }}
                      className="h-8 px-2.5 rounded-lg bg-slate-100 text-xs font-black text-ink hover:bg-slate-200 active:scale-95 border border-line"
                    >
                      {delta > 0 ? `+${delta}` : delta}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={tempCarryoverStr}
                    onChange={(e) => setTempCarryoverStr(e.target.value)}
                    className="h-8 w-16 rounded-lg border border-line-strong bg-white px-2 text-center font-black text-sm text-ink outline-none"
                  />
                  <span className="text-xs font-bold text-ink">箱</span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => saveCarryover(Math.max(0, parseInt(tempCarryoverStr, 10) || 0))}
                    className="h-8 rounded-lg bg-[#155c39] px-3 text-xs font-black text-white hover:bg-[#10482c] disabled:opacity-50 active:scale-95"
                  >
                    {busy ? '保存中...' : '確定'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
