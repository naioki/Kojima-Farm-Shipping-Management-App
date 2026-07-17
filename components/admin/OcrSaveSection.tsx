'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Plus, ArrowLeftRight } from 'lucide-react'
import toast from 'react-hot-toast'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { formatJpDate } from '@/lib/dates'

interface ParsedOrder {
  customer_name: string | null
  destination_name?: string | null
  delivery_date: string | null
  items: {
    raw_name: string
    product_name: string | null
    quantity: string
    unit: string | null
    confidence: number
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
  customers: { id: string; name: string }[]
  products: { id: string; name: string }[]
  /** 取引先配下の納入先（届け先）。選択中の取引先のものだけ絞って表示する。 */
  destinations?: Destination[]
  /** 新規取引先を登録したとき親へ通知（同じ画面の他の注文でも選べるようにする）。 */
  onCustomerAdded?: (customer: { id: string; name: string }) => void
  /** 新規納入先を登録したとき親へ通知（同じ画面の他の注文でも選べるようにする）。 */
  onDestinationAdded?: (destination: Destination) => void
}

/** OCRが読んだ文字列を納入先（code/full_name/aliases）に名寄せ。見つからなければ ''。 */
function bestMatchDestinationId(text: string | null, dests: Destination[]): string {
  if (!text) return ''
  const lower = text.toLowerCase()
  const hit = dests.find((d) => {
    const cands = [d.code, d.full_name, ...d.aliases].filter(Boolean).map((s) => s!.toLowerCase())
    return cands.some((c) => c === lower || c.includes(lower) || lower.includes(c))
  })
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

/**
 * c記法（ケース＋端数, 例 "15c2" / "15c"）か判定する。
 * c記法は入り数(P/C)が無いと総数を確定できない。ここで自動展開すると
 * 誤った入り数を前提にした値が出てしまい、後の人がそれを信じる危険があるため、
 * 検知したら数量は空にして人手の総数入力を促す（マスタには一切触れない）。
 */
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
  if (isCaseNotation(s)) return NaN // c記法は総数を確定できない（人手入力へ）
  const x = s.match(/x(\d+)/i)
  if (x) return Number(x[1])
  const n = s.match(/^(\d+(?:\.\d+)?)/)
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
export function OcrSaveSection({ order, index, customers, products, destinations = [], onCustomerAdded, onDestinationAdded }: Props) {
  const router = useRouter()

  const [customerId, setCustomerId] = useState(() => bestMatchCustomerId(order.customer_name, customers))
  const [deliveryDate, setDeliveryDate] = useState(order.delivery_date ?? '')
  const [destinationId, setDestinationId] = useState('')
  // 「取引先⇄納入先を入れ替え」実行後、納入先の自動マッチに使うヒントを上書きする（未実行なら通常のAI読取値を使う）
  const [destHintOverride, setDestHintOverride] = useState<string | null>(null)

  // 選択中の取引先に紐づく納入先だけを候補にする
  const customerDestinations = destinations.filter((d) => d.customer_id === customerId)

  // 取引先が変わったら納入先を自動マッチ（OCRの納入先名→無ければ取引先名で寄せる）／無ければクリア
  useEffect(() => {
    const ds = destinations.filter((d) => d.customer_id === customerId)
    const hint = destHintOverride ?? (order.destination_name || order.customer_name)
    setDestinationId(ds.length > 0 ? bestMatchDestinationId(hint, ds) : '')
    // 取引先変更時のみ再選択する
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId, destHintOverride])

  /**
   * AIが取引先と納入先を逆に読んだ時のための入れ替え。
   * 「納入先名」で取引先を再検索し、その取引先の納入先候補を「取引先名」で選び直す。
   * 対応する取引先が見つからない場合は何もしない（新規登録は手動で行ってもらう）。
   */
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
    if (!customerId || !deliveryDate) { setPrevQty({}); return }
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
      .catch(() => { if (!cancelled) setPrevQty({}) })
    return () => { cancelled = true }
  }, [customerId, destinationId, deliveryDate])
  const [rows, setRows] = useState(() =>
    order.items.map((it) => {
      const caseNotation = isCaseNotation(it.quantity)
      return {
        raw_name: it.raw_name,
        product_id: bestMatchId(it.product_name, products),
        product_name: it.product_name ?? it.raw_name,
        // c記法は総数を確定できないので空にして人手入力を促す（誤った自動値を出さない）
        quantity: caseNotation ? '' : String(parseOcrQty(it.quantity) || ''),
        qtyRaw: it.quantity, // 数量の読取り原文（"15c2" 等）。警告表示に使う
        unit: it.unit || '個',
        confidence: it.confidence,
        needsTotal: caseNotation,
        packsPerCase: '', // 入り数(P/C)。任意。入れればc記法を総数展開＋マスタ保存
      }
    }),
  )
  const [saving, setSaving] = useState(false)
  const [dupConfirmOpen, setDupConfirmOpen] = useState(false)
  const [dupExisting, setDupExisting] = useState<{ id: string; created_at: string; updated_at: string; item_count: number }[]>([])

