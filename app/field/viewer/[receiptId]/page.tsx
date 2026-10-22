'use client'

import { useEffect, useState } from 'react'
import { useRouter, useParams, useSearchParams } from 'next/navigation'
import { ArrowLeft, ZoomIn, ZoomOut, RotateCcw, ExternalLink } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { ViewerTargetItem, ViewerReceiptTab } from '@/app/api/field/viewer-meta/route'

export default function ReceiptViewerPage() {
  const router = useRouter()
  const params = useParams()
  const searchParams = useSearchParams()
  const receiptId = params.receiptId as string
  const returnDate = searchParams.get('date') || ''

  const [zoom, setZoom] = useState<number>(100)
  const [receipts, setReceipts] = useState<ViewerReceiptTab[]>([])
  const [targetItems, setTargetItems] = useState<ViewerTargetItem[]>([])
  const [loadingMeta, setLoadingMeta] = useState<boolean>(true)

  const originalUrl = `/api/receipts/${receiptId}/original?mode=preview`
  const directFileUrl = `/api/receipts/${receiptId}/original`

  // 照合ハイライトデータおよび同日FAXリストの取得
  useEffect(() => {
    let active = true
    async function loadMeta() {
      try {
        setLoadingMeta(true)
        const res = await fetch(`/api/field/viewer-meta?receiptId=${receiptId}&date=${returnDate}`)
        if (res.ok) {
          const data = (await res.json()) as { receipts: ViewerReceiptTab[]; targetItems: ViewerTargetItem[] }
          if (active) {
            setReceipts(data.receipts || [])
            setTargetItems(data.targetItems || [])
          }
        }
      } catch (e) {
        console.error('Failed to load viewer meta:', e)
      } finally {
        if (active) setLoadingMeta(false)
      }
    }
    loadMeta()
    return () => {
      active = false
    }
  }, [receiptId, returnDate])

  const handleBack = () => {
    if (window.history.length > 1) {
      router.back()
    } else {
      router.push(returnDate ? `/field/shipments?date=${returnDate}` : '/field/shipments')
    }
  }

  return (
    <div className="flex h-screen w-screen flex-col bg-slate-900 text-white select-none">
      {/* ① 最上部固定操作バー */}
      <header className="flex h-14 sm:h-16 shrink-0 items-center justify-between border-b border-slate-700 bg-slate-800 px-3 sm:px-6">
        <button
          type="button"
          onClick={handleBack}
          className="inline-flex h-10 sm:h-12 items-center gap-1.5 sm:gap-2 rounded-xl bg-slate-700 px-3 sm:px-4 text-xs sm:text-sm font-bold text-white shadow hover:bg-slate-600 active:scale-95 transition"
        >
          <ArrowLeft className="h-5 w-5" />
          <span>⬅ 注文一覧に戻る</span>
        </button>

        <div className="flex items-center gap-1 sm:gap-2">
          <button
            type="button"
            onClick={() => setZoom((prev) => Math.max(50, prev - 25))}
            className="inline-flex h-9 w-9 sm:h-11 sm:w-11 items-center justify-center rounded-xl bg-slate-700 text-white hover:bg-slate-600 active:scale-95 transition"
            aria-label="縮小"
          >
            <ZoomOut className="h-4 w-4 sm:h-5 sm:w-5" />
          </button>
          <span className="min-w-[40px] text-center text-xs sm:text-sm font-bold text-slate-300 tabular-nums">
            {zoom}%
          </span>
          <button
            type="button"
            onClick={() => setZoom((prev) => Math.min(300, prev + 25))}
            className="inline-flex h-9 w-9 sm:h-11 sm:w-11 items-center justify-center rounded-xl bg-slate-700 text-white hover:bg-slate-600 active:scale-95 transition"
            aria-label="拡大"
          >
            <ZoomIn className="h-4 w-4 sm:h-5 sm:w-5" />
          </button>
          <button
            type="button"
            onClick={() => setZoom(100)}
            className="inline-flex h-9 w-9 sm:h-11 sm:w-11 items-center justify-center rounded-xl bg-slate-700 text-white hover:bg-slate-600 active:scale-95 transition"
            aria-label="リセット"
          >
            <RotateCcw className="h-4 w-4 sm:h-5 sm:w-5" />
          </button>
          <a
            href={directFileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-9 sm:h-11 items-center gap-1 sm:gap-1.5 rounded-xl border border-sky-400 bg-sky-950/80 px-2.5 sm:px-3 text-xs font-bold text-sky-200 hover:bg-sky-900 active:scale-95 transition"
          >
            <span>別タブ</span>
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </header>

      {/* ② 複数FAX原本のワンタップ切替タブ帯 */}
      {receipts.length > 1 && (
        <div className="flex items-center gap-1.5 overflow-x-auto bg-slate-800/90 px-3 py-1.5 border-b border-slate-700 scrollbar-none shrink-0">
          <span className="text-[11px] font-black text-slate-400 shrink-0">📄 原本切替:</span>
          {receipts.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => router.push(`/field/viewer/${r.id}?date=${returnDate}`)}
              className={cn(
                'rounded-lg px-3 py-1 text-xs font-black transition active:scale-95 shrink-0 flex items-center gap-1',
                r.isCurrent
                  ? 'bg-trust-600 text-white shadow-xs'
                  : 'bg-slate-700/80 text-slate-300 hover:bg-slate-700'
              )}
            >
              <span>{r.name}</span>
              {r.isCurrent && <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />}
            </button>
          ))}
        </div>
      )}

      {/* ③ ★ 本日該当明細の照合ハイライト帯（黄色・太字・高コントラスト常時固定） */}
      <div className="bg-amber-300 text-amber-950 border-b border-amber-400 px-3 py-2 shadow-xs shrink-0 select-text">
        <div className="max-w-5xl mx-auto flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-base">🔍</span>
            <span className="text-xs sm:text-sm font-black tracking-tight">
              {returnDate ? `${returnDate} 出荷該当明細:` : '該当明細:'}
            </span>
          </div>

          {loadingMeta ? (
            <span className="text-xs font-bold text-amber-900 animate-pulse">照合データ読込中...</span>
          ) : targetItems.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5">
              {targetItems.map((it, idx) => (
                <div
                  key={it.id || idx}
                  className="flex items-center gap-1.5 rounded-lg bg-amber-400/95 border border-amber-500/80 px-2.5 py-1 shadow-2xs text-xs font-black"
                >
                  <span className="text-amber-950 font-black">
                    【{it.destinationName || it.customerName}】
                  </span>
                  <span className="text-amber-900 font-extrabold">{it.productName}</span>
                  <span className="text-amber-950 text-sm font-black bg-white/80 px-1.5 py-0.2 rounded shadow-2xs">
                    {it.quantity}{it.unit}
                  </span>
                  <span className="text-amber-900 text-[11px] font-bold">
                    ({it.container} {it.boxCount}箱)
                  </span>
                  {it.spec && (
                    <span className="text-amber-800 text-[11px] font-bold hidden sm:inline">
                      規格: {it.spec}
                    </span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <span className="text-xs font-bold text-amber-900">
              このFAXには指定日（{returnDate}）の出荷明細は含まれていません
            </span>
          )}
        </div>
      </div>

      {/* ④ メイン原本表示エリア（Google Driveプレビュー） */}
      <main className="relative flex-1 overflow-auto p-2 bg-slate-950 flex items-center justify-center">
        <div
          className="transition-transform duration-150 origin-top flex items-center justify-center w-full h-full"
          style={{ transform: `scale(${zoom / 100})` }}
        >
          <iframe
            src={originalUrl}
            title="FAX原本プレビュー"
            className="h-full w-full max-w-5xl rounded-lg border border-slate-700 bg-white shadow-2xl"
          />
        </div>
      </main>
    </div>
  )
}
