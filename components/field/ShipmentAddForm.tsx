'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Plus, ArrowRight } from 'lucide-react'
import toast from 'react-hot-toast'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { Input } from '@/components/ui/Input'
import { Card } from '@/components/ui/Card'
import { parseQuantity } from '@/lib/calculations/parse-quantity'

export interface ShipmentAddFormProps {
  deliveryDate: string
  customers: { id: string; name: string }[]
  products: { id: string; name: string; unit: string }[]
  /** `${customer_id}:${product_id}` → packs_per_case（c記法プレビュー用） */
  packsByPair: Record<string, number | null>
}

const ADD_ERRORS: Record<string, string> = {
  packs_per_case_required: 'ケース記法ですが P/C（1ケースの入数）が未設定です。取引先設定で登録してください。',
  unparseable: '数量を解釈できませんでした（例: 10 / 15c2 / x58）。',
  negative: '数量が負の値です。',
  empty_quantity: '数量を入力してください。',
  unknown_product: '商品が見つかりません。',
}

/**
 * 出荷一覧の「スマート追加」フォーム（Laravel版 画面2）。
 * 取引先・品目・数量（"15c2" 等の混在記号可）を入れて1件追加。
 * 入力中はスマートパース結果をライブプレビュー（誤解釈を投入前に気づける・features.md §5）。
 */
export function ShipmentAddForm({ deliveryDate, customers, products, packsByPair }: ShipmentAddFormProps) {
  const router = useRouter()
  const [customerId, setCustomerId] = useState('')
  const [productId, setProductId] = useState('')
  const [qtyRaw, setQtyRaw] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const unit = products.find((p) => p.id === productId)?.unit ?? '個'
  const packsPerCase = customerId && productId ? packsByPair[`${customerId}:${productId}`] ?? null : null

  // ライブプレビュー（サーバ側でも同じ lib で再計算して確定する）
  const preview = useMemo(() => {
    if (qtyRaw.trim() === '') return null
    return parseQuantity(qtyRaw, { packsPerCase })
  }, [qtyRaw, packsPerCase])

  const previewText = (() => {
    if (!preview) return null
    if (preview.type === 'delete') return null
    if (preview.type === 'error')
      return { kind: 'error' as const, text: ADD_ERRORS[preview.reason] ?? '解釈できません', reason: preview.reason }
    const parts = [`合計 ${preview.total.toString()} ${unit}`]
    if (preview.interpretation === 'cases' && preview.cases != null) {
      parts.push(`（${preview.cases}ケース × ${packsPerCase} + 端数${preview.loose}）`)
    }
    if (preview.interpretation === 'x_total') parts.push('（x記法：x の後の数字を合計とみなす）')
    return { kind: 'ok' as const, text: parts.join(' ') }
  })()

  async function submit() {
    if (!customerId || !productId || qtyRaw.trim() === '') {
      toast.error('取引先・品目・数量をすべて入力してください')
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch('/api/shipments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          customer_id: customerId,
          product_id: productId,
          delivery_date: deliveryDate,
          quantity_raw: qtyRaw,
        }),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        throw new Error(ADD_ERRORS[json.error ?? ''] ?? json.error ?? `追加に失敗 (${res.status})`)
      }
      toast.success('追加しました')
      setQtyRaw('')
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '追加に失敗しました')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card className="space-y-3">
      <h2 className="font-display text-base font-bold text-ink">スマート追加</h2>
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
        <Select
          label="取引先"
          placeholder="選択"
          value={customerId}
          onChange={(e) => setCustomerId(e.target.value)}
          options={customers.map((c) => ({ value: c.id, label: c.name }))}
        />
        <Select
          label="品目"
          placeholder="選択"
          value={productId}
          onChange={(e) => setProductId(e.target.value)}
          options={products.map((p) => ({ value: p.id, label: p.name }))}
        />
        <Input
          label="数量"
          placeholder="10 / 15c2 / x58"
          inputMode="text"
          value={qtyRaw}
          onChange={(e) => setQtyRaw(e.target.value)}
          className="sm:w-32"
        />
        <Button onClick={submit} isLoading={submitting} size="lg" className="sm:w-auto">
          <Plus className="h-4 w-4" aria-hidden />
          追加
        </Button>
      </div>
      {previewText && (
        <p className={`text-sm ${previewText.kind === 'error' ? 'text-alert' : 'text-ink-soft'}`}>
          {previewText.text}
          {previewText.kind === 'error' && previewText.reason === 'packs_per_case_required' && customerId && (
            <Link
              href={`/admin/customers/${customerId}`}
              className="ml-1 inline-flex items-center gap-0.5 font-medium text-trust-600 underline underline-offset-2 hover:text-trust-700"
            >
              取引先設定を開く
              <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          )}
        </p>
      )}
    </Card>
  )
}
