'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Trash2, AlertTriangle, ChevronDown, ChevronUp, ShoppingCart, Check } from 'lucide-react'
import toast from 'react-hot-toast'
import Image from 'next/image'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/Button'
import { ColorDot } from '@/components/ui/ColorDot'

export interface CustomerOption {
  id: string
  name: string
  display_color: string | null
}

export interface ProductOption {
  id: string
  name: string
  unit: string
  photo_url: string | null
  default_tax_rate: 8 | 10
  default_unit_price: number | null
}

export interface DefaultSetItem {
  product_id: string
  product_name: string
  default_quantity: number | null
  packs_per_case: number | null
  container_type: string | null
  label_spec: string | null
}

export interface OrderNewFormProps {
  customers: CustomerOption[]
  products: ProductOption[]
  /** 取引先ごとのデフォルトセット { [customer_id]: DefaultSetItem[] } */
  defaultSets: Record<string, DefaultSetItem[]>
  /** 設定: 'total' | 'cases' */
  qtyInputMode: 'total' | 'cases'
}

interface FormItem {
  product_id: string
  product_name: string
  quantity: string
  unit: string
  unit_price: string
  tax_rate: 8 | 10
  photo_url: string | null
  packs_per_case: number | null
}

interface ProductStats {
  max: number
  min: number
  avg: number
  count: number
  lastDate: string
}

const ANOMALY_THRESHOLD = 2.5
const todayStr = () => new Date().toISOString().slice(0, 10)

function AnomalyBadge({ qty, stats }: { qty: number; stats: ProductStats }) {
  if (stats.count === 0 || qty <= 0) return null
  const isHigh = qty > stats.max * ANOMALY_THRESHOLD
  const isLow = stats.min > 0 && qty < stats.min / ANOMALY_THRESHOLD
  if (!isHigh && !isLow) return null
  return (
    <span className="inline-flex items-center gap-1 rounded bg-warning-bg px-1.5 py-0.5 text-[11px] font-medium text-warning">
      <AlertTriangle className="h-3 w-3" aria-hidden />
      {isHigh ? `通常の${(qty / stats.max).toFixed(1)}倍` : `通常より大幅に少ない`}
      <span className="text-ink-faint">（過去90日: {stats.min}〜{stats.max}）</span>
    </span>
  )
}

/**
 * 注文新規入力フォーム（画面B）。
 * 1. 取引先を選ぶ → 「いつものセット」が自動展開
 * 2. 商品ごとに数量を入力（ケース入力モード対応）
 * 3. 過去90日の数量と比較して異常値を警告（保存は通す）
 * 4. 確認画面 → 保存
 */