  // 取引先のインライン追加（未登録でも画面を離れずに登録できる＝二度手間防止）
  // リストは親(ManualOcrForm)が持つ customers を共有し、追加は onCustomerAdded で親へ通知する
  // （同じ画面の次の注文でも選べるようにするため）。
  const [addingCustomer, setAddingCustomer] = useState(false)
  const [newCustomerName, setNewCustomerName] = useState(order.customer_name ?? '')
  const [creatingCustomer, setCreatingCustomer] = useState(false)

  async function createCustomer() {
    const name = newCustomerName.trim()
    if (!name) { toast.error('取引先名を入力してください'); return }
    setCreatingCustomer(true)
    try {
      const res = await fetch('/api/customers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const json = (await res.json().catch(() => ({}))) as {
        customer?: { id: string; name: string }
        error?: string
        existing?: { id: string; name: string }
      }
      // 409＝正規化名が一致する既存あり（法人格・全半角ゆれ）。二重登録せず既存を使う（Issue#6-(5)）。
      if (res.status === 409 && json.error === 'duplicate' && json.existing) {
        onCustomerAdded?.(json.existing) // 共有リストになければ足す（既にあれば親側で重複しない実装）
        setCustomerId(json.existing.id)
        setAddingCustomer(false)
        toast(`同名の取引先「${json.existing.name}」が既にあります。既存を選択しました`, { icon: 'ℹ️' })
        return
      }
      if (!res.ok || !json.customer) throw new Error(json.error ?? `登録失敗 (${res.status})`)
      onCustomerAdded?.(json.customer) // 親の共有リストに追加（次の注文でも選べる）
      setCustomerId(json.customer.id)
      setAddingCustomer(false)
      toast.success(`取引先「${json.customer.name}」を登録しました（締め・規格は後で設定可）`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '取引先の登録に失敗しました')
    } finally {
      setCreatingCustomer(false)
    }
  }

  // 納入先のインライン追加（取引先と同様、画面を離れず登録＝二度手間防止）
  const [addingDest, setAddingDest] = useState(false)
  const [newDestCode, setNewDestCode] = useState('')
  const [newDestFullName, setNewDestFullName] = useState(order.destination_name ?? '')
  const [creatingDest, setCreatingDest] = useState(false)

