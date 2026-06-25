'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle } from 'lucide-react'
import toast from 'react-hot-toast'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/Button'
import { ConfirmModal } from '@/components/ui/Modal'

interface ParsedOrder {
  customer_name: string | null
  delivery_date: string | null
  items: {
    raw_name: string
    product_name: string | null
    quantity: string
    unit: string | null
    confidence: number
  }[]
}

interface Props {
  order: ParsedOrder
  index: number
  customers: { id: string; name: string }[]
  products: { id: string; name: string }[]
}

/** "100+0" → 100, "x58" → 58, "23.0 cs" → 23, "10" → 10。解釈不能は NaN。 */
function parseOcrQty(raw: string): number {
  const x = raw.match(/x(\d+)/i)
  if (x) return Number(x[1])
  const n = raw.match(/^(\d+(?:\.\d+)?)/)
  return n ? Number(n[1]) : NaN
}

function bestMatchId(name: string | null, products: { id: string; name: string }[]): string {
  if (!name) return ''
  const lower = name.toLowerCase()
  const exact = products.find((p) => p.name.toLowerCase() === lower)
  if (exact) return exact.id
  const partial = products.find(
    (p) => p.name.toLowerCase().includes(lower) || lower.includes(p.name.toLowerCase()),
  )
  return partial?.id ?? ''
}

function bestMatchCustomerId(name: string | null, customers: { id: string; name: string }[]): string {
  if (!name) return ''
  const lower = name.toLowerCase()
  const exact = customers.find((c) => c.name.toLowerCase() === lower)
  if (exact) return exact.id
  const partial = customers.find(
    (c) => c.name.toLowerCase().includes(lower) || lower.includes(c.name.toLowerCase()),
  )
  return partial?.id ?? ''
}

/**
 * OCR読み取り結果（1注文分）を受注として保存するフォーム。
 * 取引先・納品日・商品を確認してから POST /api/orders に送信する。
 */
