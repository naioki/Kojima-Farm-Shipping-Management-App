'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { AlertTriangle, Plus, ArrowLeftRight, CheckCircle2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { formatJpDate, jstTodayStr, shiftDateStr } from '@/lib/dates'
import { groupByCategory } from '@/lib/products/group'
import {
  findBestMatchingCustomer,
  findBestMatchingDestination,
} from '@/lib/orders/natural-parser'

interface ParsedOrder {
  customer_name: string | null
  destination_name?: string | null
  delivery_date: string | null
  note?: string | null
  items: {
    raw_name: string
    product_name: string | null
    quantity: string
    unit: string | null
    confidence: number
    spec?: string | null
    packs_per_case?: number | null
    cases?: number | null
    remainder_packs?: number | null
    container_type?: string | null
    has_card?: boolean | null
  }[]
}

interface Destination {
  id: string
  customer_id: string
  code: string | null
  full_name: string
  aliases: string[]
}

interface Props {
  order: ParsedOrder
  index: number
  totalOrders?: number
  customers: { id: string; name: string }[]
  products: { id: string; name: string; category?: string | null }[]
  /** 取引先配下の納入先（届け先）。選択中の取引先のものだけ絞って表示する。 */
  destinations?: Destination[]
  /** 新規取引先を登録したとき親へ通知（同じ画面の他の注文でも選べるようにする）。 */
  onCustomerAdded?: (customer: { id: string; name: string }) => void
  /** 新規納入先を登録したとき親へ通知（同じ画面の他の注文でも選べるようにする）。 */
  onDestinationAdded?: (destination: Destination) => void
  /** 保存完了時のコールバック（モーダル内や複数注文時用） */
  onSaved?: (orderId: string, deliveryDate: string) => void
}

/** OCRが読んだ文字列を納入先（code/full_name/aliases）に名寄せ。見つからなければ ''。 */
function bestMatchDestinationId(text: string | null | undefined, dests: Destination[], customerId?: string): string {
  const hit = findBestMatchingDestination(text, dests, customerId || null)
  return hit?.id ?? ''
}

/** 全角→半角・記号正規化（parse-quantity.ts と同方針）。"１５ｃ２"→"15c2" */
function normalizeQty(raw: string): string {
  return raw
    .replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0))
    .replace(/[ｃＣ]/g, 'c')
    .replace(/[ｘＸ]/g, 'x')
    .replace(/\s+/g, '')
}

function isCaseNotation(raw: string): boolean {
  return /^(\d+)c(\d*)$/i.test(normalizeQty(raw))
}

/** c記法 "15c2" → {cases:15, loose:2}、"15c" → {cases:15, loose:0}。c記法でなければ null。 */
function caseParts(raw: string): { cases: number; loose: number } | null {
  const m = normalizeQty(raw).match(/^(\d+)c(\d*)$/i)
  if (!m) return null
  return { cases: Number(m[1]), loose: m[2] === '' ? 0 : Number(m[2]) }
}

/** "100+0" → 100, "x58" → 58, "23.0 cs" → 23, "10" → 10。解釈不能・c記法は NaN。 */
function parseOcrQty(raw: string): number {
  const s = normalizeQty(raw)
  if (isCaseNotation(s)) return NaN
  const x = s.match(/x(\d+)/i)
  if (x) return Number(x[1])
  const n = s.match(/^(\d+(?:\.\d+)?)/)
  return n ? Number(n[1]) : NaN
}

function bestMatchId(name: string | null, products: { id: string; name: string }[]): string {
  if (!name) return products[0]?.id ?? ''
  const lower = name.toLowerCase()
  const exact = products.find((p) => p.name.toLowerCase() === lower)
  if (exact) return exact.id
  const chingen = products.find(
    (p) =>
      (lower.includes('チンゲン') && p.name.includes('青梗菜')) ||
      (lower.includes('青梗菜') && p.name.includes('チンゲン')),
  )
  if (chingen) return chingen.id
  const partial = products.find(
    (p) => p.name.toLowerCase().includes(lower) || lower.includes(p.name.toLowerCase()),
  )
  return partial?.id ?? products[0]?.id ?? ''
}

function bestMatchCustomerId(name: string | null, customers: { id: string; name: string }[]): string {
  const hit = findBestMatchingCustomer(name, customers)
  return hit?.id ?? ''
}