  async function createDestination() {
    if (!customerId) { toast.error('先に取引先を選んでください'); return }
    const full = newDestFullName.trim()
    if (!full) { toast.error('正式名を入力してください'); return }
    setCreatingDest(true)
    try {
      const res = await fetch('/api/destinations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ customer_id: customerId, code: newDestCode.trim() || null, full_name: full, aliases: [] }),
      })
      const json = (await res.json().catch(() => ({}))) as {
        destination?: { id: string; code: string | null; full_name: string; aliases: string[] }
        error?: string
        existing?: { id: string; code: string | null; full_name: string; aliases: string[] }
      }
      // 409＝この取引先配下に正規化名が一致する既存納入先あり。二重登録せず既存を使う（Issue#6-(5)）。
      if (res.status === 409 && json.error === 'duplicate' && json.existing) {
        const dup: Destination = { ...json.existing, customer_id: customerId }
        onDestinationAdded?.(dup)
        setDestinationId(dup.id)
        setAddingDest(false)
        setNewDestCode(''); setNewDestFullName('')
        toast(`同名の納入先「${dup.code?.trim() || dup.full_name}」が既にあります。既存を選択しました`, { icon: 'ℹ️' })
        return
      }
      if (!res.ok || !json.destination) throw new Error(json.error ?? `登録失敗 (${res.status})`)
      const dest: Destination = { ...json.destination, customer_id: customerId }
      onDestinationAdded?.(dest) // 親の共有リストに追加（次の注文でも選べる）
      setDestinationId(dest.id)
      setAddingDest(false)
      setNewDestCode(''); setNewDestFullName('')
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

  /** 入り数(P/C)変更。c記法の行なら総数を自動再計算する（15c2 + P/C → 総数）。 */
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

  /**
   * mode='create': 通常保存（重複があれば409でダイアログへ）
   * mode='add_anyway': 重複を承知で新規の別注文として追加
   * mode={replaceOrderId,expectedUpdatedAt}: 既存注文を置き換え（訂正・再送）
   */
  async function handleSave(
    mode: 'create' | 'add_anyway' | { replaceOrderId: string; expectedUpdatedAt: string } = 'create',
  ) {
    if (!customerId) { toast.error('取引先を選択してください'); return }
    if (!deliveryDate) { toast.error('納品日を入力してください'); return }
    const invalid = rows.filter((r) => !r.product_id || isNaN(Number(r.quantity)) || Number(r.quantity) <= 0)
    if (invalid.length > 0) { toast.error('商品と数量をすべて入力してください'); return }

    setSaving(true)
    try {
      const body: Record<string, unknown> = {
        customer_id: customerId,
        destination_id: destinationId || undefined,
        delivery_date: deliveryDate,
        items: rows.map((r) => ({
          product_id: r.product_id,
          product_name: r.product_name,
          quantity: Number(r.quantity),
          unit: r.unit,
          unit_price: 0,
          tax_rate: 8,
          // 入り数が入っていれば規格マスタ保存用に送る（任意）
          packs_per_case: r.packsPerCase.trim() !== '' && Number(r.packsPerCase) > 0
            ? Number(r.packsPerCase)
            : undefined,
        })),
      }
      if (mode === 'add_anyway') {
        body.confirm_duplicate = true
      } else if (typeof mode === 'object') {
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
        warnings?: Record<string, { type: 'high' | 'low'; ratio: number; histMax: number; histMin: number }>
      }
      // 409 = 同一取引先×納品日の既存注文あり。3択ダイアログ（置き換え／追加／キャンセル）へ。
      if (res.status === 409 && json.duplicate) {
        setDupExisting(json.existing ?? [])
        setDupConfirmOpen(true)
        return
      }
      // 409 = 置き換え対象が他の人に更新された（楽観ロック）。保存し直しを促す。
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
        toast(`数量が普段と大きく違います（${names}）。念のため確認してください`, { icon: '⚠️', duration: 8000 })
      }

      toast.success(
        json.replaced
          ? '注文を置き換えました。受注ボックスの承認待ちに反映されます'
          : '注文を登録しました。受注ボックスの承認待ちに追加されました',
      )
      router.push('/admin/inbox?filter=pending')
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  // 前回注文が存在するか（差分表示の判定に使う）。空＝この取引先/納入先/納品日は初回。
  const hasPrev = Object.keys(prevQty).length > 0

  const inputCls =
    'h-9 w-full rounded border border-line-strong bg-bg-card px-2 text-sm text-ink focus:outline-none focus:border-trust-500 focus:ring-2 focus:ring-trust-100'
  const selectCls =
    'h-9 w-full rounded border border-line-strong bg-bg-card px-2 text-sm text-ink focus:outline-none focus:border-trust-500 focus:ring-2 focus:ring-trust-100'

  return (
    <div className="space-y-3 rounded-lg border border-earth-200 bg-earth-50 p-4">
      <p className="text-xs font-semibold text-earth-700">注文 {index + 1} を保存</p>

      {rows.some((r) => r.product_id && prevQty[r.product_id] != null && Number(r.quantity) !== prevQty[r.product_id]) && (
        <div className="flex items-start gap-2 rounded border border-alert/40 bg-alert-bg/40 px-3 py-2 text-xs text-alert">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            この取引先・納入先・納品日には<strong>既存の注文があり、数量が変わっています</strong>（下に「前回→今回」を赤表示）。
            最新で上書きされます。変更内容を必ず確認してください。
          </span>
        </div>
      )}

      {rows.some((r) => r.needsTotal) && (
        <div className="flex items-start gap-2 rounded border border-alert/40 bg-alert-bg/40 px-3 py-2 text-xs text-alert">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            ケース表記（例「15c2」）の項目があります。入り数(P/C)が確定できないため<strong>推測値は入れていません</strong>。
            <strong>総数</strong>を直接入力するか、分かれば<strong>入り数</strong>を入れてください（入り数→総数を自動計算し、規格マスタにも保存します）。
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
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              {!customerId && (
                <button
                  type="button"
                  onClick={() => { setNewCustomerName(order.customer_name ?? ''); setAddingCustomer(true) }}
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
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void createCustomer() } }}
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

      {/* 納入先（届け先）。取引先選択中に表示。「取引先 ＞ 納入先」。未登録ならその場で追加できる。 */}
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
                      {d.code?.trim() && d.full_name ? `（${d.full_name}）` : ''}
                    </option>
                  ))}
                </select>
              )}
              <button
                type="button"
                onClick={() => { setNewDestCode(''); setNewDestFullName(order.destination_name ?? ''); setAddingDest(true) }}
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
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void createDestination() } }}
                placeholder="正式名（必須）"
                autoFocus
                className={cn(inputCls, 'min-w-[10rem] flex-1')}
              />
              <Button variant="primary" size="sm" onClick={createDestination} isLoading={creatingDest} disabled={creatingDest}>登録</Button>
              <Button variant="secondary" size="sm" onClick={() => setAddingDest(false)} disabled={creatingDest}>取消</Button>
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
              <th className="w-20 px-2 py-2 text-right font-medium">数量</th>
              <th className="w-16 px-2 py-2 text-left font-medium">単位</th>
              <th className="w-20 px-2 py-2 text-right font-medium">入り数<span className="font-normal text-ink-faint">(任意)</span></th>
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
                    className={cn(
                      inputCls,
                      'text-right',
                      r.needsTotal && !r.quantity && 'border-alert bg-alert-bg/40',
                    )}
                    min={1}
                    placeholder={r.needsTotal ? '総数' : undefined}
                  />
                  {r.needsTotal && (
                    <span className="mt-0.5 flex items-center gap-0.5 text-[10px] leading-tight text-alert">
                      <AlertTriangle className="h-2.5 w-2.5 shrink-0" aria-hidden />
                      「{r.qtyRaw.trim()}」は総数を入力（または右の入り数を入力）
                    </span>
                  )}
                  {r.product_id && prevQty[r.product_id] != null && (
                    Number(r.quantity) !== prevQty[r.product_id] ? (
                      <span className="mt-0.5 block rounded bg-alert/10 px-1 text-[10px] font-bold leading-tight text-alert">
                        前回 {prevQty[r.product_id]} → 今回 {r.quantity || '?'}（変更）
                      </span>
                    ) : (
                      <span className="mt-0.5 block text-[10px] leading-tight text-ink-faint">前回と同じ {prevQty[r.product_id]}</span>
                    )
                  )}
                  {/* 前回注文はあるが、この商品は前回に無い＝今回の再送で増えた明細（差分で「新規」を検出） */}
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
                    placeholder="—"
                    title="1ケースあたりの入り数（P/C）。入れるとケース表記を総数に展開し、規格マスタにも保存します"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex justify-end">
        <Button variant="primary" onClick={() => handleSave('create')} isLoading={saving} disabled={saving}>
          注文として保存
        </Button>
      </div>

      {/* 重複警告（同一取引先×納品日の既存注文あり）。時間差で数量違いの再送を2重登録してしまう
          事故を防ぐため、単純な「承知で登録」ではなく「既存を置き換え／別注文として追加」を選ばせる。 */}
      <Modal
        open={dupConfirmOpen}
        onClose={() => setDupConfirmOpen(false)}
        title="重複の可能性"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setDupConfirmOpen(false)} disabled={saving}>
              キャンセル
            </Button>
            <Button
              variant="secondary"
              size="sm"
              isLoading={saving}
              onClick={() => { setDupConfirmOpen(false); void handleSave('add_anyway') }}
            >
              別の注文として追加
            </Button>
            {dupExisting.length === 1 && (
              <Button
                variant="primary"
                size="sm"
                isLoading={saving}
                onClick={() => {
                  const d = dupExisting[0]!
                  setDupConfirmOpen(false)
                  void handleSave({ replaceOrderId: d.id, expectedUpdatedAt: d.updated_at })
                }}
              >
                既存を置き換える（訂正・再送）
              </Button>
            )}
          </>
        }
      >
        <div className="space-y-3 text-sm text-ink-soft">
          <p>
            この取引先・納品日（{formatJpDate(deliveryDate)}）の注文が既に <strong className="text-ink">{dupExisting.length}件</strong> あります。
            FAXの再送・時間差での重複読み取りの可能性があります。
          </p>
          {dupExisting.length === 1 && hasPrev && (
            <div className="space-y-1 rounded border border-line bg-bg-soft px-3 py-2">
              <p className="text-xs font-semibold text-ink">既存注文との差分（今回の入力内容との比較）</p>
              {rows.map((r, i) => {
                if (!r.product_id) return null
                const prev = prevQty[r.product_id]
                if (prev == null) {
                  return (
                    <p key={i} className="text-xs font-bold text-harvest-700">
                      {r.product_name}：既存になし → 今回 {r.quantity || '?'}（新規追加）
                    </p>
                  )
                }
                if (Number(r.quantity) !== prev) {
                  return (
                    <p key={i} className="text-xs font-bold text-alert">
                      {r.product_name}：{prev} → {r.quantity || '?'}（変更）
                    </p>
                  )
                }
                return (
                  <p key={i} className="text-xs text-ink-faint">
                    {r.product_name}：{prev}（同じ）
                  </p>
                )
              })}
            </div>
          )}
          {dupExisting.length === 1 ? (
            <p className="text-xs text-ink-faint">
              「既存を置き換える」は<strong className="text-ink">訂正・再送で数字が変わった時</strong>に使います（1件のまま更新）。
              「別の注文として追加」は<strong className="text-ink">本当に2便ある時</strong>に使います。
            </p>
          ) : (
            <p className="text-xs text-alert">
              既存注文が複数あるため、この画面からは自動で置き換え対象を決められません。内容を確認のうえ
              「別の注文として追加」するか、先に注文一覧で不要な注文を削除してください。
            </p>
          )}
        </div>
      </Modal>
    </div>
  )
}
