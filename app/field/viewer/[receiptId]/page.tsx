'use client'

import { useState } from 'react'
import { useRouter, useParams, useSearchParams } from 'next/navigation'
import { ArrowLeft, ZoomIn, ZoomOut, RotateCcw, ExternalLink } from 'lucide-react'

export default function ReceiptViewerPage() {
  const router = useRouter()
  const params = useParams()
  const searchParams = useSearchParams()
  const receiptId = params.receiptId as string
  const returnDate = searchParams.get('date') || ''

  const [zoom, setZoom] = useState<number>(100)

  const originalUrl = `/api/receipts/${receiptId}/original?mode=preview`
  const directFileUrl = `/api/receipts/${receiptId}/original`

  const handleBack = () => {
    if (window.history.length > 1) {
      router.back()
    } else {
      router.push(returnDate ? `/field/shipments?date=${returnDate}` : '/field/shipments')
    }
  }

  return (
    <div className="flex h-screen w-screen flex-col bg-slate-900 text-white">
      {/* 上部固定バー */}
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-700 bg-slate-800 px-3 sm:px-6">
        <button
          type="button"
          onClick={handleBack}
          className="inline-flex h-12 items-center gap-2 rounded-xl bg-slate-700 px-4 text-base font-bold text-white shadow hover:bg-slate-600 active:scale-95"
        >
          <ArrowLeft className="h-6 w-6" />
          <span>⬅ 注文一覧に戻る</span>
        </button>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setZoom((prev) => Math.max(50, prev - 25))}
            className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-slate-700 text-white hover:bg-slate-600 active:scale-95"
            aria-label="縮小"
          >
            <ZoomOut className="h-5 w-5" />
          </button>
          <span className="min-w-[48px] text-center text-sm font-bold text-slate-300">{zoom}%</span>
          <button
            type="button"
            onClick={() => setZoom((prev) => Math.min(300, prev + 25))}
            className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-slate-700 text-white hover:bg-slate-600 active:scale-95"
            aria-label="拡大"
          >
            <ZoomIn className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => setZoom(100)}
            className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-slate-700 text-white hover:bg-slate-600 active:scale-95"
            aria-label="リセット"
          >
            <RotateCcw className="h-5 w-5" />
          </button>
          <a
            href={directFileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-11 items-center gap-1.5 rounded-xl border border-sky-400 bg-sky-950/80 px-3 text-xs font-bold text-sky-200 hover:bg-sky-900 active:scale-95"
          >
            <span>別タブ</span>
            <ExternalLink className="h-4 w-4" />
          </a>
        </div>
      </header>

      {/* メイン原本表示エリア */}
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