/**
 * OCR読み取り結果（1注文分）を受注として保存するフォーム。
 * 取引先・納品日・商品を確認してから POST /api/orders に送信する。
 * POST /api/orders は status='approved' で即時登録して収穫タスクを生成するため、
 * 保存後はその場で「✓ 登録完了」状態にして複数注文の連続保存を妨げない。
 */
export function OcrSaveSection({
  order,
  index,
  totalOrders = 1,
  customers,
  products,
  destinations = [],
  onCustomerAdded,
  onDestinationAdded,
  onSaved,
}: Props) {
  const router = useRouter()

  const defaultTomorrow = shiftDateStr(jstTodayStr(), 1)
  const [customerId, setCustomerId] = useState(() => bestMatchCustomerId(order.customer_name, customers))
  const [deliveryDate, setDeliveryDate] = useState(order.delivery_date || defaultTomorrow)
  const [destinationId, setDestinationId] = useState('')
  const [destHintOverride, setDestHintOverride] = useState<string | null>(null)
  const [savedOrderId, setSavedOrderId] = useState<string | null>(null)

  const customerDestinations = destinations.filter((d) => d.customer_id === customerId)

  useEffect(() => {
    const ds = destinations.filter((d) => d.customer_id === customerId)
    const hint = destHintOverride ?? (order.destination_name || order.customer_name)
    setDestinationId(ds.length > 0 ? bestMatchDestinationId(hint, ds, customerId) : '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId, destHintOverride, destinations.length])

  function swapCustomerDestination() {
    if (!order.destination_name) return
    const swapped = bestMatchCustomerId(order.destination_name, customers)
    if (!swapped) {
      toast.error('納入先名に一致する取引先が見つかりませんでした（先に取引先を新規登録してください）')
      return
    }
    setDestHintOverride(order.customer_name)
    setCustomerId(swapped)
    toast.success('取引先と納入先を入れ替えました。内容を確認してください')
  }

  // 同一キー（取引先×納入先×納品日）の既存注文の商品別数量。「前回X→今回Y」差分表示用。
  const [prevQty, setPrevQty] = useState<Record<string, number>>({})
  useEffect(() => {
    if (!customerId || !deliveryDate) {
      setPrevQty({})
      return
    }
    const params = new URLSearchParams({ customer_id: customerId, delivery_date: deliveryDate })
    if (destinationId) params.set('destination_id', destinationId)
    let cancelled = false
    fetch(`/api/orders/existing?${params.toString()}`)
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((j: { items?: { product_id: string; quantity: number }[] }) => {
        if (cancelled) return
        const m: Record<string, number> = {}
        for (const it of j.items ?? []) m[it.product_id] = it.quantity
        setPrevQty(m)
      })
      .catch(() => {
        if (!cancelled) setPrevQty({})
      })
    return () => {
      cancelled = true
    }
  }, [customerId, destinationId, deliveryDate])

  const [rows, setRows] = useState(() =>
    order.items.map((it) => {
      const caseNotation = isCaseNotation(it.quantity)
      const knownPacks = it.packs_per_case && it.packs_per_case > 0 ? it.packs_per_case : null
      let resolvedQtyStr = ''
      if (caseNotation) {
        const parts = caseParts(it.quantity)
        if (parts && knownPacks) {
          resolvedQtyStr = String(parts.cases * knownPacks + parts.loose)
        }
      } else {
        const parsedN = parseOcrQty(it.quantity)
        resolvedQtyStr = !isNaN(parsedN) && parsedN > 0 ? String(parsedN) : ''
      }
      return {
        raw_name: it.raw_name,
        product_id: bestMatchId(it.product_name ?? it.raw_name, products),
        product_name: it.product_name ?? it.raw_name,
        quantity: resolvedQtyStr,
        qtyRaw: it.quantity,
        unit: it.unit || '袋',
        confidence: it.confidence,
        needsTotal: caseNotation && !resolvedQtyStr,
        packsPerCase: knownPacks ? String(knownPacks) : '20',
        spec: it.spec ?? null,
        containerType: it.container_type ?? null,
        hasCard: it.has_card ?? null,
      }
    }),
  )
  const [saving, setSaving] = useState(false)
  const [dupConfirmOpen, setDupConfirmOpen] = useState(false)
  const [dupExisting, setDupExisting] = useState<
    { id: string; created_at: string; updated_at: string; item_count: number }[]
  >([])

  const [addingCustomer, setAddingCustomer] = useState(false)
  const [newCustomerName, setNewCustomerName] = useState(order.customer_name ?? '')
  const [creatingCustomer, setCreatingCustomer] = useState(false)

  async function createCustomer() {
    const name = newCustomerName.trim()
    if (!name) {
      toast.error('取引先名を入力してください')
      return
    }
    setCreatingCustomer(true)
    try {
      const res = await fetch('/api/customers/quick', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name,
          destination_name: order.destination_name?.trim() || undefined,
        }),
      })
      const json = (await res.json().catch(() => ({}))) as {
        id?: string
        name?: string
        existed?: boolean
        destination?: { id: string; label: string } | null
        error?: string
      }
      if (!res.ok || !json.id) throw new Error(json.error ?? `登録失敗 (${res.status})`)
      const created = { id: json.id, name: json.name ?? name }
      onCustomerAdded?.(created)
      setCustomerId(created.id)
      if (json.destination?.id) {
        const dest: Destination = {
          id: json.destination.id,
          customer_id: created.id,
          code: json.destination.label,
          full_name: json.destination.label,
          aliases: [],
        }
        onDestinationAdded?.(dest)
        setDestinationId(dest.id)
      }
      setAddingCustomer(false)
      toast.success(
        json.existed
          ? `同名の取引先「${created.name}」を選択しました`
          : `取引先「${created.name}」を登録しました`,
      )
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '取引先の登録に失敗しました')
    } finally {
      setCreatingCustomer(false)
    }
  }

  const [addingDest, setAddingDest] = useState(false)
  const [newDestCode, setNewDestCode] = useState('')
  const [newDestFullName, setNewDestFullName] = useState(order.destination_name ?? '')
  const [creatingDest, setCreatingDest] = useState(false)

  async function createDestination() {
    if (!customerId) {
      toast.error('先に取引先を選んでください')
      return
    }
    const full = newDestFullName.trim()
    if (!full) {
      toast.error('正式名を入力してください')
      return
    }
    setCreatingDest(true)
    try {
      const res = await fetch('/api/destinations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          customer_id: customerId,
          code: newDestCode.trim() || full,
          full_name: full,
          aliases: [],
        }),
      })
      const json = (await res.json().catch(() => ({}))) as {
        destination?: { id: string; code: string | null; full_name: string; aliases: string[] }
        error?: string
        existing?: { id: string; code: string | null; full_name: string; aliases: string[] }
      }
      if (res.status === 409 && json.error === 'duplicate' && json.existing) {
        const dup: Destination = { ...json.existing, customer_id: customerId }
        onDestinationAdded?.(dup)
        setDestinationId(dup.id)
        setAddingDest(false)
        setNewDestCode('')
        setNewDestFullName('')
        toast(`同名の納入先「${dup.code?.trim() || dup.full_name}」が既にあります。既存を選択しました`, {
          icon: 'ℹ️',
        })
        return
      }
      if (!res.ok || !json.destination) throw new Error(json.error ?? `登録失敗 (${res.status})`)
      const dest: Destination = { ...json.destination, customer_id: customerId }
      onDestinationAdded?.(dest)
      setDestinationId(dest.id)
      setAddingDest(false)
      setNewDestCode('')
      setNewDestFullName('')
      toast.success(`納入先「${dest.code?.trim() || dest.full_name}」を登録しました`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '納入先の登録に失敗しました')
    } finally {
      setCreatingDest(false)
    }
  }

  function updateRow(i: number, field: string, value: string) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)))
  }

  function updatePack(i: number, value: string) {
    setRows((prev) =>
      prev.map((r, idx) => {
        if (idx !== i) return r
        const next = { ...r, packsPerCase: value }
        const parts = caseParts(r.qtyRaw)
        const pc = Number(value)
        if (parts && value.trim() !== '' && pc > 0) {
          next.quantity = String(parts.cases * pc + parts.loose)
        }
        return next
      }),
    )
  }

  async function handleSave(
    mode:
      | 'create'
      | 'add_anyway'
      | { mergeOrderId: string }
      | { replaceOrderId: string; expectedUpdatedAt: string } = 'create',
  ) {
    if (!customerId) {
      toast.error('取引先を選択してください')
      return
    }
    if (!deliveryDate) {
      toast.error('納品日を入力してください')
      return
    }
    const invalid = rows.filter((r) => !r.product_id || isNaN(Number(r.quantity)) || Number(r.quantity) <= 0)
    if (invalid.length > 0) {
      toast.error('商品と数量をすべて入力してください')
      return
    }

    setSaving(true)
    try {
      const body: Record<string, unknown> = {
        customer_id: customerId,
        destination_id: destinationId || undefined,
        delivery_date: deliveryDate,
        note: order.note || undefined,
        items: rows.map((r) => ({
          product_id: r.product_id,
          product_name: r.product_name,
          quantity: Number(r.quantity),
          unit: r.unit,
          unit_price: 0,
          tax_rate: 8,
          packs_per_case:
            r.packsPerCase.trim() !== '' && Number(r.packsPerCase) > 0
              ? Number(r.packsPerCase)
              : undefined,
          spec: r.spec ?? undefined,
          container_type: r.containerType ?? undefined,
          has_card: r.hasCard ?? undefined,
        })),
      }
      if (mode === 'add_anyway') {
        body.confirm_duplicate = true
      } else if (typeof mode === 'object' && 'mergeOrderId' in mode) {
        body.merge_order_id = mode.mergeOrderId
      } else if (typeof mode === 'object' && 'replaceOrderId' in mode) {
        body.replace_order_id = mode.replaceOrderId
        body.expected_updated_at = mode.expectedUpdatedAt
      }

      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = (await res.json().catch(() => ({}))) as {
        error?: string
        duplicate?: boolean
        conflict?: boolean
        existing?: { id: string; created_at: string; updated_at: string; item_count: number }[]
        orderId?: string
        replaced?: boolean
        merged?: boolean
        warnings?: Record<string, { type: 'high' | 'low'; ratio: number; histMax: number; histMin: number }>
      }
      if (res.status === 409 && json.duplicate) {
        setDupExisting(json.existing ?? [])
        setDupConfirmOpen(true)
        return
      }
      if (res.status === 409 && json.conflict) {
        toast.error(json.error ?? '他の人がこの注文を変更しました。画面を更新してください')
        router.refresh()
        return
      }
      if (!res.ok) throw new Error(json.error ?? `保存失敗 (${res.status})`)

      const warnEntries = Object.entries(json.warnings ?? {})
      if (warnEntries.length > 0) {
        const names = warnEntries
          .map(([pid]) => rows.find((r) => r.product_id === pid)?.product_name ?? pid)
          .join('・')
        toast(`数量が普段と大きく違います（${names}）。念のため確認してください`, {
          icon: '⚠️',
          duration: 8000,
        })
      }

      toast.success(
        json.merged
          ? '既存注文に数量を合算しました（出荷ボード・収穫タスクに反映済み）'
          : json.replaced
          ? '既存注文を上書き更新しました（出荷ボード・収穫タスクに反映済み）'
          : '注文を承認済みで登録しました（出荷ボード・収穫タスクに反映済み）',
      )

      setSavedOrderId(json.orderId ?? 'saved')
      router.refresh()
      onSaved?.(json.orderId ?? '', deliveryDate)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const hasPrev = Object.keys(prevQty).length > 0

  const inputCls =
    'h-9 w-full rounded border border-line-strong bg-bg-card px-2 text-sm text-ink focus:outline-none focus:border-trust-500 focus:ring-2 focus:ring-trust-100'
  const selectCls =
    'h-9 w-full rounded border border-line-strong bg-bg-card px-2 text-sm text-ink focus:outline-none focus:border-trust-500 focus:ring-2 focus:ring-trust-100'

  if (savedOrderId) {
    return (
      <div className="rounded-lg border-2 border-emerald-400 bg-emerald-50 p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-bold text-emerald-950">
          <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
          <span>
            注文 {index + 1}（{customers.find((c) => c.id === customerId)?.name ?? ''} / {formatJpDate(deliveryDate)}）を登録しました！
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/field/shipments?date=${deliveryDate}`}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700"
          >
            出荷ボードを見る →
          </Link>
          {totalOrders > 1 && (
            <button
              type="button"
              onClick={() => setSavedOrderId(null)}
              className="text-xs text-emerald-800 underline"
            >
              再編集
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3 rounded-lg border border-earth-200 bg-earth-50 p-4">
      <p className="text-xs font-semibold text-earth-700">注文 {index + 1} を保存</p>

      {rows.some((r) => r.product_id && prevQty[r.product_id] != null && Number(r.quantity) !== prevQty[r.product_id]) && (
        <div className="flex items-start gap-2 rounded border border-alert/40 bg-alert-bg/40 px-3 py-2 text-xs text-alert">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            この取引先・納入先・納品日には<strong>既存の注文があります</strong>（下に「前回→今回」を表示）。
            保存時に「既存に合算」「既存を上書き」「別便追加」を選択できます。
          </span>
        </div>
      )}

      {rows.some((r) => r.needsTotal && !r.quantity) && (
        <div className="flex items-start gap-2 rounded border border-alert/40 bg-alert-bg/40 px-3 py-2 text-xs text-alert">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            ケース表記（例「15c2」）の項目があります。<strong>総数</strong>を直接入力するか、右の<strong>入り数</strong>を入力してください。
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-ink-soft">
            取引先 <span className="text-alert">*</span>
            {order.customer_name && (
              <span className="ml-1 text-ink-faint">（AI読取: {order.customer_name}）</span>
            )}
          </label>
          {!addingCustomer ? (
            <>
              <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className={selectCls}>
                <option value="">選択してください</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              {!customerId && (
                <button
                  type="button"
                  onClick={() => {
                    setNewCustomerName(order.customer_name ?? '')
                    setAddingCustomer(true)
                  }}
                  className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-trust-600 hover:underline"
                >
                  <Plus className="h-3 w-3" aria-hidden />
                  この取引先を新規登録
                </button>
              )}
            </>
          ) : (
            <div className="flex gap-1">
              <input
                type="text"
                value={newCustomerName}
                onChange={(e) => setNewCustomerName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void createCustomer()
                  }
                }}
                placeholder="取引先名（店名）"
                autoFocus
                className={inputCls}
              />
              <Button variant="primary" size="sm" onClick={createCustomer} isLoading={creatingCustomer} disabled={creatingCustomer}>
                登録
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setAddingCustomer(false)} disabled={creatingCustomer}>
                取消
              </Button>
            </div>
          )}
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

      {customerId && (
        <div>
          <div className="mb-1 flex items-center justify-between gap-2">
            <label className="block text-xs font-medium text-ink-soft">
              納入先（届け先）
              <span className="ml-1 text-ink-faint">
                {customers.find((c) => c.id === customerId)?.name} ＞ …
                {order.destination_name && <span className="ml-1">（AI読取: {order.destination_name}）</span>}
              </span>
            </label>
            {order.destination_name && (
              <button
                type="button"
                onClick={swapCustomerDestination}
                title="AIが取引先と納入先を逆に読んだ場合に、入れ替えて選び直します"
                className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-trust-600 hover:underline"
              >
                <ArrowLeftRight className="h-3 w-3" aria-hidden />
                取引先と入れ替え
              </button>
            )}
          </div>
          {!addingDest ? (
            <div className="flex items-center gap-2">
              {customerDestinations.length > 0 && (
                <select value={destinationId} onChange={(e) => setDestinationId(e.target.value)} className={selectCls}>
                  <option value="">（指定なし）</option>
                  {customerDestinations.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.code?.trim() || d.full_name}
                      {d.code?.trim() && d.full_name && d.code.trim() !== d.full_name ? `（${d.full_name}）` : ''}
                    </option>
                  ))}
                </select>
              )}
              <button
                type="button"
                onClick={() => {
                  setNewDestCode('')
                  setNewDestFullName(order.destination_name ?? '')
                  setAddingDest(true)
                }}
                className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-trust-600 hover:underline"
              >
                <Plus className="h-3 w-3" aria-hidden />
                納入先を登録
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-1">
              <input
                type="text"
                value={newDestCode}
                onChange={(e) => setNewDestCode(e.target.value)}
                placeholder="略称（例: マルタ）"
                className={cn(inputCls, 'w-32')}
              />
              <input
                type="text"
                value={newDestFullName}
                onChange={(e) => setNewDestFullName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void createDestination()
                  }
                }}
                placeholder="正式名（必須）"
                autoFocus
                className={cn(inputCls, 'min-w-[10rem] flex-1')}
              />
              <Button variant="primary" size="sm" onClick={createDestination} isLoading={creatingDest} disabled={creatingDest}>
                登録
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setAddingDest(false)} disabled={creatingDest}>
                取消
              </Button>
            </div>
          )}
        </div>
      )}

      <div className="overflow-x-auto rounded border border-line">
        <table className="w-full text-sm">
          <thead className="bg-bg-soft text-xs text-ink-soft">
            <tr>
              <th className="px-2 py-2 text-left font-medium">読取り原文</th>
              <th className="px-2 py-2 text-left font-medium">商品</th>
              <th className="w-24 px-2 py-2 text-right font-medium">総数</th>
              <th className="w-16 px-2 py-2 text-left font-medium">単位</th>
              <th className="w-20 px-2 py-2 text-right font-medium">
                入り数<span className="font-normal text-ink-faint">(P/箱)</span>
              </th>
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
                    {groupByCategory(products).map((g) => (
                      <optgroup key={g.group} label={g.group}>
                        {g.items.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </td>
                <td className="px-2 py-1.5">
                  <input
                    type="number"
                    value={r.quantity}
                    onChange={(e) => updateRow(i, 'quantity', e.target.value)}
                    className={cn(
                      inputCls,
                      'text-right font-bold',
                      r.needsTotal && !r.quantity && 'border-alert bg-alert-bg/40',
                    )}
                    min={1}
                    placeholder={r.needsTotal ? '総数' : undefined}
                  />
                  {r.product_id && prevQty[r.product_id] != null && (
                    Number(r.quantity) !== prevQty[r.product_id] ? (
                      <span className="mt-0.5 block rounded bg-alert/10 px-1 text-[10px] font-bold leading-tight text-alert">
                        前回 {prevQty[r.product_id]} → 今回 {r.quantity || '?'}
                      </span>
                    ) : (
                      <span className="mt-0.5 block text-[10px] leading-tight text-ink-faint">
                        前回と同じ {prevQty[r.product_id]}
                      </span>
                    )
                  )}
                  {hasPrev && r.product_id && prevQty[r.product_id] == null && (
                    <span className="mt-0.5 block rounded bg-harvest-50 px-1 text-[10px] font-bold leading-tight text-harvest-700">
                      前回なし → 今回 {r.quantity || '?'}（新規追加）
                    </span>
                  )}
                </td>
                <td className="px-2 py-1.5">
                  <input
                    type="text"
                    value={r.unit}
                    onChange={(e) => updateRow(i, 'unit', e.target.value)}
                    className={inputCls}
                  />
                </td>
                <td className="px-2 py-1.5">
                  <input
                    type="number"
                    value={r.packsPerCase}
                    onChange={(e) => updatePack(i, e.target.value)}
                    className={cn(inputCls, 'text-right')}
                    min={1}
                    placeholder="20"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex justify-end">
        <Button variant="primary" onClick={() => void handleSave('create')} isLoading={saving} disabled={saving}>
          注文として保存
        </Button>
      </div>

      <Modal
        open={dupConfirmOpen}
        onClose={() => setDupConfirmOpen(false)}
        title="同じ取引先・納品日の注文が既に存在します"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setDupConfirmOpen(false)} disabled={saving}>
              キャンセル
            </Button>
            <Button
              variant="secondary"
              size="sm"
              isLoading={saving}
              onClick={() => {
                setDupConfirmOpen(false)
                void handleSave('add_anyway')
              }}
            >
              別便の注文として追加
            </Button>
            {dupExisting.length >= 1 && (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  isLoading={saving}
                  onClick={() => {
                    const d = dupExisting[0]!
                    setDupConfirmOpen(false)
                    void handleSave({ replaceOrderId: d.id, expectedUpdatedAt: d.updated_at })
                  }}
                >
                  既存を上書き（訂正・再送）
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  isLoading={saving}
                  onClick={() => {
                    const d = dupExisting[0]!
                    setDupConfirmOpen(false)
                    void handleSave({ mergeOrderId: d.id })
                  }}
                >
                  既存注文に合算（追加）
                </Button>
              </>
            )}
          </>
        }
      >
        <div className="space-y-3 text-sm text-ink-soft">
          <p>
            この取引先・納品日（{formatJpDate(deliveryDate)}）の注文が既に{' '}
            <strong className="text-ink">{dupExisting.length}件</strong> あります。
          </p>
          <p className="text-xs text-ink-faint">
            追加発注の場合は<strong className="text-ink">「既存注文に合算」</strong>、FAX訂正の場合は
            <strong className="text-ink">「既存を上書き」</strong>、2便目として分ける場合は
            <strong className="text-ink">「別便の注文として追加」</strong>を選んでください。
          </p>
        </div>
      </Modal>
    </div>
  )
}
