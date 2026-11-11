'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Save, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import type { OrderDetailItem } from '@/lib/orders/list'
import { parseQuantity } from '@/lib/calculations/parse-quantity'
import { ConfirmModal } from '@/components/ui/Modal'
import { showResponseWarnings } from '@/lib/client/show-warnings'

export interface OrderDetailEditorProps {
  orderId: string
  customerName: string
  initialDeliveryDate: string | null
  initialDestinationId: string | null
  initialNote: string | null
  destinations: { id: string; label: string }[]
  /** 納入先「なし」の選択肢の表示（既定: 納入先なし（取引先あて）） */
  emptyDestinationLabel?: string
  initialItems: OrderDetailItem[]
}

interface EditableItemState extends OrderDetailItem {
  draftQty: string
  draftSpec: string
  draftContainer: string
  draftPrice: string
  saving: boolean
}

/**
 * 受注詳細画面（/admin/orders/[id]）のインライン編集コンポーネント（#38）。
 * 納品日・納入先・備考、および各明細の数量（箱数換算表示付き）・規格・コンテナ・単価をその場で変更・保存できる。
 */
export function OrderDetailEditor({
  orderId,
  customerName,
  initialDeliveryDate,
  initialDestinationId,
  initialNote,
  destinations,
  emptyDestinationLabel = '納入先なし（取引先あて）',
  initialItems,
}: OrderDetailEditorProps) {
  const router = useRouter()
  const [deliveryDate, setDeliveryDate] = useState(initialDeliveryDate ?? '')
  const [destinationId, setDestinationId] = useState(initialDestinationId ?? '')
  const [note, setNote] = useState(initialNote ?? '')
  const [savingHeader, setSavingHeader] = useState(false)
  // 保存済みの基本情報（未保存の変更があるかの判定に使う）
  const [savedHeader, setSavedHeader] = useState({
    deliveryDate: initialDeliveryDate ?? '',
    destinationId: initialDestinationId ?? '',
    note: initialNote ?? '',
  })
  const [deleteTarget, setDeleteTarget] = useState<EditableItemState | null>(null)

  const [items, setItems] = useState<EditableItemState[]>(() =>
    initialItems.map((it) => ({
      ...it,
      draftQty: String(it.quantity),
      draftSpec: it.spec ?? '',
      draftContainer: it.containerType ?? '',
      draftPrice: it.unitPrice != null ? String(it.unitPrice) : '',
      saving: false,
    })),
  )

  const ppcFor = (specStr: string): number => {
    const combined = `${customerName} ${specStr}`.normalize('NFKC')
    const m = combined.match(/(?:入数|1箱|1ケース)\s*(\d+)|(\d+)\s*(?:入|パック|P)/i)
    if (m) {
      const n = Number(m[1] || m[2])
      if (Number.isFinite(n) && n > 0 && n <= 200) return n
    }
    if (combined.includes('小コン')) return 30
    if (combined.includes('農業総合研究所') || combined.toUpperCase().includes('NSK')) return 24
    return 20
  }

  async function saveHeader() {
    if (!deliveryDate) {
      toast.error('納品日を入力してください')
      return
    }
    setSavingHeader(true)
    try {
      const res = await fetch(`/api/orders/${orderId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          delivery_date: deliveryDate,
          destination_id: destinationId || null,
          note: note.trim() || null,
        }),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(json.error ?? `保存に失敗 (${res.status})`)
      setSavedHeader({ deliveryDate, destinationId, note })
      toast.success('納品日・納入先・備考を保存しました')
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存に失敗しました')
    } finally {
      setSavingHeader(false)
    }
  }

  function patchItem(id: string, patch: Partial<EditableItemState>) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)))
  }

  async function saveItem(it: EditableItemState) {
    const ppc = ppcFor(it.draftSpec)
    const parsedQ = parseQuantity(it.draftQty, { packsPerCase: ppc })
    const q = parsedQ.type === 'ok' ? parsedQ.total.toNumber() : Math.max(0, Number(it.draftQty) || 0)
    const up = it.draftPrice.trim() === '' ? undefined : Math.max(0, Number(it.draftPrice) || 0)
    patchItem(it.id, { saving: true })
    try {
      const res = await fetch(`/api/order-items/${it.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          quantity: q,
          spec: it.draftSpec.trim() || null,
          container_type: it.draftContainer.trim() || null,
          ...(up !== undefined ? { unit_price: up } : {}),
          version: it.version,
        }),
      })
      const json = (await res.json().catch(() => ({}))) as {
        item?: { version: number; quantity: number }
        error?: string
      }
      if (res.status === 409) throw new Error('他の人が先に変更しました。画面を再読み込みしてください')
      if (!res.ok) throw new Error(json.error ?? `明細の保存に失敗 (${res.status})`)
      patchItem(it.id, {
        quantity: q,
        draftQty: String(q),
        spec: it.draftSpec.trim() || null,
        containerType: it.draftContainer.trim() || null,
        ...(up !== undefined ? { unitPrice: up, draftPrice: String(up) } : {}),
        version: json.item?.version ?? it.version + 1,
        saving: false,
      })
      toast.success(`「${it.productName}」の変更を保存しました`)
      router.refresh()
    } catch (e) {
      patchItem(it.id, { saving: false })
      toast.error(e instanceof Error ? e.message : '保存に失敗しました')
    }
  }

  async function deleteItem(it: EditableItemState) {
    patchItem(it.id, { saving: true })
    try {
      const res = await fetch(`/api/order-items/${it.id}`, { method: 'DELETE' })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(json.error ?? `削除に失敗 (${res.status})`)
      setItems((prev) => prev.filter((x) => x.id !== it.id))
      toast.success('明細を削除しました')
      showResponseWarnings(json)
      router.refresh()
    } catch (e) {
      patchItem(it.id, { saving: false })
      toast.error(e instanceof Error ? e.message : '削除に失敗しました')
    }
  }

  const headerDirty =
    deliveryDate !== savedHeader.deliveryDate ||
    destinationId !== savedHeader.destinationId ||
    note !== savedHeader.note
  const itemDirty = (it: EditableItemState) =>
    it.draftQty !== String(it.quantity) ||
    it.draftSpec !== (it.spec ?? '') ||
    it.draftContainer !== (it.containerType ?? '') ||
    it.draftPrice !== (it.unitPrice != null ? String(it.unitPrice) : '')
  const dirtyItems = items.filter(itemDirty)
  const dirty = headerDirty || dirtyItems.length > 0
  const savingAny = savingHeader || items.some((it) => it.saving)

  // 未保存の変更があるまま離れようとしたら止める（再読み込み・タブを閉じる・画面内のリンク）
  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!a || a.target === '_blank' || e.defaultPrevented) return
      if (!window.confirm('保存していない変更があります。保存せずにこの画面を離れますか？')) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    document.addEventListener('click', onClick, true)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      document.removeEventListener('click', onClick, true)
    }
  }, [dirty])

  async function saveAll() {
    if (headerDirty) await saveHeader()
    for (const it of dirtyItems) await saveItem(it)
  }

  const inputCls =
    'h-10 rounded-lg border border-line-strong bg-bg-card px-2.5 text-sm text-ink focus:border-forest-600 focus:outline-none focus:ring-2 focus:ring-forest-100'

  return (
    <div className="space-y-4">
      {/* 納品日・納入先・備考のインライン編集カード */}
      <Card className="space-y-3">
        <h2 className="font-display text-sm font-black text-ink">
          納品日・納入先・備考
          {headerDirty && <span className="ml-2 text-xs font-bold text-warning">（未保存）</span>}
        </h2>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="space-y-1">
            <span className="block text-xs font-bold text-ink-soft">納品日（出荷日）</span>
            <input
              type="date"
              value={deliveryDate}
              onChange={(e) => setDeliveryDate(e.target.value)}
              className={`${inputCls} w-full font-bold`}
            />
          </label>

          <label className="space-y-1">
            <span className="block text-xs font-bold text-ink-soft">納入先（センター・店舗）</span>
            <select
              value={destinationId}
              onChange={(e) => setDestinationId(e.target.value)}
              className={`${inputCls} w-full font-bold`}
            >
              <option value="">{emptyDestinationLabel}</option>
              {destinations.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1">
            <span className="block text-xs font-bold text-ink-soft">注文備考・伝達事項</span>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="特記事項・内訳メモなど"
              className={`${inputCls} w-full`}
            />
          </label>
        </div>
        <div className="flex justify-end">
          <Button size="md" onClick={saveHeader} isLoading={savingHeader} disabled={!headerDirty} className="whitespace-nowrap">
            <Save className="h-4 w-4" aria-hidden />
            <span>納品日・納入先・備考を保存</span>
          </Button>
        </div>
      </Card>

      {/* 明細のインライン編集テーブル */}
      <Card variant="elevated" className="overflow-hidden p-0">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-line bg-bg-soft px-4 py-2.5">
          <h2 className="font-display text-sm font-black text-ink">明細（数量・規格・容器・単価）</h2>
          <span className="text-xs text-ink-soft">直したら各行の「保存」か、下の「まとめて保存」を押してください</span>
        </div>
        <div className="divide-y divide-line">
          {items.map((it) => {
            const ppc = ppcFor(it.draftSpec)
            const qNum = Number(it.draftQty) || 0
            const boxes = qNum > 0 ? Math.ceil(qNum / ppc) : 0
            return (
              <div key={it.id} className="p-3.5 space-y-2.5 hover:bg-bg-soft/30">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="font-black text-base text-ink">{it.productName}</span>
                    <span className="rounded-md bg-forest-100 px-2 py-0.5 text-xs font-black tabular-nums text-forest-900">
                      {boxes}箱（{qNum.toLocaleString()}
                      {it.unit}・1箱{ppc}入）
                    </span>
                    {itemDirty(it) && <span className="text-xs font-bold text-warning">未保存</span>}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Button
                      size="md"
                      variant={itemDirty(it) ? 'primary' : 'secondary'}
                      onClick={() => saveItem(it)}
                      isLoading={it.saving}
                      disabled={!itemDirty(it)}
                      className="whitespace-nowrap"
                    >
                      <Save className="h-4 w-4" aria-hidden />
                      <span>保存</span>
                    </Button>
                    <button
                      type="button"
                      disabled={it.saving}
                      onClick={() => setDeleteTarget(it)}
                      aria-label={`${it.productName} の明細を削除`}
                      className="inline-flex h-10 items-center gap-1 rounded-lg border border-alert/30 bg-alert/5 px-3 text-xs font-bold text-alert hover:bg-alert hover:text-white transition"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span>削除</span>
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                  <label className="space-y-1">
                    <span className="block text-xs font-bold text-ink-soft">
                      総パック数（{it.unit}）
                    </span>
                    <input
                      type="number"
                      min={0}
                      inputMode="numeric"
                      value={it.draftQty}
                      onChange={(e) => patchItem(it.id, { draftQty: e.target.value })}
                      className={`${inputCls} num w-full font-black`}
                    />
                  </label>

                  <label className="space-y-1">
                    <span className="block text-xs font-bold text-ink-soft">規格</span>
                    <input
                      type="text"
                      value={it.draftSpec}
                      onChange={(e) => patchItem(it.id, { draftSpec: e.target.value })}
                      placeholder="200gUP (入数24) 等"
                      className={`${inputCls} w-full`}
                    />
                  </label>

                  <label className="space-y-1">
                    <span className="block text-xs font-bold text-ink-soft">コンテナ・容器</span>
                    <input
                      type="text"
                      value={it.draftContainer}
                      onChange={(e) => patchItem(it.id, { draftContainer: e.target.value })}
                      placeholder="青コン / 茶コン 等"
                      className={`${inputCls} w-full`}
                    />
                  </label>

                  <label className="space-y-1">
                    <span className="block text-xs font-bold text-ink-soft">単価（円）</span>
                    <input
                      type="number"
                      min={0}
                      inputMode="numeric"
                      value={it.draftPrice}
                      onChange={(e) => patchItem(it.id, { draftPrice: e.target.value })}
                      placeholder="未設定"
                      className={`${inputCls} num w-full`}
                    />
                  </label>
                </div>
              </div>
            )
          })}
        </div>
      </Card>

      {/* 未保存の変更があるときだけ出る、まとめて保存バー */}
      {dirty && (
        <div className="sticky bottom-3 z-20 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-warning bg-warning-bg p-3 shadow-lg">
          <p className="text-sm font-bold text-ink">
            保存していない変更があります（{(headerDirty ? 1 : 0) + dirtyItems.length}か所）
          </p>
          <Button size="md" onClick={saveAll} isLoading={savingAny} className="whitespace-nowrap">
            <Save className="h-4 w-4" aria-hidden />
            まとめて保存
          </Button>
        </div>
      )}

      <ConfirmModal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={async () => {
          const target = deleteTarget
          setDeleteTarget(null)
          if (target) await deleteItem(target)
        }}
        title="この出荷明細を削除しますか？"
        message={deleteTarget ? `「${deleteTarget.productName}（${deleteTarget.quantity}${deleteTarget.unit}）」を削除します。この操作は取り消せません。` : ''}
        confirmLabel="削除する"
      />
    </div>
  )
}
