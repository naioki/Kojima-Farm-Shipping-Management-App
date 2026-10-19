'use client'

import { useState } from 'react'
import { ChevronDown, PackageCheck, Tractor, Box, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/cn'
import toast from 'react-hot-toast'

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

interface HarvestPulseSummaryProps {
  productName: string
  productId: string
  date: string
  totalPacks: number
  totalBoxes: number
  initialStock: number
  prevCarryover: number
  containerBreakdown: ContainerBreakdownItem[]
  specBreakdown: SpecBreakdownItem[]
}

export function HarvestPulseSummary({
  productName,
  productId,
  date,
  totalPacks,
  totalBoxes,
  initialStock,
  prevCarryover,
  containerBreakdown,
  specBreakdown,
}: HarvestPulseSummaryProps) {
  const [stock, setStock] = useState<number>(initialStock)
  const [tempStock, setTempStock] = useState<number>(initialStock)
  const [carryover, setCarryover] = useState<number>(0)
  const [tempCarryover, setTempCarryover] = useState<number>(0)
  const [isEditingStock, setIsEditingStock] = useState<boolean>(false)
  const [isEditingCarryover, setIsEditingCarryover] = useState<boolean>(false)
  const [busy, setBusy] = useState<boolean>(false)

  // 今日畑で採るべき箱数 = max(0, 注文合計箱数 - 在庫箱数)
  const harvestNeededBoxes = Math.max(0, totalBoxes - stock)
  // 必要パック数（在庫0なら注文総数そのもの。在庫がある場合は箱数比率で正確に逆算）
  const harvestNeededPacks =
    stock === 0
      ? totalPacks
      : totalBoxes > 0
        ? Math.max(0, Math.round(totalPacks * (harvestNeededBoxes / totalBoxes)))
        : 0

  const saveStock = async (newStock: number) => {
    const validStock = Math.max(0, Number(newStock) || 0)
    setBusy(true)
    try {
      const res = await fetch('/api/inventory/container', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date,
          productId,
          stockContainers: validStock,
        }),
      })
      if (!res.ok) throw new Error('在庫の保存に失敗しました')
      setStock(validStock)
      setTempStock(validStock)
      setIsEditingStock(false)
      toast.success('冷蔵庫在庫を更新しました')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '更新に失敗しました')
    } finally {
      setBusy(false)
    }
  }

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
      if (!res.ok) throw new Error('翌朝持ち越しの保存に失敗しました')
      setCarryover(validCarryover)
      setTempCarryover(validCarryover)
      setIsEditingCarryover(false)
      toast.success('翌朝への持ち越しを登録しました（明日の在庫に自動反映されます）')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '更新に失敗しました')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      {/* メインサマリーカード（ダークグリーン） */}
      <div className="rounded-2xl bg-[#155c39] p-4 text-white shadow-md">
        <div className="flex items-center justify-between pb-2 border-b border-white/20">
          <div className="flex items-center gap-2">
            <span className="text-xl">🥬</span>
            <span className="text-base font-black tracking-wide">{productName} 収穫・在庫サマリー</span>
          </div>
          <span className="text-xs font-bold text-white/80">{date}</span>
        </div>

        {/* 収穫必要数（一番目立たせる） */}
        <div className="pt-3 pb-2 text-center">
          <div className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-200">
            <Tractor className="h-4 w-4" />
            <span>今日 畑で収穫すべき箱数（必要実数）</span>
          </div>
          <div className="mt-1 flex items-baseline justify-center gap-2">
            <span className="font-display text-5xl font-black tracking-tight text-white tabular-nums sm:text-6xl">
              {harvestNeededBoxes.toLocaleString()}
            </span>
            <span className="text-2xl font-black text-white/90">箱</span>
            <span className="ml-2 text-sm font-bold text-emerald-200/90">
              ({stock > 0 ? '約 ' : ''}{harvestNeededPacks.toLocaleString()} P)
            </span>
          </div>
        </div>

        {/* 注文総数 vs 冷蔵庫在庫の対比グリッド */}
        <div className="mt-3 grid grid-cols-2 gap-2 pt-3 border-t border-white/15">
          {/* ① 今日の注文合計 */}
          <div className="rounded-xl bg-white/10 p-2.5 text-center">
            <span className="block text-[11px] font-bold text-white/80">📦 今日の注文合計</span>
            <span className="num mt-0.5 block text-xl font-black text-white tabular-nums">
              {totalBoxes.toLocaleString()} <small className="text-xs font-bold text-white/80">箱</small>
            </span>
            <span className="text-[11px] text-emerald-200">({totalPacks.toLocaleString()} P)</span>
          </div>

          {/* ② 冷蔵庫在庫（タップして変更可能） */}
          <div className="rounded-xl bg-white/10 p-2.5 text-center relative">
            <div className="flex items-center justify-center gap-1">
              <span className="text-[11px] font-bold text-white/80">🧊 冷蔵庫在庫</span>
              <button
                type="button"
                onClick={() => {
                  setTempStock(stock)
                  setIsEditingStock(!isEditingStock)
                }}
                className="text-[10px] text-emerald-300 underline font-semibold"
              >
                {isEditingStock ? '閉じる' : '修正'}
              </button>
            </div>

            {isEditingStock ? (
              <div className="mt-2 space-y-2">
                {/* 手袋でも押しやすいクイック増減ステッパー */}
                <div className="grid grid-cols-4 gap-1">
                  <button
                    type="button"
                    onClick={() => setTempStock((p) => Math.max(0, p - 5))}
                    className="h-8 rounded bg-white/20 text-xs font-black text-white hover:bg-white/30 active:scale-95"
                  >
                    -5
                  </button>
                  <button
                    type="button"
                    onClick={() => setTempStock((p) => Math.max(0, p - 1))}
                    className="h-8 rounded bg-white/20 text-xs font-black text-white hover:bg-white/30 active:scale-95"
                  >
                    -1
                  </button>
                  <button
                    type="button"
                    onClick={() => setTempStock((p) => p + 1)}
                    className="h-8 rounded bg-white/20 text-xs font-black text-white hover:bg-white/30 active:scale-95"
                  >
                    +1
                  </button>
                  <button
                    type="button"
                    onClick={() => setTempStock((p) => p + 5)}
                    className="h-8 rounded bg-white/20 text-xs font-black text-white hover:bg-white/30 active:scale-95"
                  >
                    +5
                  </button>
                </div>

                <div className="flex items-center justify-center gap-1.5">
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={tempStock}
                    onChange={(e) => setTempStock(Math.max(0, Number(e.target.value) || 0))}
                    className="h-9 w-20 rounded bg-white px-2 py-1 text-center font-bold text-ink text-base outline-none shadow-inner"
                  />
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => saveStock(tempStock)}
                    className="h-9 rounded-lg bg-emerald-500 px-3 text-xs font-bold text-white hover:bg-emerald-600 disabled:opacity-50 active:scale-95 shadow-xs"
                  >
                    {busy ? '保存中...' : '確定'}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <span className="num mt-0.5 block text-xl font-black text-white tabular-nums">
                  {stock.toLocaleString()} <small className="text-xs font-bold text-white/80">箱</small>
                </span>
                <span className="text-[10px] text-emerald-200/80">
                  {prevCarryover > 0 && stock === prevCarryover ? '※前日余りを自動引継済' : '手動入力値'}
                </span>
              </>
            )}
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
                  <div key={cb.type} className="rounded-lg border border-line bg-white p-2 text-center">
                    <span className="block text-[11px] font-bold text-ink-soft">{cb.type}</span>
                    <span className="text-base font-black text-ink tabular-nums">
                      {cb.boxes} <small className="text-[10px] font-normal text-ink-muted">箱</small>
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
                  <div key={sb.spec} className="flex items-center justify-between rounded bg-white px-2.5 py-1.5 border border-line">
                    <span className="font-bold text-ink">{sb.spec || '標準規格'}</span>
                    <span className="font-black text-ink tabular-nums">
                      {sb.packs.toLocaleString()} P{' '}
                      <span className="text-ink-muted text-[11px]">({sb.boxes} 箱)</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 夕方の持ち越し入力 */}
          <div className="pt-2 border-t border-line/60">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-bold text-ink-soft">夕方の翌朝持ち越し登録:</span>
              <button
                type="button"
                onClick={() => {
                  setTempCarryover(carryover)
                  setIsEditingCarryover(!isEditingCarryover)
                }}
                className="text-xs font-bold text-emerald-700 underline"
              >
                {isEditingCarryover ? '閉じる' : carryover > 0 ? `${carryover}箱を引継設定中 (変更)` : '＋ 今日の余り箱数を登録'}
              </button>
            </div>

            {isEditingCarryover && (
              <div className="rounded-xl bg-white p-2.5 border border-line shadow-xs space-y-2 mt-1">
                <div className="grid grid-cols-4 gap-1">
                  <button
                    type="button"
                    onClick={() => setTempCarryover((p) => Math.max(0, p - 5))}
                    className="h-8 rounded bg-bg-soft text-xs font-black text-ink hover:bg-slate-200 active:scale-95 border border-line"
                  >
                    -5
                  </button>
                  <button
                    type="button"
                    onClick={() => setTempCarryover((p) => Math.max(0, p - 1))}
                    className="h-8 rounded bg-bg-soft text-xs font-black text-ink hover:bg-slate-200 active:scale-95 border border-line"
                  >
                    -1
                  </button>
                  <button
                    type="button"
                    onClick={() => setTempCarryover((p) => p + 1)}
                    className="h-8 rounded bg-bg-soft text-xs font-black text-ink hover:bg-slate-200 active:scale-95 border border-line"
                  >
                    +1
                  </button>
                  <button
                    type="button"
                    onClick={() => setTempCarryover((p) => p + 5)}
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
                    value={tempCarryover}
                    onChange={(e) => setTempCarryover(Math.max(0, Number(e.target.value) || 0))}
                    className="h-9 w-20 rounded border border-line bg-white px-2 py-1 text-center font-bold text-base shadow-inner outline-none"
                  />
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => saveCarryover(tempCarryover)}
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