export function OcrSaveSection({ order, index, customers, products }: Props) {
  const router = useRouter()

  const [customerId, setCustomerId] = useState(() => bestMatchCustomerId(order.customer_name, customers))
  const [deliveryDate, setDeliveryDate] = useState(order.delivery_date ?? '')
  const [rows, setRows] = useState(() =>
    order.items.map((it) => ({
      raw_name: it.raw_name,
      product_id: bestMatchId(it.product_name, products),
      product_name: it.product_name ?? it.raw_name,
      quantity: String(parseOcrQty(it.quantity) || ''),
      unit: it.unit || '個',
      confidence: it.confidence,
    })),
  )
  const [saving, setSaving] = useState(false)
  const [dupConfirmOpen, setDupConfirmOpen] = useState(false)
  const [dupCount, setDupCount] = useState(0)

  function updateRow(i: number, field: string, value: string) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)))
  }

  /** confirmDuplicate=true なら重複警告を無視して登録を強行する。 */
  async function handleSave(confirmDuplicate = false) {
    if (!customerId) { toast.error('取引先を選択してください'); return }
    if (!deliveryDate) { toast.error('納品日を入力してください'); return }
    const invalid = rows.filter((r) => !r.product_id || isNaN(Number(r.quantity)) || Number(r.quantity) <= 0)
    if (invalid.length > 0) { toast.error('商品と数量をすべて入力してください'); return }

    setSaving(true)
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          customer_id: customerId,
          delivery_date: deliveryDate,
          confirm_duplicate: confirmDuplicate,
          items: rows.map((r) => ({
            product_id: r.product_id,
            product_name: r.product_name,
            quantity: Number(r.quantity),
            unit: r.unit,
            unit_price: 0,
            tax_rate: 8,
          })),
        }),
      })
      const json = (await res.json().catch(() => ({}))) as {
        error?: string
        duplicate?: boolean
        existing?: { id: string; item_count: number; created_at: string }[]
      }
      // 409 = 同一取引先×納品日の既存注文あり。警告ダイアログを出して判断を仰ぐ。
      if (res.status === 409 && json.duplicate) {
        setDupCount(json.existing?.length ?? 1)
        setDupConfirmOpen(true)
        return
      }
      if (!res.ok) throw new Error(json.error ?? `保存失敗 (${res.status})`)
      toast.success('注文を登録しました')
      router.push('/admin/orders')
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const inputCls =
    'h-9 w-full rounded border border-line-strong bg-bg-card px-2 text-sm text-ink focus:outline-none focus:border-trust-500 focus:ring-2 focus:ring-trust-100'
  const selectCls =
    'h-9 w-full rounded border border-line-strong bg-bg-card px-2 text-sm text-ink focus:outline-none focus:border-trust-500 focus:ring-2 focus:ring-trust-100'

  return (
    <div className="space-y-3 rounded-lg border border-earth-200 bg-earth-50 p-4">
      <p className="text-xs font-semibold text-earth-700">注文 {index + 1} を保存</p>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-ink-soft">
            取引先 <span className="text-alert">*</span>
            {order.customer_name && (
              <span className="ml-1 text-ink-faint">（AI読取: {order.customer_name}）</span>
            )}
          </label>
          <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className={selectCls}>
            <option value="">選択してください</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-ink-soft">
            納品日 <span className="text-alert">*</span>
          </label>
          <input
            type="date"
            value={deliveryDate}
            onChange={(e) => setDeliveryDate(e.target.value)}
            className={inputCls}
          />
        </div>
      </div>

      <div className="overflow-x-auto rounded border border-line">
        <table className="w-full text-sm">
          <thead className="bg-bg-soft text-xs text-ink-soft">
            <tr>
              <th className="px-2 py-2 text-left font-medium">読取り原文</th>
              <th className="px-2 py-2 text-left font-medium">商品</th>
              <th className="w-20 px-2 py-2 text-right font-medium">数量</th>
              <th className="w-16 px-2 py-2 text-left font-medium">単位</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r, i) => (
              <tr key={i} className={cn(r.confidence < 0.7 && 'bg-alert-bg/30')}>
                <td className="px-2 py-1.5 text-xs text-ink-faint">
                  {r.confidence < 0.7 && <AlertTriangle className="mr-1 inline h-3 w-3 text-alert" />}
                  {r.raw_name}
                </td>
                <td className="px-2 py-1.5">
                  <select
                    value={r.product_id}
                    onChange={(e) => {
                      const pid = e.target.value
                      const pname = products.find((p) => p.id === pid)?.name ?? r.product_name
                      updateRow(i, 'product_id', pid)
                      updateRow(i, 'product_name', pname)
                    }}
                    className={selectCls}
                  >
                    <option value="">— 選択 —</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </td>
                <td className="px-2 py-1.5">
                  <input
                    type="number"
                    value={r.quantity}
                    onChange={(e) => updateRow(i, 'quantity', e.target.value)}
                    className={cn(inputCls, 'text-right')}
                    min={1}
                  />
                </td>
                <td className="px-2 py-1.5">
                  <input
                    type="text"
                    value={r.unit}
                    onChange={(e) => updateRow(i, 'unit', e.target.value)}
                    className={inputCls}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex justify-end">
        <Button variant="primary" onClick={() => handleSave(false)} isLoading={saving} disabled={saving}>
          注文として保存
        </Button>
      </div>

      {/* 重複警告（同一取引先×納品日の既存注文あり）。承認すれば登録を強行する。 */}
      <ConfirmModal
        open={dupConfirmOpen}
        onClose={() => setDupConfirmOpen(false)}
        onConfirm={() => {
          setDupConfirmOpen(false)
          void handleSave(true)
        }}
        title="重複の可能性"
        message={`この取引先・納品日（${deliveryDate}）の注文が既に ${dupCount} 件あります。FAXの再送・二重読み取りの可能性があります。それでも新しい注文として登録しますか？`}
        confirmLabel="重複を承知で登録"
        danger
        isLoading={saving}
      />
    </div>
  )
}
