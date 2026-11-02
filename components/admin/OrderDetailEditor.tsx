'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Save, RotateCcw, Calendar, MapPin, FileText, CheckCircle2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { yen } from '@/lib/format'
import type { OrderDetailItem } from '@/lib/orders/list'

export interface OrderDetailEditorProps {
  orderId: string
  customerName: string
  initialDeliveryDate: string | null
  initialDestinationId: string | null
  initialNote: string | null
  destinations: { id: string; label: string }[]
  initialItems: OrderDetailItem[]
}

const FIELD_STATUS: Record<string, { label: string; cls: string }> = {
  not_started: { label: '未着手', cls: 'text-ink-faint bg-bg-soft' },
  packed: { label: '梱包完了', cls: 'text-earth-800 bg-earth-100' },
  shipped: { label: '出荷済み', cls: 'text-trust-800 bg-trust-100' },
}

export function OrderDetailEditor({
  orderId,
  customerName: _customerName,
  initialDeliveryDate,
  initialDestinationId,
  initialNote,
  destinations,
  initialItems,
}: OrderDetailEditorProps) {
  const router = useRouter()
  const [deliveryDate, setDeliveryDate] = useState(initialDeliveryDate ?? '')
  const [destinationId, setDestinationId] = useState(initialDestinationId ?? '')
  const [note, setNote] = useState(initialNote ?? '')

  const [items, setItems] = useState<OrderDetailItem[]>(() =>
    initialItems.map((it) => ({ ...it }))
  )
  const [isSaving, setIsSaving] = useState(false)

  const isHeaderChanged =
    deliveryDate !== (initialDeliveryDate ?? '') ||
    destinationId !== (initialDestinationId ?? '') ||
    note !== (initialNote ?? '')

  const isItemsChanged = items.some((it) => {
    const orig = initialItems.find((o) => o.id === it.id)
    if (!orig) return false
    return (
      it.quantity !== orig.quantity ||
      it.unitPrice !== orig.unitPrice ||
      (it.spec ?? '') !== (orig.spec ?? '') ||
      (it.containerType ?? '') !== (orig.containerType ?? '')
    )
  })

  const isChanged = isHeaderChanged || isItemsChanged

  function handleItemChange(
    id: string,
    field: 'quantity' | 'unitPrice' | 'spec' | 'containerType',
    val: string
  ) {
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== id) return it
        if (field === 'quantity') {
          const q = Number(val)
          const newQty = isNaN(q) ? 0 : Math.max(0, q)
          const lineTotal = it.unitPrice != null ? Math.round(newQty * it.unitPrice) : 0
          return { ...it, quantity: newQty, lineTotal }
        }
        if (field === 'unitPrice') {
          const up = val === '' ? null : Number(val)
          const newPrice = up !== null && !isNaN(up) ? Math.max(0, up) : null
          const lineTotal = newPrice != null ? Math.round(it.quantity * newPrice) : 0
          return { ...it, unitPrice: newPrice, lineTotal }
        }
        if (field === 'spec') {
          return { ...it, spec: val.trim() || null }
        }
        if (field === 'containerType') {
          return { ...it, containerType: val.trim() || null }
        }
        return it
      })
    )
  }

  function handleReset() {
    setDeliveryDate(initialDeliveryDate ?? '')
    setDestinationId(initialDestinationId ?? '')
    setNote(initialNote ?? '')
    setItems(initialItems.map((it) => ({ ...it })))
    toast('変更をリセットしました', { icon: '↩️' })
  }

  async function handleSave() {
    if (!isChanged) return
    setIsSaving(true)

    try {
      // 1. ヘッダー更新 (PATCH /api/orders/[id])
      if (isHeaderChanged) {
        const orderRes = await fetch(`/api/orders/${orderId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            delivery_date: deliveryDate || undefined,
            destination_id: destinationId || null,
            note: note || null,
          }),
        })
        if (!orderRes.ok) {
          const errData = await orderRes.json().catch(() => ({}))
          throw new Error(errData.error || `受注情報の更新に失敗しました (${orderRes.status})`)
        }
      }

      // 2. 明細更新 (PATCH /api/order-items/[id])
      const modifiedItems = items.filter((it) => {
        const orig = initialItems.find((o) => o.id === it.id)
        if (!orig) return false
        return (
          it.quantity !== orig.quantity ||
          it.unitPrice !== orig.unitPrice ||
          (it.spec ?? '') !== (orig.spec ?? '') ||
          (it.containerType ?? '') !== (orig.containerType ?? '')
        )
      })

      for (const it of modifiedItems) {
        const itemRes = await fetch(`/api/order-items/${it.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            quantity: it.quantity,
            unit_price: it.unitPrice,
            spec: it.spec,
            container_type: it.containerType,
          }),
        })
        if (!itemRes.ok) {
          const errData = await itemRes.json().catch(() => ({}))
          throw new Error(errData.error || `商品「${it.productName}」の更新に失敗しました`)
        }
      }

      toast.success('受注詳細の変更を保存しました')
      router.refresh()
    } catch (err) {
      console.error('[OrderDetailEditor] save error:', err)
      const msg = err instanceof Error ? err.message : '更新に失敗しました'
      toast.error(msg)
    } finally {
      setIsSaving(false)
    }
  }

  const computedTotal = items.reduce((sum, it) => sum + (it.lineTotal || 0), 0)

  return (
    <div className="space-y-4">
      {/* 注文ヘッダー編集カード */}
      <Card variant="elevated" className="space-y-4">
        <div className="flex items-center justify-between border-b border-line pb-2">
          <h2 className="flex items-center gap-2 font-display text-base font-bold text-ink">
            <FileText className="h-4 w-4 text-forest-700" />
            基本情報・配送指定
          </h2>
          {isChanged && (
            <span className="rounded-full bg-harvest-100 px-2.5 py-0.5 text-xs font-bold text-harvest-800">
              ● 未保存の変更あり
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {/* 納品日 */}
          <div>
            <label className="flex items-center gap-1.5 text-xs font-medium text-ink-soft">
              <Calendar className="h-3.5 w-3.5 text-ink-faint" />
              納品日
            </label>
            <input
              type="date"
              value={deliveryDate}
              onChange={(e) => setDeliveryDate(e.target.value)}
              className="mt-1 block h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm font-bold text-ink focus:border-forest-600 focus:outline-none focus:ring-1 focus:ring-forest-600"
            />
          </div>

          {/* 納入先 */}
          <div>
            <label className="flex items-center gap-1.5 text-xs font-medium text-ink-soft">
              <MapPin className="h-3.5 w-3.5 text-ink-faint" />
              納入先
            </label>
            {destinations.length > 0 ? (
              <Select
                options={[
                  { value: '', label: '指定なし (本社・主拠点納品)' },
                  ...destinations.map((d) => ({ value: d.id, label: d.label })),
                ]}
                value={destinationId}
                onChange={(e) => setDestinationId(e.target.value)}
                className="mt-1"
              />
            ) : (
              <p className="mt-2 text-xs text-ink-faint">納入先マスタ未登録（本社納品）</p>
            )}
          </div>
        </div>

        {/* 備考 */}
        <div>
          <label className="block text-xs font-medium text-ink-soft">備考・特記事項</label>
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="現場への連絡事項、特記、配送注意事項など"
            className="mt-1"
          />
        </div>
      </Card>

      {/* 注文明細編集テーブル */}
      <Card variant="elevated" className="overflow-hidden p-0">
        <div className="border-b border-line px-4 py-3">
          <h2 className="flex items-center gap-2 font-display text-base font-bold text-ink">
            <CheckCircle2 className="h-4 w-4 text-forest-700" />
            受注明細（インライン編集）
          </h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-line bg-bg-soft text-left text-xs text-ink-faint">
                <th className="px-4 py-2.5 font-medium">品名</th>
                <th className="px-3 py-2.5 font-medium">規格</th>
                <th className="px-3 py-2.5 font-medium">荷姿/コンテナ</th>
                <th className="px-3 py-2.5 text-right font-medium">数量</th>
                <th className="px-3 py-2.5 text-right font-medium">単価 (円)</th>
                <th className="px-3 py-2.5 text-right font-medium">小計</th>
                <th className="px-4 py-2.5 text-center font-medium">現場状態</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const fs = it.fieldStatus ? FIELD_STATUS[it.fieldStatus] : undefined
                return (
                  <tr key={it.id} className="border-b border-line/60 last:border-0 hover:bg-surface-soft">
                    {/* 品名 */}
                    <td className="px-4 py-3">
                      <span className="font-bold text-ink">{it.productName}</span>
                    </td>

                    {/* 規格 */}
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        value={it.spec ?? ''}
                        onChange={(e) => handleItemChange(it.id, 'spec', e.target.value)}
                        placeholder="例: L, 200g"
                        className="h-8 w-24 rounded border border-line bg-surface px-2 text-xs text-ink focus:border-forest-600 focus:outline-none"
                      />
                    </td>

                    {/* 荷姿・コンテナ */}
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        value={it.containerType ?? ''}
                        onChange={(e) => handleItemChange(it.id, 'containerType', e.target.value)}
                        placeholder="例: 収穫コンテナ, ダンボール"
                        className="h-8 w-32 rounded border border-line bg-surface px-2 text-xs text-ink focus:border-forest-600 focus:outline-none"
                      />
                    </td>

                    {/* 数量 */}
                    <td className="px-3 py-2 text-right">
                      <div className="inline-flex items-center justify-end gap-1">
                        <input
                          type="number"
                          min="0"
                          value={it.quantity ?? 0}
                          onChange={(e) => handleItemChange(it.id, 'quantity', e.target.value)}
                          className="num h-8 w-20 rounded border border-line bg-surface px-2 text-right text-xs font-black text-ink focus:border-forest-600 focus:outline-none"
                        />
                        <span className="text-xs text-ink-soft">{it.unit}</span>
                      </div>
                    </td>

                    {/* 単価 */}
                    <td className="px-3 py-2 text-right">
                      <input
                        type="number"
                        min="0"
                        value={it.unitPrice ?? ''}
                        onChange={(e) => handleItemChange(it.id, 'unitPrice', e.target.value)}
                        placeholder="未設定"
                        className="num h-8 w-24 rounded border border-line bg-surface px-2 text-right text-xs text-ink focus:border-forest-600 focus:outline-none"
                      />
                    </td>

                    {/* 小計 */}
                    <td className="num px-3 py-3 text-right font-bold text-ink">
                      {yen(it.lineTotal)}
                    </td>

                    {/* 現場状態 */}
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                          fs?.cls ?? 'text-ink-faint'
                        }`}
                      >
                        {fs?.label ?? '—'}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-line bg-bg-soft">
                <td className="px-4 py-3 text-sm font-bold text-ink" colSpan={5}>
                  合計金額
                </td>
                <td className="num px-3 py-3 text-right text-base font-black text-forest-900">
                  {yen(computedTotal)}
                </td>
                <td aria-hidden />
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      {/* 保存・リセットアクションバー */}
      <div className="flex items-center justify-end gap-3 pt-2">
        {isChanged && (
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={handleReset}
            disabled={isSaving}
          >
            <RotateCcw className="mr-1.5 h-4 w-4" />
            変更を取り消す
          </Button>
        )}
        <Button
          type="button"
          variant="primary"
          size="md"
          onClick={handleSave}
          disabled={!isChanged || isSaving}
          isLoading={isSaving}
        >
          <Save className="mr-1.5 h-4 w-4" />
          {isChanged ? '変更を保存する' : '保存済み'}
        </Button>
      </div>
    </div>
  )
}
