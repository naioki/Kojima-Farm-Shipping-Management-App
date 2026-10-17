'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'
import toast from 'react-hot-toast'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { Input } from '@/components/ui/Input'
import { jstTodayStr } from '@/lib/dates'

/**
 * ロット作成フォーム（J-GAPトレサ）。収穫日×圃場×品目で1ロット。
 * 「出荷日に一括紐付け」で、その日の同品目明細にまとめて lot_id を付ける
 * （1品目=1日1ロットが実態。明細ごとの手作業をなくす）。
 */
export function LotForm({ products }: { products: { id: string; name: string }[] }) {
  const router = useRouter()
  const [productId, setProductId] = useState('')
  const [harvestDate, setHarvestDate] = useState(jstTodayStr())
  const [fieldName, setFieldName] = useState('')
  const [gapRef, setGapRef] = useState('')
  const [assignDate, setAssignDate] = useState(jstTodayStr())
  const [doAssign, setDoAssign] = useState(true)
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!productId) {
      toast.error('品目を選んでください')
      return
    }
    setBusy(true)
    try {
      const res = await fetch('/api/lots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: productId,
          harvest_date: harvestDate,
          field_name: fieldName || undefined,
          gap_record_ref: gapRef || undefined,
          assign_delivery_date: doAssign ? assignDate : undefined,
        }),
      })
      const j = (await res.json().catch(() => null)) as
        | { lot?: { lot_no: string }; assigned?: number; error?: string }
        | null
      if (!res.ok || !j?.lot) {
        toast.error(j?.error ?? '作成できませんでした')
        return
      }
      toast.success(
        doAssign ? `${j.lot.lot_no} を作成し、${j.assigned}明細に紐付けました` : `${j.lot.lot_no} を作成しました`,
      )
      setFieldName('')
      setGapRef('')
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Select
          label="品目"
          placeholder="選択"
          value={productId}
          onChange={(e) => setProductId(e.target.value)}
          options={products.map((p) => ({ value: p.id, label: p.name }))}
        />
        <Input
          label="収穫日"
          required
          type="date"
          value={harvestDate}
          onChange={(e) => setHarvestDate(e.target.value)}
        />
        <Input
          label="圃場名"
          placeholder="例: 荒崎 / 第3ハウス"
          value={fieldName}
          onChange={(e) => setFieldName(e.target.value)}
        />
        <Input
          label="GAP台帳の参照"
          placeholder="例: 施肥台帳2026-P12"
          value={gapRef}
          onChange={(e) => setGapRef(e.target.value)}
        />
      </div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={doAssign}
            onChange={(e) => setDoAssign(e.target.checked)}
            className="h-5 w-5 rounded border-line-strong accent-earth-600"
          />
          この出荷日の同品目の明細に一括紐付け：
          <input
            type="date"
            value={assignDate}
            onChange={(e) => setAssignDate(e.target.value)}
            disabled={!doAssign}
            aria-label="紐付ける出荷日"
            className="num h-10 rounded border border-line-strong bg-bg-card px-3 text-sm text-ink focus:border-trust-500 focus:outline-none focus:ring-2 focus:ring-trust-100 disabled:opacity-50"
          />
        </label>
        <Button variant="primary" size="md" isLoading={busy} onClick={() => void submit()}>
          <Plus className="h-4 w-4" aria-hidden />
          ロットを作成
        </Button>
      </div>
    </div>
  )
}
