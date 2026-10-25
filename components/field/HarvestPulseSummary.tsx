'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, Box, CheckCircle2, Clock } from 'lucide-react'
import { cn } from '@/lib/cn'
import toast from 'react-hot-toast'
import { jstTodayStr, shiftDateStr } from '@/lib/dates'
import { useFieldLang } from '@/lib/field/lang-context'
import { getThaiContainer } from '@/lib/field/thai-dict'

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

  return (
    <div className="space-y-2">
      {/* メインリアルタイム進捗メーターカード（今日＝深緑 🌲 / 今日以外＝シックなチャコール 🪨） */}
      <div
        className={cn(
          'rounded-2xl p-4 text-white shadow-md space-y-3 transition-colors',
          isTodayWork ? 'bg-[#155c39]' : 'bg-[#1e293b] border border-slate-700',
        )}
      >
        {/* ヘッダー情報 */}
        <div className="flex items-center justify-between pb-2 border-b border-white/20">
          <div className="flex items-center gap-2">
            <span className="text-xl">{isTodayWork ? '🥬' : '📅'}</span>
            <span className="text-base font-black tracking-wide">{productName} パック進捗</span>
          </div>
          <span
            className={cn(
              'text-xs font-bold px-2.5 py-0.5 rounded-md',
              isTodayWork ? 'text-emerald-100 bg-white/10' : 'text-slate-300 bg-white/10',
            )}
          >
            {date === shiftDateStr(jstTodayStr(), 1)
              ? `明日 ${date} 出荷分（本日パック）`
              : isTodayWork
              ? `本日 ${date} 出荷分`
              : `📅 先行・確認用（${date} 出荷分）`}
          </span>
        </div>

        {/* 統合進捗ヒーローカード（上段：パック数 特大 ｜ 下段：箱数 特大 ｜ 最下部：あと残りP/箱） */}
        <div className="rounded-2xl bg-black/25 border border-white/15 p-4 sm:p-5 text-center space-y-3.5 shadow-inner">
          {/* ① パック数（特大表示） */}
          <div className="flex flex-col items-center justify-center">
            <span className="text-xs font-black tracking-wider text-white/75 mb-0.5">
              パック数 (P)
              {isThaiMode && <span className="ml-1 text-[11px] text-emerald-300 font-normal">(จำนวนถุง)</span>}
            </span>
            <div className="flex items-baseline justify-center gap-2 font-display">
              <span className="text-5xl sm:text-6xl font-black text-white tracking-tight tabular-nums drop-shadow-md">
                {completedPacks.toLocaleString()}
              </span>
              <span className="text-2xl sm:text-3xl font-bold text-white/40">/</span>
              <span
                className={cn(
                  'text-4xl sm:text-5xl font-extrabold tabular-nums',
                  isTodayWork ? 'text-emerald-200' : 'text-slate-200',
                )}
              >
                {totalPacks.toLocaleString()}
              </span>
              <span
                className={cn(
                  'text-lg sm:text-xl font-black ml-1',
                  isTodayWork ? 'text-emerald-300' : 'text-slate-300',
                )}
              >
                P
              </span>
            </div>
          </div>

          {/* 区切り線 */}
          <div className="w-full border-t border-white/15" />

          {/* ② 箱数（特大表示） */}
          <div className="flex flex-col items-center justify-center">
            <span className="text-xs font-black tracking-wider text-white/75 mb-0.5">
              箱数 (ケース)
              {isThaiMode && <span className="ml-1 text-[11px] text-emerald-300 font-normal">(จำนวนลัง)</span>}
            </span>
            <div className="flex items-baseline justify-center gap-2 font-display">
              <span className="text-4xl sm:text-5xl font-black text-white tracking-tight tabular-nums drop-shadow-md">
                {completedBoxes.toLocaleString()}
              </span>
              <span className="text-2xl sm:text-3xl font-bold text-white/40">/</span>
              <span
                className={cn(
                  'text-3xl sm:text-4xl font-extrabold tabular-nums',
                  isTodayWork ? 'text-emerald-200' : 'text-slate-200',
                )}
              >
                {totalBoxes.toLocaleString()}
              </span>
              <span
                className={cn(
                  'text-base sm:text-lg font-black ml-1',
                  isTodayWork ? 'text-emerald-300' : 'text-slate-300',
                )}
              >
                箱
              </span>
            </div>
          </div>

          {/* ③ 下段：残り数・達成バッジ */}
          <div className="flex items-center justify-center pt-0.5">
            {remainingPacks > 0 ? (
              <div
                className={cn(
                  'inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs sm:text-sm font-bold shadow-xs border',
                  isTodayWork
                    ? 'bg-emerald-400/20 border-emerald-300/30 text-emerald-100'
                    : 'bg-slate-700/60 border-slate-600/50 text-slate-200',
                )}
              >
                <Clock
                  className={cn(
                    'h-4 w-4 shrink-0',
                    isTodayWork ? 'text-emerald-300' : 'text-slate-300',
                  )}
                />
                <span>{isThaiMode ? 'あと (เหลือ)' : 'あと'}</span>
                <span className="font-black text-white text-sm sm:text-base tabular-nums">
                  {remainingPacks.toLocaleString()} P
                </span>
                <span className="text-xs text-white/80 font-semibold">
                  (約 {remainingBoxes.toLocaleString()} 箱)
                </span>
              </div>
            ) : totalPacks > 0 ? (
              <div
                className={cn(
                  'inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs sm:text-sm font-black shadow-xs',
                  isTodayWork
                    ? 'bg-emerald-400 text-emerald-950'
                    : 'bg-slate-200 text-slate-900',
                )}
              >
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>🎉 パック目標達成！（全 {totalPacks} P / {totalBoxes} 箱 完了）</span>
              </div>
            ) : (
              <div className="text-xs text-white/60">この日の注文はありません</div>
            )}
          </div>
        </div>

        {/* 進捗プログレスバー */}
        <div className="space-y-1.5 pt-1">
          <div className="flex items-center justify-between text-xs font-bold">
            <span className={isTodayWork ? 'text-emerald-100' : 'text-slate-300'}>進捗率</span>
            <span className="text-white font-black tabular-nums">{progressPct}%</span>
          </div>
          <div className="h-3.5 w-full rounded-full bg-black/30 p-0.5 overflow-hidden shadow-inner">
            <div
              style={{ width: `${progressPct}%` }}
              className={cn(
                'h-full rounded-full transition-all duration-300',
                progressPct >= 100
                  ? isTodayWork
                    ? 'bg-gradient-to-r from-emerald-300 to-teal-200 shadow-xs'
                    : 'bg-gradient-to-r from-slate-200 to-slate-100 shadow-xs'
                  : isTodayWork
                  ? 'bg-gradient-to-r from-emerald-400 to-teal-300'
                  : 'bg-gradient-to-r from-slate-400 to-slate-300',
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
          {/* コンテナ別箱数（数量0は非表示） */}
          {containerBreakdown.filter((cb) => cb.boxes > 0).length > 0 && (
            <div>
              <div className="font-extrabold text-ink mb-1.5 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-600"></span>
                <span>コンテナ種別内訳</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                {containerBreakdown
                  .filter((cb) => cb.boxes > 0)
                  .map((cb) => (
                    <div
                      key={cb.type}
                      className="rounded-lg border border-line bg-white p-2 text-center"
                    >
                      <span className="block text-xs font-bold text-ink">
                        {cb.type}
                        {isThaiMode && getThaiContainer(cb.type) && (
                          <span className="block text-[11px] text-ink-muted font-normal">
                            ({getThaiContainer(cb.type)})
                          </span>
                        )}
                      </span>
                      <span className="text-base font-black text-ink tabular-nums">
                        {cb.boxes} <small className="text-xs font-bold text-ink-soft">箱</small>
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* 規格別内訳（数量0は非表示） */}
          {specBreakdown.filter((sb) => sb.packs > 0 || sb.boxes > 0).length > 0 && (
            <div>
              <div className="font-extrabold text-ink mb-1.5 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-600"></span>
                <span>規格別内訳（畑への収穫指示用）</span>
              </div>
              <div className="space-y-1">
                {specBreakdown
                  .filter((sb) => sb.packs > 0 || sb.boxes > 0)
                  .map((sb) => (
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
                {isThaiMode && <span className="text-xs text-ink-muted ml-1">(คงเหลือยกไปพรุ่งนี้)</span>}
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
                  ? isThaiMode ? '閉じる (ปิด)' : '閉じる'
                  : carryover > 0
                  ? isThaiMode ? `${carryover}箱を引継中 (${carryover}ลัง)` : `${carryover}箱を引継設定中 (変更)`
                  : isThaiMode ? '＋ 今日の余り箱数を登録 (ลงทะเบียนลังคงเหลือ)' : '＋ 今日の余り箱数を登録'}
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
                    {busy ? '保存中...' : isThaiMode ? '確定 (บันทึก)' : '確定'}
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
