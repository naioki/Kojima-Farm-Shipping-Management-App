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
  const [carryover, setCarryover] = useState<number>(0)
  const [isEditingStock, setIsEditingStock] = useState<boolean>(false)
  const [isEditingCarryover, setIsEditingCarryover] = useState<boolean>(false)
  const [busy, setBusy] = useState<boolean>(false)

  // 今日畑で採るべき箱数 = max(0, 注文合計箱数 - 在庫箱数)
  const harvestNeededBoxes = Math.max(0, totalBoxes - stock)
  // 概算パック数
  const avgPacksPerBox = totalBoxes > 0 ? Math.round(totalPacks / totalBoxes) : 20
  const harvestNeededPacks = harvestNeededBoxes * avgPacksPerBox

  const saveStock = async (newStock: number) => {
    setBusy(true)
    try {
      const res = await fetch('/api/inventory/container', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date,
          productId,
          stockContainers: newStock,
        }),
      })
      if (!res.ok) throw new Error('在庫の保存に失敗しました')
      setStock(newStock)
      setIsEditingStock(false)
      toast.success('冷蔵庫在庫を更新しました')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '更新に失敗しました')
    } finally {
      setBusy(false)
    }
  }

  const saveCarryover = async (newCarryover: number) => {
    setBusy(true)
    try {
      const res = await fetch('/api/inventory/container', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date,
          productId,
          carryoverToNextDay: newCarryover,
        }),
      })
      if (!res.ok) throw new Error('翌朝持ち越しの保存に失敗しました')
      setCarryover(newCarryover)
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
              (約 {harvestNeededPacks.toLocaleString()} P)
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
                onClick={() => setIsEditingStock(!isEditingStock)}
                className="text-[10px] text-emerald-300 underline font-semibold"
              >
                {isEditingStock ? '閉じる' : '修正'}
              </button>
            </div>

            {isEditingStock ? (
              <div className="mt-1 flex items-center justify-center gap-1">
                <input
                  type="number"
                  inputMode="numeric"
                  defaultValue={stock}
                  id="stock-input"
                  className="w-16 rounded bg-white px-2 py-1 text-center font-bold text-ink text-sm outline-none"
                />
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    const el = document.getElementById('stock-input') as HTMLInputElement
                    if (el) saveStock(Number(el.value) || 0)
                  }}
                  className="rounded bg-emerald-500 px-2 py-1 text-xs font-bold text-white hover:bg-emerald-600"
                >
                  保存
                </button>
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
          <div className="pt-2 border-t border-line/60 flex items-center justify-between">
            <span className="text-[11px] font-bold text-ink-soft">夕方の翌朝持ち越し登録:</span>
            {isEditingCarryover ? (
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  inputMode="numeric"
                  defaultValue={carryover}
                  id="carryover-input"
                  className="w-16 rounded border border-line bg-white px-2 py-1 text-center font-bold text-sm"
                />
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    const el = document.getElementById('carryover-input') as HTMLInputElement
                    if (el) saveCarryover(Number(el.value) || 0)
                  }}
                  className="rounded bg-[#155c39] px-2 py-1 text-xs font-bold text-white"
                >
                  確定
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setIsEditingCarryover(true)}
                className="text-xs font-bold text-emerald-700 underline"
              >
                {carryover > 0 ? `${carryover}箱を翌朝に引継設定中 (変更)` : '＋ 今日の余り箱数を登録'}
              </button>
            )}
          </div>
        </div>
      </details>
    </div>
  )
}
