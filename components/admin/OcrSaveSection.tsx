'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Plus } from 'lucide-react'
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
export function OcrSaveSection({ order, index, customers, products, destinations = [], onCustomerAdded }: Props) {
  const router = useRouter()

  const [customerId, setCustomerId] = useState(() => bestMatchCustomerId(order.customer_name, customers))
  const [deliveryDate, setDeliveryDate] = useState(order.delivery_date ?? '')
  const [destinationId, setDestinationId] = useState('')

  // 選択中の取引先に紐づく納入先だけを候補にする
  const customerDestinations = destinations.filter((d) => d.customer_id === customerId)

  // 取引先が変わったら納入先を自動マッチ（OCRの取引先名で寄せる）／無ければクリア
  useEffect(() => {
    const ds = destinations.filter((d) => d.customer_id === customerId)
    setDestinationId(ds.length > 0 ? bestMatchDestinationId(order.customer_name, ds) : '')
    // 取引先変更時のみ再選択する
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId])
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
  const [dupCount, setDupCount] = useState(0)

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
          destination_id: destinationId || undefined,
          delivery_date: deliveryDate,
          confirm_duplicate: confirmDuplicate,
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

      {/* 納入先（届け先）。選択中の取引先に納入先がある場合だけ表示。「取引先 ＞ 納入先」 */}
      {customerDestinations.length > 0 && (
        <div>
          <label className="mb-1 block text-xs font-medium text-ink-soft">
            納入先（届け先）
            <span className="ml-1 text-ink-faint">
              {customers.find((c) => c.id === customerId)?.name} ＞ …
            </span>
          </label>
          <select value={destinationId} onChange={(e) => setDestinationId(e.target.value)} className={selectCls}>
            <option value="">（指定なし）</option>
            {customerDestinations.map((d) => (
              <option key={d.id} value={d.id}>
                {d.code?.trim() || d.full_name}
                {d.code?.trim() && d.full_name ? `（${d.full_name}）` : ''}
              </option>
            ))}
          </select>
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
