'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
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
  interimPackedBoxes?: number
  hasManualStock?: boolean
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
  interimPackedBoxes = 0,
  hasManualStock = false,
  containerBreakdown,
  specBreakdown,
}: HarvestPulseSummaryProps) {
  const router = useRouter()
  // 手動入力値がない場合は「前日繰越 + 本日途中仕上がり」で自動計算（手入力不要）
  const autoStock = prevCarryover + interimPackedBoxes
  const defaultStock = hasManualStock ? initialStock : autoStock

  const [stock, setStock] = useState<number>(defaultStock)
  const [tempStockStr, setTempStockStr] = useState<string>(String(defaultStock))
  const [isManualOverride, setIsManualOverride] = useState<boolean>(hasManualStock)
  const [carryover, setCarryover] = useState<number>(0)
  const [tempCarryover, setTempCarryover] = useState<number>(0)
  const [tempCarryoverStr, setTempCarryoverStr] = useState<string>('0')
  const [isEditingStock, setIsEditingStock] = useState<boolean>(false)
  const [isEditingCarryover, setIsEditingCarryover] = useState<boolean>(false)
  const [busy, setBusy] = useState<boolean>(false)

  // 品目タブ切り替え・日付変更時に最新の集計値と状態を確実に同期
  useEffect(() => {
    setStock(defaultStock)
    setTempStockStr(String(defaultStock))
    setIsManualOverride(hasManualStock)
    setIsEditingStock(false)
    setIsEditingCarryover(false)
  }, [productId, date, defaultStock, hasManualStock])

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
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? '在庫の保存に失敗しました')
      }
      setStock(validStock)
      setTempStockStr(String(validStock))
      setIsManualOverride(true)
      setIsEditingStock(false)
      toast.success('在庫を更新しました')
      router.refresh()
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
      {/* メインサマリーカード（ダークグリーン） */}
      <div className="rounded-2xl bg-[#155c39] p-4 text-white shadow-md">
        <div className="flex items-center justify-between pb-2 border-b border-white/20">
          <div className="flex items-center gap-2">
            <span className="text-xl">🥬</span>
            <span className="text-base font-black tracking-wide">{productName} 収穫・在庫サマリー</span>
          </div>
          <span className="text-xs font-bold text-white/80">{date}</span>
        </div>

        {/* 収穫箱数（最重要ヘッダー：注文合計 − 在庫） */}
        <div className="pt-3 pb-2 text-center">
          <div className="inline-flex items-center gap-2 text-sm font-black text-emerald-100">
            <Tractor className="h-4 w-4" />
            <span>収穫箱数</span>
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

        {/* 注文合計 − 在庫 ＝ 収穫箱数の対比グリッド */}
        <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2 pt-3 border-t border-white/15">
          {/* ① 今日の注文合計 */}
          <div className="rounded-xl bg-white/10 p-2.5 text-center">
            <span className="block text-xs sm:text-sm font-black text-white/95">📦 今日の注文合計</span>
            <span className="num mt-0.5 block text-xl font-black text-white tabular-nums">
              {totalBoxes.toLocaleString()} <small className="text-xs font-bold text-white/80">箱</small>
            </span>
            <span className="text-xs sm:text-sm font-bold text-emerald-100">({totalPacks.toLocaleString()} P)</span>
          </div>

          {/* 演算記号 − */}
          <div className="text-xl font-black text-white/70 text-center select-none">−</div>

          {/* ② 在庫（タップして変更可能） */}
          <div className="rounded-xl bg-white/10 p-2.5 text-center relative">
            <div className="flex items-center justify-center gap-1">
              <span className="text-xs sm:text-sm font-black text-white/95">在庫</span>
              <button
                type="button"
                onClick={() => {
                  setTempStockStr(String(stock))
                  setIsEditingStock(!isEditingStock)
                }}
                className="text-xs text-emerald-200 underline font-bold px-1"
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
                    onClick={() => {
                      const cur = Math.max(0, parseInt(tempStockStr, 10) || 0)
                      const next = Math.max(0, cur - 5)
                      setTempStockStr(String(next))
                    }}
                    className="h-8 rounded bg-white/20 text-xs font-black text-white hover:bg-white/30 active:scale-95"
                  >
                    -5
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const cur = Math.max(0, parseInt(tempStockStr, 10) || 0)
                      const next = Math.max(0, cur - 1)
                      setTempStockStr(String(next))
                    }}
                    className="h-8 rounded bg-white/20 text-xs font-black text-white hover:bg-white/30 active:scale-95"
                  >
                    -1
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const cur = Math.max(0, parseInt(tempStockStr, 10) || 0)
                      const next = cur + 1
                      setTempStockStr(String(next))
                    }}
                    className="h-8 rounded bg-white/20 text-xs font-black text-white hover:bg-white/30 active:scale-95"
                  >
                    +1
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const cur = Math.max(0, parseInt(tempStockStr, 10) || 0)
                      const next = cur + 5
                      setTempStockStr(String(next))
                    }}
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
                    value={tempStockStr}
                    onChange={(e) => setTempStockStr(e.target.value)}
                    className="h-9 w-20 rounded bg-white px-2 py-1 text-center font-bold text-ink text-base outline-none shadow-inner"
                  />
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => saveStock(Math.max(0, parseInt(tempStockStr, 10) || 0))}
                    className="h-9 rounded-lg bg-emerald-500 px-3 text-xs font-bold text-white hover:bg-emerald-600 disabled:opacity-50 active:scale-95 shadow-xs"
                  >
                    {busy ? '保存中...' : '確定'}
                  </button>
                  {isManualOverride && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        saveStock(autoStock)
                        setIsManualOverride(false)
                      }}
                      className="h-9 rounded-lg bg-white/20 px-2.5 text-xs font-bold text-white hover:bg-white/30"
                      title="前日繰越と途中仕上がりからの自動計算に戻す"
                    >
                      自動計算に戻す
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <>
                <span className="num mt-0.5 block text-xl font-black text-white tabular-nums">
                  {stock.toLocaleString()} <small className="text-xs font-bold text-white/80">箱</small>
                </span>
                <span className="text-xs text-emerald-100 font-medium">
                  {isManualOverride
                    ? '※手動指定値'
                    : `自動反映（前日 ${prevCarryover}箱 ＋ 途中 ${interimPackedBoxes}箱）`}
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
                  <div key={sb.spec} className="flex items-center justify-between rounded bg-white px-2.5 py-1.5 border border-line">
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
              <span className="text-xs sm:text-sm font-bold text-ink">夕方の翌朝持ち越し登録:</span>
              <button
                type="button"
                onClick={() => {
                  setTempCarryover(carryover)
                  setTempCarryoverStr(String(carryover))
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
                    onClick={() => {
                      const cur = Math.max(0, parseInt(tempCarryoverStr, 10) || 0)
                      const next = Math.max(0, cur - 5)
                      setTempCarryover(next)
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
                      setTempCarryover(next)
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
                      setTempCarryover(next)
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
                      setTempCarryover(next)
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
                    onChange={(e) => {
                      setTempCarryoverStr(e.target.value)
                      setTempCarryover(Math.max(0, parseInt(e.target.value, 10) || 0))
                    }}
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
