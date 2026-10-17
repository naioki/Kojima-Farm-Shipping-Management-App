'use client'

import { useState } from 'react'
import { FileText, Printer } from 'lucide-react'
import toast from 'react-hot-toast'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'

/**
 * 品目別出荷票の発行フォーム（写真の和郷園フォーマット）。受注詳細から品目別に発行する。
 * ヘッダー会社名（和郷園など）は取引先ごとに datalist で選択、または自由記入で切替できる。
 * 発行時に確定した値を /api/orders/[id]/shipping-slip へ渡し、PDFを新規タブで開く。
 */

export interface SlipItemInput {
  id: string
  productName: string
  /** TOTAL数の既定（受注数量）。 */
  total: string
  /** 規格の既定。 */
  spec: string
  /** マテハン名の既定（荷姿）。 */
  mateHan: string
}

interface RowState {
  spec: string
  iri: string
  caseCount: string
  hasu: string
  hasuCaseCount: string
  total: string
  mateHan: string
}

/** 'YYYY-MM-DD' → '7月8日(水)'。不正なら空文字。 */
function formatShipDate(d: string | null): string {
  if (!d) return ''
  const dt = new Date(`${d}T00:00:00+09:00`)
  if (Number.isNaN(dt.getTime())) return ''
  const w = ['日', '月', '火', '水', '木', '金', '土'][dt.getDay()]
  return `${dt.getMonth() + 1}月${dt.getDate()}日(${w})`
}

export function ShippingSlipIssuer({
  orderId,
  items,
  defaultHeaderCompany,
  companyOptions,
  defaultDestination,
  deliveryDate,
}: {
  orderId: string
  items: SlipItemInput[]
  /** ヘッダー会社名の既定（取引先名）。 */
  defaultHeaderCompany: string
  /** 選択候補の会社名（datalist）。 */
  companyOptions: string[]
  /** 行先の既定（納入先＞取引先）。 */
  defaultDestination: string
  deliveryDate: string | null
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [size, setSize] = useState<'A4' | 'A5'>('A4')
  const [headerCompany, setHeaderCompany] = useState(defaultHeaderCompany)
  const [destination, setDestination] = useState(defaultDestination)
  const [shipDate, setShipDate] = useState(formatShipDate(deliveryDate))
  const [rows, setRows] = useState<RowState[]>(() =>
    items.map((it) => ({
      spec: it.spec,
      iri: '',
      caseCount: '',
      hasu: '',
      hasuCaseCount: '',
      total: it.total,
      mateHan: it.mateHan,
    })),
  )

  function update(i: number, patch: Partial<RowState>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  }

  async function issue() {
    setBusy(true)
    try {
      const slips = items.map((it, i) => ({
        headerCompany,
        destination,
        productName: it.productName,
        shipDate,
        spec: rows[i]!.spec,
        iri: rows[i]!.iri,
        caseCount: rows[i]!.caseCount,
        hasu: rows[i]!.hasu,
        hasuCaseCount: rows[i]!.hasuCaseCount,
        total: rows[i]!.total,
        mateHan: rows[i]!.mateHan,
      }))
      const res = await fetch(`/api/orders/${orderId}/shipping-slip`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slips, size }),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error ?? `発行に失敗 (${res.status})`)
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      window.open(url, '_blank', 'noopener')
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
      setOpen(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '発行に失敗しました')
    } finally {
      setBusy(false)
    }
  }

  const listId = 'slip-company-options'

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <FileText className="h-4 w-4" aria-hidden />
        出荷票を発行
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="品目別出荷票の発行"
        className="max-w-2xl"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="tertiary" size="sm" onClick={() => setOpen(false)}>
              キャンセル
            </Button>
            <Button size="sm" onClick={issue} isLoading={busy}>
              <Printer className="h-4 w-4" aria-hidden />
              PDFを開く
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          {/* 共通項目 */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input
              label="ヘッダー会社名"
              hint="選択または記入（取引先ごとに変わる）"
              list={listId}
              value={headerCompany}
              onChange={(e) => setHeaderCompany(e.target.value)}
            />
            <datalist id={listId}>
              {companyOptions.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            <div className="space-y-1.5">
              <span className="block text-sm font-medium text-ink">用紙サイズ</span>
              <div className="flex gap-2">
                {(['A4', 'A5'] as const).map((sz) => (
                  <button
                    key={sz}
                    type="button"
                    onClick={() => setSize(sz)}
                    className={`h-10 flex-1 rounded border text-sm ${
                      size === sz
                        ? 'border-trust-500 bg-trust-50 font-medium text-trust-700'
                        : 'border-line-strong text-ink-soft hover:border-earth-400'
                    }`}
                  >
                    {sz}
                  </button>
                ))}
              </div>
            </div>
            <Input label="行先" value={destination} onChange={(e) => setDestination(e.target.value)} />
            <Input label="出荷日" value={shipDate} onChange={(e) => setShipDate(e.target.value)} />
          </div>

          {/* 品目ごと */}
          <div className="space-y-3">
            {items.map((it, i) => (
              <div key={it.id} className="rounded-lg border border-line bg-bg-soft/40 p-3">
                <p className="mb-2 font-medium text-ink">{it.productName}</p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Input label="規格" value={rows[i]!.spec} onChange={(e) => update(i, { spec: e.target.value })} />
                  <Input label="マテハン名" value={rows[i]!.mateHan} onChange={(e) => update(i, { mateHan: e.target.value })} />
                  <Input label="入数" inputMode="numeric" value={rows[i]!.iri} onChange={(e) => update(i, { iri: e.target.value })} />
                  <Input label="ケース数" inputMode="numeric" value={rows[i]!.caseCount} onChange={(e) => update(i, { caseCount: e.target.value })} />
                  <Input label="端数" inputMode="numeric" value={rows[i]!.hasu} onChange={(e) => update(i, { hasu: e.target.value })} />
                  <Input label="端数ケース数" inputMode="numeric" value={rows[i]!.hasuCaseCount} onChange={(e) => update(i, { hasuCaseCount: e.target.value })} />
                  <Input label="TOTAL数" inputMode="numeric" value={rows[i]!.total} onChange={(e) => update(i, { total: e.target.value })} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </Modal>
    </>
  )
}
