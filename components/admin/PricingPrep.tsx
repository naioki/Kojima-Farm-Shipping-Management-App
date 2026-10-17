'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Wand2, Check, AlertTriangle, Filter } from 'lucide-react'
import toast from 'react-hot-toast'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/Button'
import { ColorDot } from '@/components/ui/ColorDot'
import type { PricingFlatItem } from '@/lib/pricing/pending'

/**
 * 請求準備：価格確定（管理者）。後決め単価をフィルター＋一括でまとめて確定する。
 * 品目・取引先・日付範囲・荷姿・状態で横断的に絞り込み → 全選択 → 一律単価 or 価格表から一括確定。
 * 個別の請求数量（赤点＝数量減）は行ごとに編集できる。確定(confirmed)のみ請求に入る。
 */
export function PricingPrep({ items }: { items: PricingFlatItem[] }) {
  const router = useRouter()

  // ── フィルター ──
  const [fProduct, setFProduct] = useState('')
  const [fCustomer, setFCustomer] = useState('')
  const [fPack, setFPack] = useState('')
  const [fStatus, setFStatus] = useState<'' | 'unpriced' | 'provisional'>('')
  const [fFrom, setFFrom] = useState('')
  const [fTo, setFTo] = useState('')

  // ── 一括入力 ──
  const [bulkPrice, setBulkPrice] = useState('')
  const [bulkTax, setBulkTax] = useState<'8' | '10'>('8')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  // ── 行ごとの請求数量（赤点） ──
  const [billable, setBillable] = useState<Record<string, string>>(() =>
    Object.fromEntries(items.map((it) => [it.id, String(it.billableQty)])),
  )

  const products = useMemo(
    () => [...new Map(items.map((i) => [i.productId, i.productName])).entries()],
    [items],
  )
  const customers = useMemo(
    () => [...new Map(items.map((i) => [i.customerId ?? '', i.customerName])).entries()],
    [items],
  )
  const packLabels = useMemo(() => [...new Set(items.map((i) => i.packLabel))], [items])

  const filtered = useMemo(
    () =>
      items.filter((it) => {
        if (fProduct && it.productId !== fProduct) return false
        if (fCustomer && (it.customerId ?? '') !== fCustomer) return false
        if (fPack && it.packLabel !== fPack) return false
        if (fStatus && it.priceStatus !== fStatus) return false
        if (fFrom && (!it.deliveryDate || it.deliveryDate < fFrom)) return false
        if (fTo && (!it.deliveryDate || it.deliveryDate > fTo)) return false
        return true
      }),
    [items, fProduct, fCustomer, fPack, fStatus, fFrom, fTo],
  )

  const filteredIds = filtered.map((i) => i.id)
  const selectedInView = filteredIds.filter((id) => selected.has(id))
  const allSelected = filteredIds.length > 0 && selectedInView.length === filteredIds.length

  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allSelected) filteredIds.forEach((id) => next.delete(id))
      else filteredIds.forEach((id) => next.add(id))
      return next
    })
  }
  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  /** 一括：選択明細に一律単価を適用して確定。 */
  async function applyFlat() {
    const price = parseFloat(bulkPrice)
    if (selectedInView.length === 0) {
      toast.error('対象を選択してください')
      return
    }
    if (!(price >= 0)) {
      toast.error('単価を入れてください')
      return
    }
    setBusy(true)
    try {
      const res = await fetch('/api/pricing/bulk', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ itemIds: selectedInView, mode: 'flat', unit_price: price, tax_rate: Number(bulkTax), status: 'confirmed' }),
      })
      const json = (await res.json()) as { updated?: number; error?: string }
      if (!res.ok) throw new Error(json.error ?? `失敗 (${res.status})`)
      toast.success(`${json.updated}件に単価¥${price.toLocaleString()}を適用しました`)
      setSelected(new Set())
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '一括適用に失敗しました')
    } finally {
      setBusy(false)
    }
  }

  /** 一括：選択明細を価格表（基準日＝納品日）から解決して確定。 */
  async function applyResolve() {
    if (selectedInView.length === 0) {
      toast.error('対象を選択してください')
      return
    }
    setBusy(true)
    try {
      const res = await fetch('/api/pricing/bulk', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ itemIds: selectedInView, mode: 'resolve', status: 'confirmed' }),
      })
      const json = (await res.json()) as { updated?: number; skipped?: string[]; error?: string }
      if (!res.ok) throw new Error(json.error ?? `失敗 (${res.status})`)
      const skipped = json.skipped?.length ?? 0
      if (skipped > 0) toast(`${json.updated}件確定・${skipped}件は価格表に該当なし`, { icon: '⚠️' })
      else toast.success(`${json.updated}件を価格表から確定しました`)
      setSelected(new Set())
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '一括確定に失敗しました')
    } finally {
      setBusy(false)
    }
  }

  /** 個別：請求数量（赤点で減らす）だけ先に保存しておく（単価は一括で当てる運用）。 */
  async function saveBillable(it: PricingFlatItem) {
    const b = parseFloat(billable[it.id] ?? '')
    if (!(b >= 0)) {
      toast.error('請求数量を入れてください')
      return
    }
    setBusy(true)
    try {
      // 単価は現状維持・状態は provisional のまま billable だけ更新（確定は一括で）
      const res = await fetch(`/api/order-items/${it.id}/pricing`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          unit_price: it.unitPrice,
          tax_rate: it.taxRate,
          billable_qty: b,
          billable_reason: '赤点（数量減）',
          status: it.priceStatus === 'unpriced' ? 'provisional' : it.priceStatus,
        }),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error ?? `失敗 (${res.status})`)
      }
      toast.success('請求数量を保存しました')
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存に失敗しました')
    } finally {
      setBusy(false)
    }
  }

  const inputCls =
    'h-9 rounded border border-line-strong bg-bg-card px-2 text-sm text-ink focus:outline-none focus:border-trust-500 focus:ring-2 focus:ring-trust-100'

  return (
    <div className="space-y-4">
      {/* フィルター */}
      <div className="space-y-2 rounded-lg border border-line bg-bg-soft p-3">
        <p className="flex items-center gap-1.5 text-sm font-medium text-ink">
          <Filter className="h-4 w-4 text-earth-600" aria-hidden />
          絞り込み
        </p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <select value={fProduct} onChange={(e) => setFProduct(e.target.value)} className={inputCls} aria-label="品目">
            <option value="">品目（すべて）</option>
            {products.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
          <select value={fCustomer} onChange={(e) => setFCustomer(e.target.value)} className={inputCls} aria-label="取引先">
            <option value="">取引先（すべて）</option>
            {customers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
          <select value={fPack} onChange={(e) => setFPack(e.target.value)} className={inputCls} aria-label="荷姿">
            <option value="">荷姿（すべて）</option>
            {packLabels.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <select value={fStatus} onChange={(e) => setFStatus(e.target.value as '' | 'unpriced' | 'provisional')} className={inputCls} aria-label="状態">
            <option value="">状態（すべて）</option>
            <option value="unpriced">未設定</option>
            <option value="provisional">暫定</option>
          </select>
          <label className="flex items-center gap-1 text-xs text-ink-soft">
            <span className="shrink-0">納品</span>
            <input type="date" value={fFrom} onChange={(e) => setFFrom(e.target.value)} className={cn(inputCls, 'w-full')} aria-label="開始日" />
          </label>
          <label className="flex items-center gap-1 text-xs text-ink-soft">
            <span className="shrink-0">〜</span>
            <input type="date" value={fTo} onChange={(e) => setFTo(e.target.value)} className={cn(inputCls, 'w-full')} aria-label="終了日" />
          </label>
        </div>
      </div>

      {/* 一括入力バー */}
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-earth-200 bg-earth-50 p-3">
        <span className="text-sm font-medium text-ink">
          選択 <span className="num font-bold text-earth-700">{selectedInView.length}</span> / {filtered.length}件
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <input
            type="number" inputMode="decimal" min={0}
            placeholder="一律単価"
            value={bulkPrice}
            onChange={(e) => setBulkPrice(e.target.value)}
            className={cn(inputCls, 'num w-28')}
          />
          <select value={bulkTax} onChange={(e) => setBulkTax(e.target.value as '8' | '10')} className={cn(inputCls, 'w-20')} aria-label="税率">
            <option value="8">8%</option>
            <option value="10">10%</option>
          </select>
          <Button size="sm" onClick={applyFlat} isLoading={busy} disabled={selectedInView.length === 0}>
            <Check className="h-3.5 w-3.5" aria-hidden />
            一律で確定
          </Button>
          <Button size="sm" variant="secondary" onClick={applyResolve} isLoading={busy} disabled={selectedInView.length === 0}>
            <Wand2 className="h-3.5 w-3.5" aria-hidden />
            価格表から確定
          </Button>
        </div>
      </div>

      {/* テーブル */}
      {filtered.length === 0 ? (
        <p className="rounded-lg border border-line bg-bg-soft px-4 py-8 text-center text-sm text-ink-soft">
          条件に合う明細はありません。
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-sm">
            <thead className="bg-bg-soft text-xs text-ink-soft">
              <tr>
                <th className="px-2 py-2">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} className="h-4 w-4 accent-earth-600" aria-label="全選択" />
                </th>
                <th className="px-2 py-2 text-left font-medium">取引先</th>
                <th className="px-2 py-2 text-left font-medium">品目</th>
                <th className="px-2 py-2 text-left font-medium">荷姿</th>
                <th className="px-2 py-2 text-left font-medium">納品日</th>
                <th className="px-2 py-2 text-right font-medium">出荷</th>
                <th className="px-2 py-2 text-right font-medium">請求数量</th>
                <th className="px-2 py-2 text-right font-medium">単価</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {filtered.map((it) => {
                const checked = selected.has(it.id)
                const reduced = it.shippedQty != null && Number(billable[it.id]) < it.orderedQty
                return (
                  <tr key={it.id} className={cn(checked && 'bg-trust-50/40')}>
                    <td className="px-2 py-2 text-center">
                      <input type="checkbox" checked={checked} onChange={() => toggleOne(it.id)} className="h-4 w-4 accent-earth-600" aria-label="選択" />
                    </td>
                    <td className="px-2 py-2">
                      <span className="flex items-center gap-1.5">
                        <ColorDot color={it.customerColor} name={it.customerName} />
                        <span className="text-ink">{it.customerName}</span>
                      </span>
                    </td>
                    <td className="px-2 py-2 text-ink">{it.productName}</td>
                    <td className="px-2 py-2 text-ink-soft">{it.packLabel}</td>
                    <td className="num px-2 py-2 text-ink-soft">{it.deliveryDate ?? '—'}</td>
                    <td className="num px-2 py-2 text-right text-ink-soft">{it.shippedQty ?? '—'}</td>
                    <td className="px-2 py-2 text-right">
                      <span className="flex items-center justify-end gap-1">
                        <input
                          type="number" inputMode="decimal" min={0}
                          value={billable[it.id] ?? ''}
                          onChange={(e) => setBillable((p) => ({ ...p, [it.id]: e.target.value }))}
                          className={cn(inputCls, 'num w-20 text-right', reduced && 'border-alert/50 bg-alert-bg/30')}
                          aria-label="請求数量"
                        />
                        <button type="button" onClick={() => saveBillable(it)} title="請求数量を保存" className="text-xs text-trust-600 hover:underline">
                          保存
                        </button>
                      </span>
                    </td>
                    <td className="num px-2 py-2 text-right">
                      {it.priceStatus === 'unpriced' ? (
                        <span className="text-alert">未</span>
                      ) : (
                        <span className="text-ink">¥{it.unitPrice.toLocaleString()}{it.priceStatus === 'provisional' && <span className="ml-1 text-[10px] text-warning">暫定</span>}</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="flex items-center gap-1.5 text-xs text-ink-faint">
        <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
        絞り込み → 全選択 → 一律単価 or 価格表から一括確定。赤点（品質減）は請求数量を下げて保存。確定のみ請求に入ります。
      </p>
    </div>
  )
}
