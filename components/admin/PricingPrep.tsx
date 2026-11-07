'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Wand2, Check, Info, Filter } from 'lucide-react'
import toast from 'react-hot-toast'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/Button'
import { ColorDot } from '@/components/ui/ColorDot'
import { formatJpDateShort } from '@/lib/dates'
import type { PricingFlatItem } from '@/lib/pricing/pending'

type Pending = 'flat' | 'resolve' | { row: string } | null

const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`

/** 単価の状態ラベル（「未」だけだと既に単価がある行も未設定に見えるため、3通りに分ける） */
function priceStatusLabel(it: PricingFlatItem): { text: string; cls: string } {
  if (it.priceStatus === 'provisional') return { text: '暫定', cls: 'bg-warning-bg text-ink' }
  if (it.unitPrice > 0) return { text: '仮の単価・未確定', cls: 'bg-warning-bg text-ink' }
  return { text: '単価未設定', cls: 'bg-alert-bg text-alert' }
}

/**
 * 請求前の単価確認（管理者）。後決め単価をフィルター＋一括、または行ごとに確定する。
 * - 一律で確定: 選択行に同じ単価を当てる。税率は各行の注文時の値を維持する（tax.md: 税率は受注時に固定）
 * - 価格表から確定: 納品日を基準に価格表から解決
 * - 行ごと: 単価・請求数量を入れて「確定」
 * 確定（confirmed）した明細だけが請求書に載る。スマホはカード、PC は表で表示。
 */
export function PricingPrep({ items }: { items: PricingFlatItem[] }) {
  const router = useRouter()

  // ── フィルター ──
  const [fProduct, setFProduct] = useState('')
  const [fCustomer, setFCustomer] = useState('')
  const [fPack, setFPack] = useState('')
  const [fStatus, setFStatus] = useState<'' | 'unpriced' | 'provisional'>('')
  const [fShip, setFShip] = useState<'' | 'shipped' | 'before'>('')
  const [fFrom, setFFrom] = useState('')
  const [fTo, setFTo] = useState('')

  // ── 一括入力 ──
  const [bulkPrice, setBulkPrice] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [pending, setPending] = useState<Pending>(null)
  const busy = pending !== null

  // ── 行ごとの入力（請求数量・単価） ──
  const [billable, setBillable] = useState<Record<string, string>>(() =>
    Object.fromEntries(items.map((it) => [it.id, String(it.billableQty)])),
  )
  const [price, setPrice] = useState<Record<string, string>>(() =>
    Object.fromEntries(items.map((it) => [it.id, it.unitPrice > 0 ? String(it.unitPrice) : ''])),
  )

  const products = useMemo(() => [...new Map(items.map((i) => [i.productId, i.productName])).entries()], [items])
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
        if (fShip === 'shipped' && !it.isShipped) return false
        if (fShip === 'before' && it.isShipped) return false
        if (fFrom && (!it.deliveryDate || it.deliveryDate < fFrom)) return false
        if (fTo && (!it.deliveryDate || it.deliveryDate > fTo)) return false
        return true
      }),
    [items, fProduct, fCustomer, fPack, fStatus, fShip, fFrom, fTo],
  )

  const filteredIds = filtered.map((i) => i.id)
  const selectedInView = filteredIds.filter((id) => selected.has(id))
  const allSelected = filteredIds.length > 0 && selectedInView.length === filteredIds.length
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])

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

  /**
   * 一括：選択明細に一律単価を適用して確定。
   * 税率は行ごとの注文時の値を維持するため、税率ごとに分けて送る（バーで税率を選ばせない）。
   */
  async function applyFlat() {
    const p = Number(bulkPrice)
    if (selectedInView.length === 0) {
      toast.error('対象を選択してください')
      return
    }
    if (bulkPrice.trim() === '' || !Number.isFinite(p) || p < 0) {
      toast.error('一律単価を入れてください')
      return
    }
    const groups = new Map<8 | 10, string[]>()
    for (const id of selectedInView) {
      const rate = byId.get(id)?.taxRate
      if (rate !== 8 && rate !== 10) {
        toast.error('税率が不明な明細が含まれています。行ごとに確認してください')
        return
      }
      groups.set(rate, [...(groups.get(rate) ?? []), id])
    }
    const breakdown = [...groups.entries()].map(([r, ids]) => `${r}%: ${ids.length}件`).join(' / ')
    if (
      !window.confirm(
        `${selectedInView.length}件 × ${yen(p)} を確定します。\n税率は各明細の注文時のまま（${breakdown}）。\nよろしいですか？`,
      )
    )
      return
    setPending('flat')
    let updated = 0
    try {
      for (const [rate, ids] of groups) {
        const res = await fetch('/api/pricing/bulk', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ itemIds: ids, mode: 'flat', unit_price: p, tax_rate: rate, status: 'confirmed' }),
        })
        const json = (await res.json().catch(() => ({}))) as { updated?: number; skipped?: string[]; error?: string }
        if (!res.ok) throw new Error(json.error ?? `確定に失敗しました (${res.status})`)
        updated += json.updated ?? 0
        if (json.skipped?.length) toast.error(`${json.skipped.length}件は保存できませんでした`)
      }
      toast.success(`${updated}件を単価${yen(p)}で確定しました`)
      setSelected(new Set())
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '一括確定に失敗しました')
      if (updated > 0) router.refresh()
    } finally {
      setPending(null)
    }
  }

  /** 一括：選択明細を価格表（基準日＝納品日）から解決して確定。 */
  async function applyResolve() {
    if (selectedInView.length === 0) {
      toast.error('対象を選択してください')
      return
    }
    if (!window.confirm(`選択した${selectedInView.length}件を、価格表の単価（納品日時点）で確定します。よろしいですか？`)) return
    setPending('resolve')
    try {
      const res = await fetch('/api/pricing/bulk', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ itemIds: selectedInView, mode: 'resolve', status: 'confirmed' }),
      })
      const json = (await res.json().catch(() => ({}))) as { updated?: number; skipped?: string[]; error?: string }
      if (!res.ok) throw new Error(json.error ?? `確定に失敗しました (${res.status})`)
      const skipped = json.skipped?.length ?? 0
      if (skipped > 0) toast(`${json.updated}件を確定・${skipped}件は価格表に該当がありません`, { icon: '⚠️' })
      else toast.success(`${json.updated}件を価格表から確定しました`)
      setSelected(new Set())
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '一括確定に失敗しました')
    } finally {
      setPending(null)
    }
  }

  /** 行ごと：単価・請求数量を入れて確定（税率は注文時の値のまま）。 */
  async function confirmRow(it: PricingFlatItem) {
    const p = Number(price[it.id] ?? '')
    if ((price[it.id] ?? '').trim() === '' || !Number.isFinite(p) || p < 0) {
      toast.error('単価を入れてください')
      return
    }
    const bRaw = billable[it.id] ?? ''
    const b = Number(bRaw)
    if (bRaw.trim() === '' || !Number.isFinite(b) || b < 0) {
      toast.error('請求数量を入れてください')
      return
    }
    if (it.taxRate !== 8 && it.taxRate !== 10) {
      toast.error('この明細の税率が不明です')
      return
    }
    // 請求数量を変えていなければ、元の状態（未設定なら出荷数→注文数で決まる）を保つ
    const changed = b !== it.billableQty
    const billableQty = changed || it.billableOverridden ? b : null
    const reason = changed ? (b < it.orderedQty ? '数量減（赤点など）' : '請求数量を変更') : it.billableReason
    setPending({ row: it.id })
    try {
      const res = await fetch(`/api/order-items/${it.id}/pricing`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          unit_price: p,
          tax_rate: it.taxRate,
          billable_qty: billableQty,
          billable_reason: billableQty == null ? null : reason,
          status: 'confirmed',
        }),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error ?? `確定に失敗しました (${res.status})`)
      }
      toast.success(`${it.productName}を${yen(p)}で確定しました`)
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '確定に失敗しました')
    } finally {
      setPending(null)
    }
  }

  const inputCls =
    'h-10 rounded border border-line-strong bg-bg-card px-2 text-sm text-ink focus:outline-none focus:border-trust-500 focus:ring-2 focus:ring-trust-100'

  const rowPending = (id: string) => typeof pending === 'object' && pending !== null && pending.row === id

  /** 行の共通パーツ */
  function qtyInfo(it: PricingFlatItem) {
    return (
      <span className="num tabular-nums">
        注文 {it.orderedQty}
        {it.isShipped ? <> ・ 出荷 {it.shippedQty ?? '—'}</> : null}
      </span>
    )
  }
  function shipBadge(it: PricingFlatItem) {
    return it.isShipped ? null : (
      <span className="shrink-0 whitespace-nowrap rounded-full border border-line-strong bg-bg-soft px-2 py-0.5 text-xs font-medium text-ink-soft">
        出荷前
      </span>
    )
  }
  function isReduced(it: PricingFlatItem) {
    const b = Number(billable[it.id])
    return Number.isFinite(b) && b < it.orderedQty
  }
  function billableInput(it: PricingFlatItem, className?: string) {
    const reduced = isReduced(it)
    return (
      <input
        type="number"
        inputMode="decimal"
        min={0}
        value={billable[it.id] ?? ''}
        onChange={(e) => setBillable((prev) => ({ ...prev, [it.id]: e.target.value }))}
        className={cn(inputCls, 'num w-20 text-right', reduced && 'border-alert bg-alert-bg', className)}
        aria-label={`${it.productName}の請求数量`}
      />
    )
  }
  function priceInput(it: PricingFlatItem, wide = false) {
    return (
      <span className={cn('flex items-center gap-1', wide && 'w-full')}>
        <span className="text-sm text-ink-soft">¥</span>
        <input
          type="number"
          inputMode="decimal"
          min={0}
          value={price[it.id] ?? ''}
          placeholder="単価"
          onChange={(e) => setPrice((prev) => ({ ...prev, [it.id]: e.target.value }))}
          className={cn(inputCls, 'num text-right', wide ? 'w-full min-w-0' : 'w-24')}
          aria-label={`${it.productName}の単価`}
        />
      </span>
    )
  }
  function statusChip(it: PricingFlatItem) {
    const l = priceStatusLabel(it)
    return <span className={cn('whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium', l.cls)}>{l.text}</span>
  }
  function confirmButton(it: PricingFlatItem, className?: string) {
    return (
      <Button
        variant="secondary"
        onClick={() => void confirmRow(it)}
        isLoading={rowPending(it.id)}
        disabled={busy}
        className={cn('whitespace-nowrap', className)}
      >
        {!rowPending(it.id) && <Check className="h-4 w-4" aria-hidden />}
        確定
      </Button>
    )
  }

  return (
    <div className="space-y-4">
      {/* フィルター */}
      <div className="space-y-2 rounded-lg border border-line bg-bg-soft p-3">
        <p className="flex items-center gap-1.5 text-sm font-medium text-ink">
          <Filter className="h-4 w-4 text-earth-700" aria-hidden />
          絞り込み
        </p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <select value={fProduct} onChange={(e) => setFProduct(e.target.value)} className={inputCls} aria-label="品目">
            <option value="">品目（すべて）</option>
            {products.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
          <select value={fCustomer} onChange={(e) => setFCustomer(e.target.value)} className={inputCls} aria-label="取引先">
            <option value="">取引先（すべて）</option>
            {customers.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
          <select value={fPack} onChange={(e) => setFPack(e.target.value)} className={inputCls} aria-label="荷姿">
            <option value="">荷姿（すべて）</option>
            {packLabels.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <select
            value={fStatus}
            onChange={(e) => setFStatus(e.target.value as '' | 'unpriced' | 'provisional')}
            className={inputCls}
            aria-label="単価の状態"
          >
            <option value="">単価の状態（すべて）</option>
            <option value="unpriced">未確定（仮の単価・未設定）</option>
            <option value="provisional">暫定</option>
          </select>
          <select
            value={fShip}
            onChange={(e) => setFShip(e.target.value as '' | 'shipped' | 'before')}
            className={inputCls}
            aria-label="出荷"
          >
            <option value="">出荷済み・出荷前（すべて）</option>
            <option value="shipped">出荷済みのみ</option>
            <option value="before">出荷前のみ</option>
          </select>
          <div className="grid grid-cols-[auto_1fr_auto_1fr] items-center gap-1 text-xs text-ink-soft">
            <span>納品</span>
            <input type="date" value={fFrom} onChange={(e) => setFFrom(e.target.value)} className={cn(inputCls, 'w-full min-w-0')} aria-label="納品日（から）" />
            <span>〜</span>
            <input type="date" value={fTo} onChange={(e) => setFTo(e.target.value)} className={cn(inputCls, 'w-full min-w-0')} aria-label="納品日（まで）" />
          </div>
        </div>
      </div>

      {/* 一括入力バー */}
      <div className="sticky top-0 z-10 space-y-2 rounded-lg border border-earth-200 bg-earth-50 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex min-h-10 items-center gap-2 text-sm font-medium text-ink">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleAll}
              className="h-5 w-5 accent-earth-600"
              aria-label="表示中をすべて選択"
            />
            すべて選択
          </label>
          <span className="text-sm text-ink">
            選択 <span className="num font-bold">{selectedInView.length}</span> / {filtered.length}件
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1">
            <span className="text-sm text-ink-soft">¥</span>
            <input
              type="number"
              inputMode="decimal"
              min={0}
              placeholder="一律単価"
              value={bulkPrice}
              onChange={(e) => setBulkPrice(e.target.value)}
              className={cn(inputCls, 'num w-28')}
              aria-label="一律単価"
            />
          </span>
          <Button onClick={() => void applyFlat()} isLoading={pending === 'flat'} disabled={busy || selectedInView.length === 0}>
            {pending !== 'flat' && <Check className="h-4 w-4" aria-hidden />}
            一律で確定
          </Button>
          <Button
            variant="secondary"
            onClick={() => void applyResolve()}
            isLoading={pending === 'resolve'}
            disabled={busy || selectedInView.length === 0}
          >
            {pending !== 'resolve' && <Wand2 className="h-4 w-4" aria-hidden />}
            価格表から確定
          </Button>
        </div>
        <p className="text-xs text-ink-soft">税率は各明細の注文時のまま変わりません。</p>
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-lg border border-line bg-bg-soft px-4 py-8 text-center text-sm text-ink-soft">
          条件に合う明細はありません。
        </p>
      ) : (
        <>
          {/* スマホ：カード */}
          <ul className="space-y-2 md:hidden">
            {filtered.map((it) => {
              const checked = selected.has(it.id)
              return (
                <li
                  key={it.id}
                  className={cn('rounded-lg border border-line bg-bg-card p-3', checked && 'border-trust-500 bg-trust-50')}
                >
                  <div className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleOne(it.id)}
                      className="mt-1 h-5 w-5 shrink-0 accent-earth-600"
                      aria-label={`${it.customerName} ${it.productName}を選択`}
                    />
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="flex items-center gap-1.5 text-sm text-ink-soft">
                        <ColorDot color={it.customerColor} name={it.customerName} />
                        <span className="truncate" title={it.customerName}>
                          {it.customerName}
                        </span>
                      </p>
                      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-bold text-ink">{it.productName}</span>
                        <span className="text-xs text-ink-soft">{it.packLabel}</span>
                        {shipBadge(it)}
                      </p>
                      <p className="text-xs text-ink-soft">
                        納品 {it.deliveryDate ? formatJpDateShort(it.deliveryDate) : '—'} ・ {qtyInfo(it)} ・ 税率 {it.taxRate}%
                      </p>
                    </div>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <label className="space-y-1 text-xs text-ink-soft">
                      <span className="block">請求数量</span>
                      {billableInput(it, 'w-full')}
                    </label>
                    <div className="space-y-1 text-xs text-ink-soft">
                      <span className="flex items-center gap-1">単価 {statusChip(it)}</span>
                      {priceInput(it, true)}
                    </div>
                  </div>
                  {isReduced(it) && (
                    <p className="mt-1 text-xs font-bold text-alert">注文数（{it.orderedQty}）より少ない数量で請求します</p>
                  )}
                  {confirmButton(it, 'mt-2 w-full')}
                </li>
              )
            })}
          </ul>

          {/* PC：表 */}
          <div className="hidden overflow-x-auto rounded-lg border border-line md:block">
            <table className="w-full text-sm">
              <thead className="bg-bg-soft text-xs text-ink-soft">
                <tr>
                  <th className="px-2 py-2">
                    <input type="checkbox" checked={allSelected} onChange={toggleAll} className="h-4 w-4 accent-earth-600" aria-label="全選択" />
                  </th>
                  <th className="px-2 py-2 text-left font-medium">取引先・品目</th>
                  <th className="px-2 py-2 text-left font-medium">納品日</th>
                  <th className="px-2 py-2 text-right font-medium">注文 / 出荷</th>
                  <th className="px-2 py-2 text-right font-medium">請求数量</th>
                  <th className="px-2 py-2 text-left font-medium">単価</th>
                  <th className="px-2 py-2 text-center font-medium">税率</th>
                  <th className="px-2 py-2" aria-label="操作" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filtered.map((it) => {
                  const checked = selected.has(it.id)
                  return (
                    <tr key={it.id} className={cn(checked && 'bg-trust-50')}>
                      <td className="px-2 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleOne(it.id)}
                          className="h-4 w-4 accent-earth-600"
                          aria-label={`${it.customerName} ${it.productName}を選択`}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <span className="flex items-center gap-1.5 text-xs text-ink-soft">
                          <ColorDot color={it.customerColor} name={it.customerName} />
                          {it.customerName}
                        </span>
                        <span className="flex flex-wrap items-center gap-x-2">
                          <span className="font-medium text-ink">{it.productName}</span>
                          <span className="text-xs text-ink-soft">{it.packLabel}</span>
                        </span>
                      </td>
                      <td className="num whitespace-nowrap px-2 py-2 text-ink-soft">
                        <span className="flex flex-col items-start gap-1">
                          {it.deliveryDate ? formatJpDateShort(it.deliveryDate) : '—'}
                          {shipBadge(it)}
                        </span>
                      </td>
                      <td className="num whitespace-nowrap px-2 py-2 text-right text-ink-soft">
                        {it.orderedQty} / {it.isShipped ? (it.shippedQty ?? '—') : '出荷前'}
                      </td>
                      <td className="px-2 py-2 text-right">
                        {billableInput(it)}
                        {isReduced(it) && <p className="mt-0.5 text-xs font-bold text-alert">注文数より少ない</p>}
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex flex-col items-start gap-1">
                          {priceInput(it)}
                          {statusChip(it)}
                        </div>
                      </td>
                      <td className="num px-2 py-2 text-center text-ink-soft">{it.taxRate}%</td>
                      <td className="px-2 py-2 text-right">{confirmButton(it)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <p className="flex items-start gap-1.5 text-xs text-ink-soft">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        絞り込み → 選択 → 一律単価か価格表で一括確定、または行ごとに単価・請求数量を入れて「確定」。赤枠は注文数より少ない請求数量です。確定した明細だけが請求書に載ります。
      </p>
    </div>
  )
}