export function OrderNewForm({ customers, products, defaultSets, qtyInputMode }: OrderNewFormProps) {
  const router = useRouter()
  const [customerId, setCustomerId] = useState('')
  const [deliveryDate, setDeliveryDate] = useState(todayStr())
  const [shippingTime, setShippingTime] = useState<'am' | 'pm' | ''>('')
  const [note, setNote] = useState('')
  const [items, setItems] = useState<FormItem[]>([])
  const [inputMode, setInputMode] = useState<'total' | 'cases'>(qtyInputMode)
  const [stats, setStats] = useState<Record<string, ProductStats>>({})
  const [step, setStep] = useState<'entry' | 'confirm'>('entry')
  const [saving, setSaving] = useState(false)
  const [showAddProduct, setShowAddProduct] = useState(false)
  const [addProductId, setAddProductId] = useState('')

  const selectedCustomer = customers.find((c) => c.id === customerId)
  const productById = new Map(products.map((p) => [p.id, p]))

  // 取引先変更時: デフォルトセットを展開 + 過去統計をフェッチ
  useEffect(() => {
    if (!customerId) {
      setItems([])
      setStats({})
      return
    }
    const defaults = defaultSets[customerId] ?? []
    if (defaults.length > 0) {
      setItems(
        defaults.map((d) => {
          const p = productById.get(d.product_id)
          return {
            product_id: d.product_id,
            product_name: d.product_name,
            quantity: d.default_quantity != null ? String(d.default_quantity) : '',
            unit: p?.unit ?? '個',
            unit_price: String(p?.default_unit_price ?? 0),
            tax_rate: p?.default_tax_rate ?? 8,
            photo_url: p?.photo_url ?? null,
            packs_per_case: d.packs_per_case,
          }
        }),
      )
    } else {
      setItems([])
    }
    // 過去統計を非同期取得
    void fetch(`/api/orders/stats?customer_id=${customerId}`)
      .then((r) => r.json())
      .then((j: { stats: Record<string, ProductStats> }) => setStats(j.stats ?? {}))
      .catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId])

  const updateItem = useCallback((idx: number, field: keyof FormItem, value: string | number) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, [field]: value } : it)))
  }, [])

  function removeItem(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx))
  }

  function addProduct() {
    if (!addProductId) return
    const p = productById.get(addProductId)
    if (!p) return
    const defaults = defaultSets[customerId] ?? []
    const rule = defaults.find((d) => d.product_id === addProductId)
    setItems((prev) => [
      ...prev,
      {
        product_id: p.id,
        product_name: p.name,
        quantity: '',
        unit: p.unit,
        unit_price: String(p.default_unit_price ?? 0),
        tax_rate: p.default_tax_rate,
        photo_url: p.photo_url,
        packs_per_case: rule?.packs_per_case ?? null,
      },
    ])
    setAddProductId('')
    setShowAddProduct(false)
  }

  /** ケース入力の場合は総数に変換 */
  function resolveQuantity(it: FormItem): number {
    const raw = parseFloat(it.quantity)
    if (isNaN(raw) || raw <= 0) return 0
    if (inputMode === 'cases' && it.packs_per_case && it.packs_per_case > 0) {
      return Math.round(raw * it.packs_per_case)
    }
    return raw
  }

  const canProceed =
    customerId &&
    deliveryDate &&
    items.length > 0 &&
    items.every((it) => resolveQuantity(it) > 0)

  async function handleSave() {
    setSaving(true)
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          customer_id: customerId,
          delivery_date: deliveryDate,
          shipping_time: shippingTime || undefined,
          note: note || undefined,
          items: items.map((it) => ({
            product_id: it.product_id,
            product_name: it.product_name,
            quantity: resolveQuantity(it),
            unit: it.unit,
            unit_price: parseFloat(it.unit_price) || 0,
            tax_rate: it.tax_rate,
          })),
        }),
      })
      const json = (await res.json()) as { orderId?: string; error?: string; warnings?: Record<string, unknown> }
      if (!res.ok) throw new Error(json.error ?? `登録失敗 (${res.status})`)
      const warnCount = Object.keys(json.warnings ?? {}).length
      if (warnCount > 0) {
        toast(`登録しました（数量に${warnCount}件の注意あり）`, { icon: '⚠️' })
      } else {
        toast.success('注文を登録しました')
      }
      router.push('/admin')
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '登録に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const inputCls =
    'h-10 w-full rounded border border-line-strong bg-bg-card px-3 text-sm text-ink focus:outline-none focus:border-trust-500 focus:ring-2 focus:ring-trust-100'

  // ───── 確認画面 ─────
  if (step === 'confirm') {
    return (
      <div className="space-y-4">
        <h2 className="font-display text-lg font-bold text-ink">確認</h2>
        <div className="rounded-lg border border-line bg-bg-soft p-4 space-y-3">
          <div className="flex items-center gap-2">
            <ColorDot color={selectedCustomer?.display_color ?? null} name={selectedCustomer?.name ?? ''} size="md" />
            <span className="font-medium text-ink">{selectedCustomer?.name}</span>
          </div>
          <p className="text-sm text-ink-soft">
            出荷日: <span className="font-medium text-ink">{deliveryDate}</span>
            {shippingTime && <span className="ml-2 text-ink-soft">({shippingTime === 'am' ? '午前' : '午後'})</span>}
          </p>
          <div className="divide-y divide-line">
            {items.map((it) => {
              const qty = resolveQuantity(it)
              const st = stats[it.product_id]
              return (
                <div key={it.product_id} className="flex items-center gap-3 py-2">
                  {it.photo_url && (
                    <Image src={it.photo_url} alt="" width={40} height={40} className="h-10 w-10 rounded object-cover shrink-0" />
                  )}
                  <div className="flex-1">
                    <p className="text-sm font-medium text-ink">{it.product_name}</p>
                    {st && <AnomalyBadge qty={qty} stats={st} />}
                  </div>
                  <span className="num text-lg font-bold tabular-nums text-ink shrink-0">
                    {qty} {it.unit}
                  </span>
                </div>
              )
            })}
          </div>
          {note && <p className="text-xs text-ink-soft border-t border-line pt-2">備考: {note}</p>}
        </div>
        <div className="flex gap-3">
          <Button variant="secondary" onClick={() => setStep('entry')}>
            戻って修正
          </Button>
          <Button variant="primary" onClick={handleSave} isLoading={saving}>
            <Check className="h-4 w-4" aria-hidden />
            この内容で登録
          </Button>
        </div>
      </div>
    )
  }

  // ───── 入力画面 ─────
  return (
    <div className="space-y-5">
      {/* 取引先・出荷日 */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-ink" htmlFor="order-customer">
            取引先 <span className="text-alert">*</span>
          </label>
          <div className="relative">
            <select
              id="order-customer"
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              className={cn(inputCls, customerId ? 'pl-8' : '')}
            >
              <option value="">取引先を選択…</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            {selectedCustomer && (
              <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2">
                <ColorDot color={selectedCustomer.display_color} name={selectedCustomer.name} />
              </span>
            )}
          </div>
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-ink" htmlFor="order-delivery-date">
            出荷日 <span className="text-alert">*</span>
          </label>
          <input
            id="order-delivery-date"
            type="date"
            value={deliveryDate}
            onChange={(e) => setDeliveryDate(e.target.value)}
            className={inputCls}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-ink" htmlFor="order-shipping-time">
            出荷時間帯
          </label>
          <select
            id="order-shipping-time"
            value={shippingTime}
            onChange={(e) => setShippingTime(e.target.value as 'am' | 'pm' | '')}
            className={cn(inputCls, 'w-40')}
          >
            <option value="">指定なし</option>
            <option value="am">午前</option>
            <option value="pm">午後</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-ink" htmlFor="order-qty-mode">
            数量入力モード
          </label>
          <select
            id="order-qty-mode"
            value={inputMode}
            onChange={(e) => setInputMode(e.target.value as 'total' | 'cases')}
            className={cn(inputCls, 'w-48')}
          >
            <option value="total">総数（個）</option>
            <option value="cases">ケース数（P/C換算）</option>
          </select>
        </div>
      </div>

      {/* 商品リスト */}
      {customerId ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-ink">
              商品
              {items.length > 0 && (
                <span className="ml-1.5 text-ink-soft font-normal">{items.length}件</span>
              )}
            </h2>
          </div>

          {items.length === 0 && (
            <p className="py-4 text-center text-sm text-ink-soft">
              このお客様のデフォルトセットはありません。下から商品を追加してください。
            </p>
          )}

          <div className="space-y-2">
            {items.map((it, idx) => {
              const qty = resolveQuantity(it)
              const st = stats[it.product_id]
              return (
                <div key={`${it.product_id}-${idx}`} className="rounded-lg border border-line bg-bg-card p-3">
                  <div className="flex items-center gap-3">
                    {/* サムネイル（40×40） */}
                    {it.photo_url ? (
                      <Image
                        src={it.photo_url}
                        alt=""
                        width={40}
                        height={40}
                        className="h-10 w-10 rounded object-cover shrink-0"
                      />
                    ) : (
                      <div className="h-10 w-10 shrink-0 rounded bg-bg-soft flex items-center justify-center text-ink-faint text-xs">
                        🥦
                      </div>
                    )}

                    {/* 商品名 */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-ink truncate">{it.product_name}</p>
                      {inputMode === 'cases' && it.packs_per_case && (
                        <p className="text-xs text-ink-faint">P/C: {it.packs_per_case}</p>
                      )}
                    </div>

                    {/* 数量入力 */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      <input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        value={it.quantity}
                        onChange={(e) => updateItem(idx, 'quantity', e.target.value)}
                        className="num h-11 w-20 rounded border border-line-strong bg-bg-card px-2 text-center text-xl font-bold tabular-nums text-ink focus:outline-none focus:border-trust-500 focus:ring-2 focus:ring-trust-100"
                        aria-label={`${it.product_name}の数量`}
                      />
                      <span className="text-sm text-ink-soft shrink-0">
                        {inputMode === 'cases' ? 'c' : it.unit}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => removeItem(idx)}
                      aria-label={`${it.product_name}を削除`}
                      className="p-1 text-ink-faint hover:text-alert rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-alert"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </button>
                  </div>

                  {/* 総数表示（ケースモード時）+ 異常値警告 */}
                  {(inputMode === 'cases' && qty > 0 && it.packs_per_case) || (st && qty > 0) ? (
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 pl-[52px]">
                      {inputMode === 'cases' && qty > 0 && it.packs_per_case && (
                        <span className="text-xs text-ink-soft">
                          = <span className="num font-bold text-ink tabular-nums">{qty}</span> {it.unit}
                        </span>
                      )}
                      {st && qty > 0 && <AnomalyBadge qty={qty} stats={st} />}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>

          {/* 商品追加 */}
          <div>
            {showAddProduct ? (
              <div className="flex gap-2 items-center rounded-lg border border-line bg-bg-soft px-3 py-2">
                <select
                  value={addProductId}
                  onChange={(e) => setAddProductId(e.target.value)}
                  className={cn(inputCls, 'flex-1')}
                  autoFocus
                >
                  <option value="">商品を選択…</option>
                  {products
                    .filter((p) => !items.some((it) => it.product_id === p.id))
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}（{p.unit}）
                      </option>
                    ))}
                </select>
                <Button size="sm" onClick={addProduct} disabled={!addProductId}>
                  追加
                </Button>
                <button
                  type="button"
                  onClick={() => { setShowAddProduct(false); setAddProductId('') }}
                  className="text-xs text-ink-faint hover:text-ink-soft px-1"
                >
                  キャンセル
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowAddProduct(true)}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-line py-2 text-sm text-ink-soft hover:border-earth-400 hover:text-ink transition-colors"
              >
                <Plus className="h-4 w-4" aria-hidden />
                商品を追加
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-line py-10 text-center text-sm text-ink-faint">
          取引先を選ぶと「いつものセット」が表示されます
        </div>
      )}

      {/* 備考 */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-ink" htmlFor="order-note">
          備考
        </label>
        <textarea
          id="order-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="特記事項（例: 第3ハウス優先・冷蔵便不可）"
          className={cn(inputCls, 'h-auto py-2')}
        />
      </div>

      {/* 次へ */}
      <div className="flex justify-end">
        <Button
          variant="primary"
          size="lg"
          disabled={!canProceed}
          onClick={() => setStep('confirm')}
        >
          <ShoppingCart className="h-4 w-4" aria-hidden />
          内容を確認する
        </Button>
      </div>
    </div>
  )
}
