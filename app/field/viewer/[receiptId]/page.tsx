'use client'

import { useEffect, useState } from 'react'
import { useRouter, useParams, useSearchParams } from 'next/navigation'
import { ArrowLeft, ZoomIn, ZoomOut, RotateCcw, ExternalLink, Sun, Moon } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { ViewerTargetItem, ViewerReceiptTab } from '@/app/api/field/viewer-meta/route'

export default function ReceiptViewerPage() {
  const router = useRouter()
  const params = useParams()
  const searchParams = useSearchParams()
  const receiptId = params.receiptId as string
  const returnDate = searchParams.get('date') || ''
  const returnProduct = searchParams.get('product') || ''

  const [zoom, setZoom] = useState<number>(100)
  const [lightMode, setLightMode] = useState<boolean>(false)
  const [receipts, setReceipts] = useState<ViewerReceiptTab[]>([])
  const [targetItems, setTargetItems] = useState<ViewerTargetItem[]>([])
  const [loadingMeta, setLoadingMeta] = useState<boolean>(true)

  const originalUrl = `/api/receipts/${receiptId}/original?mode=preview`
  const directFileUrl = `/api/receipts/${receiptId}/original`

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

  // #32 戻り遷移時に date と product の両方を保持
  const handleBack = () => {
    if (window.opener && window.history.length <= 1) {
      try {
        window.close()
      } catch {}
    }
    const qs = new URLSearchParams()
    if (returnDate) qs.set('date', returnDate)
    if (returnProduct) qs.set('product', returnProduct)
    const queryStr = qs.toString()
    router.push(queryStr ? `/field/shipments?${queryStr}` : '/field/shipments')
  }

  return (
    <div
      className={cn(
        'flex h-screen w-screen flex-col select-none transition-colors',
        lightMode ? 'bg-slate-100 text-slate-900' : 'bg-slate-900 text-white',
      )}
    >
      {/* ① 最上部固定操作バー */}
      <header
        className={cn(
          'flex h-14 sm:h-16 shrink-0 items-center justify-between border-b px-3 sm:px-6',
          lightMode ? 'border-slate-300 bg-white' : 'border-slate-700 bg-slate-800',
        )}
      >
        <button
          type="button"
          onClick={handleBack}
          className={cn(
            'inline-flex h-10 sm:h-12 items-center gap-1.5 sm:gap-2 rounded-xl px-3 sm:px-4 text-xs sm:text-sm font-bold shadow active:scale-95 transition',
            lightMode
              ? 'bg-forest-700 text-white hover:bg-forest-800'
              : 'bg-slate-700 text-white hover:bg-slate-600',
          )}
        >
          <ArrowLeft className="h-5 w-5" />
          <span>⬅ 収穫・パックボードに戻る</span>
        </button>

        <div className="flex items-center gap-1 sm:gap-2">
          {/* #32 屋外・ハウスでも見やすいライト/ダーク背景切替 */}
          <button
            type="button"
            onClick={() => setLightMode((prev) => !prev)}
            className={cn(
              'inline-flex h-9 sm:h-11 items-center gap-1 rounded-xl px-2.5 text-xs font-bold transition active:scale-95',
              lightMode
                ? 'border border-slate-300 bg-slate-100 text-slate-800 hover:bg-slate-200'
                : 'bg-slate-700 text-amber-300 hover:bg-slate-600',
            )}
            title="背景の明るさを切り替え"
          >
            {lightMode ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            <span className="hidden sm:inline">{lightMode ? 'ダーク' : '屋外ライト'}</span>
          </button>

          <button
            type="button"
            onClick={() => setZoom((prev) => Math.max(50, prev - 25))}
            className={cn(
              'inline-flex h-9 w-9 sm:h-11 sm:w-11 items-center justify-center rounded-xl active:scale-95 transition',
              lightMode ? 'bg-slate-200 text-slate-900 hover:bg-slate-300' : 'bg-slate-700 text-white hover:bg-slate-600',
            )}
            aria-label="縮小"
          >
            <ZoomOut className="h-4 w-4 sm:h-5 sm:w-5" />
          </button>
          <span className="min-w-[40px] text-center text-xs sm:text-sm font-bold tabular-nums">
            {zoom}%
          </span>
          <button
            type="button"
            onClick={() => setZoom((prev) => Math.min(300, prev + 25))}
            className={cn(
              'inline-flex h-9 w-9 sm:h-11 sm:w-11 items-center justify-center rounded-xl active:scale-95 transition',
              lightMode ? 'bg-slate-200 text-slate-900 hover:bg-slate-300' : 'bg-slate-700 text-white hover:bg-slate-600',
            )}
            aria-label="拡大"
          >
            <ZoomIn className="h-4 w-4 sm:h-5 sm:w-5" />
          </button>
          <button
            type="button"
            onClick={() => setZoom(100)}
            className={cn(
              'inline-flex h-9 w-9 sm:h-11 sm:w-11 items-center justify-center rounded-xl active:scale-95 transition',
              lightMode ? 'bg-slate-200 text-slate-900 hover:bg-slate-300' : 'bg-slate-700 text-white hover:bg-slate-600',
            )}
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
        <div
          className={cn(
            'flex items-center gap-1.5 overflow-x-auto px-3 py-1.5 border-b scrollbar-none shrink-0',
            lightMode ? 'bg-slate-200 border-slate-300' : 'bg-slate-800/90 border-slate-700',
          )}
        >
          <span className="text-[11px] font-black opacity-75 shrink-0">📄 原本切替:</span>
          {receipts.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() =>
                router.replace(
                  `/field/viewer/${r.id}?date=${returnDate}${returnProduct ? `&product=${returnProduct}` : ''}`,
                )
              }
              className={cn(
                'rounded-lg px-3 py-1 text-xs font-black transition active:scale-95 shrink-0 flex items-center gap-1',
                r.isCurrent
                  ? 'bg-trust-600 text-white shadow-xs'
                  : lightMode
                  ? 'bg-white text-slate-700 hover:bg-slate-100'
                  : 'bg-slate-700/80 text-slate-300 hover:bg-slate-700',
              )}
            >
              <span>{r.name}</span>
              {r.isCurrent && <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />}
            </button>
          ))}
        </div>
      )}

      {/* ③ 本日該当明細の照合ハイライト帯 */}
      <div className="bg-amber-300 text-amber-950 border-b border-amber-400 px-3 py-2 shadow-xs shrink-0 select-text">
        <div className="max-w-5xl mx-auto flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-base">🔍</span>
            <span className="text-xs sm:text-sm font-black tracking-tight">
              {returnDate ? `${returnDate} 納品該当明細:` : '該当明細:'}
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
                    {it.boxCount}箱 ({it.quantity}{it.unit})
                  </span>
                  <span className="text-amber-900 text-[11px] font-bold">
                    [{it.container}]
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

      {/* ④ メイン原本表示エリア */}
      <main
        className={cn(
          'relative flex-1 overflow-auto p-2 flex items-center justify-center',
          lightMode ? 'bg-slate-200' : 'bg-slate-950',
        )}
      >
        <div
          className="transition-transform duration-150 origin-top flex items-center justify-center w-full h-full"
          style={{ transform: `scale(${zoom / 100})` }}
        >
          <iframe
            src={originalUrl}
            title="FAX原本プレビュー"
            className="h-full w-full max-w-5xl rounded-lg border border-slate-400 bg-white shadow-2xl"
          />
        </div>
      </main>
    </div>
  )
}
