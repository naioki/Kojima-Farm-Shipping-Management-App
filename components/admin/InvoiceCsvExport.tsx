'use client'

import { useState } from 'react'
import { Table } from 'lucide-react'
import toast from 'react-hot-toast'
import { Button } from '@/components/ui/Button'
import { jstDateStr } from '@/lib/dates'

/** 月初・月末の既定値（今日が属する月）。 */
function thisMonthRange(): { start: string; end: string } {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth()
  const start = new Date(y, m, 1)
  const end = new Date(y, m + 1, 0)
  return { start: jstDateStr(start), end: jstDateStr(end) }
}

/**
 * 期間内の全請求書を1ファイルにまとめた会計取り込み用 CSV をダウンロード。
 * マネーフォワード / freee の取り込みウィザードで列マッピングして使う。
 */
export function InvoiceCsvExport() {
  const def = thisMonthRange()
  const [start, setStart] = useState(def.start)
  const [end, setEnd] = useState(def.end)

  function download() {
    if (start > end) {
      toast.error('開始日は終了日以前にしてください')
      return
    }
    const url = `/api/invoices/csv?start=${start}&end=${end}`
    window.location.href = url
  }

  const input =
    'h-10 rounded border border-line-strong bg-bg-card px-3 text-sm text-ink focus:outline-none focus:border-trust-500 focus:ring-2 focus:ring-trust-100'

  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="space-y-1">
        <span className="block text-xs font-medium text-ink-soft">発行日（開始）</span>
        <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className={input} />
      </label>
      <label className="space-y-1">
        <span className="block text-xs font-medium text-ink-soft">発行日（終了）</span>
        <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className={input} />
      </label>
      <Button variant="secondary" size="md" onClick={download}>
        <Table className="h-4 w-4" aria-hidden />
        CSV出力
      </Button>
    </div>
  )
}
