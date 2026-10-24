'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Trash2, AlertTriangle, ShoppingCart, Check } from 'lucide-react'
import toast from 'react-hot-toast'
import Image from 'next/image'
import { cn } from '@/lib/cn'
import { jstTodayStr, formatJpDateShort } from '@/lib/dates'
import { groupByCategory } from '@/lib/products/group'
import { Button } from '@/components/ui/Button'
import { ColorDot } from '@/components/ui/ColorDot'
import { OrderSmartResolver, type ResolvedOrderData } from '@/components/admin/OrderSmartResolver'

export interface CustomerOption {
  id: string
  name: string
  display_color: string | null
}

export interface DestinationOption {
  id: string
  customer_id?: string
  code?: string | null
  full_name: string
}

export interface ProductOption {
  id: string
  name: string
  unit: string
  category?: string | null
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

export interface PackOption {
  id: string
  label: string
  selling_unit_label: string
  base_per_selling: number
}

export interface OrderNewFormProps {
  customers: CustomerOption[]
  destinations?: DestinationOption[]
  products: ProductOption[]
  /** 取引先ごとのデフォルトセット { [customer_id]: DefaultSetItem[] } */
  defaultSets: Record<string, DefaultSetItem[]>
  /** 商品ごとの荷姿 { [product_id]: PackOption[] }（共通＋取引先別） */
  packsByProduct: Record<string, PackOption[]>
  /** 設定: 'total' | 'cases'（後方互換。現在は per-item 荷姿選択を使う） */
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
  /** 選択中の荷姿（null=総数=基準単位そのまま） */
  pack_config_id: string | null
  base_per_selling: number | null
}

interface ProductStats {
  max: number
  min: number
  avg: number
  count: number
  lastDate: string
}

const ANOMALY_THRESHOLD = 2.5
const todayStr = jstTodayStr

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
 * 1. AIスマート読取: FAX画像・PDF・写真・Excelファイルをドロップすると、AIが自動解析して入力欄を展開。
 *    疑問点（かすれ、未登録納入先、単位曖昧など）はAI質問カードで提示され、ワンタップ解消または自由入力可能。
 * 2. 手動入力: 取引先を選ぶ → 「いつものセット」が自動展開
 * 3. 過去90日の数量と比較して異常値を警告（保存は通す）
 * 4. 確認画面 → 保存（アップロード原本も自動アーカイブ）
 */
export function OrderNewForm({
  customers,
  destinations = [],
  products,
  defaultSets,
  packsByProduct,
}: OrderNewFormProps) {
  const router = useRouter()
  const [customerId, setCustomerId] = useState('')
  const [destinationId, setDestinationId] = useState('')
  const [destinationsList, setDestinationsList] = useState<DestinationOption[]>(destinations)
  const [deliveryDate, setDeliveryDate] = useState(todayStr())
  const [shippingTime, setShippingTime] = useState<'am' | 'pm' | ''>('')
  const [note, setNote] = useState('')
  const [items, setItems] = useState<FormItem[]>([])
  const [stats, setStats] = useState<Record<string, ProductStats>>({})
  const [step, setStep] = useState<'entry' | 'confirm'>('entry')
  const [saving, setSaving] = useState(false)
  const [showAddProduct, setShowAddProduct] = useState(false)
  const [addProductId, setAddProductId] = useState('')
  const [originalFile, setOriginalFile] = useState<{
    base64: string
    mimeType: string
    fileName: string
  } | null>(null)

  useEffect(() => {
    if (destinations) setDestinationsList(destinations)
  }, [destinations])

  const selectedCustomer = customers.find((c) => c.id === customerId)
  const selectedDestination = destinationsList.find((d) => d.id === destinationId)
  const productById = new Map(products.map((p) => [p.id, p]))

  // 選択中取引先の納入先一覧
  const customerDestinations = customerId
    ? destinationsList.filter((d) => d.customer_id === customerId)
    : destinationsList

  // 取引先変更時: デフォルトセットを展開 + 過去統計をフェッチ
  useEffect(() => {
    if (!customerId) {
      setItems([])
      setStats({})
      setDestinationId('')
      return
    }
    // 取引先が変わったら納入先のリセット確認（現在の納入先が新しい取引先に属さない場合）
    if (destinationId) {
      const belongs = destinationsList.some((d) => d.id === destinationId && d.customer_id === customerId)
      if (!belongs) setDestinationId('')
    }

    const defaults = defaultSets[customerId] ?? []
    if (defaults.length > 0 && items.length === 0) {
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
            pack_config_id: null,
            base_per_selling: null,
          }
        }),
      )
    }

    // 過去統計を非同期取得
    void fetch(`/api/orders/stats?customer_id=${customerId}`)
      .then((r) => r.json())
      .then((j: { stats: Record<string, ProductStats> }) => setStats(j.stats ?? {}))
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId])

  // AIスマート読取からの反映ハンドラ
  const handleOrderResolved = useCallback((data: ResolvedOrderData) => {
    if (data.customerId) setCustomerId(data.customerId)
    if (data.destinationId) setDestinationId(data.destinationId)
    if (data.deliveryDate) setDeliveryDate(data.deliveryDate)
    if (data.shippingTime) setShippingTime(data.shippingTime)
    if (data.note) setNote(data.note)
    if (data.items.length > 0) setItems(data.items)
    if (data.originalFile) setOriginalFile(data.originalFile)
    toast.success('AI読取内容を注文フォームに自動反映しました')
  }, [])

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
        pack_config_id: null,
        base_per_selling: null,
      },
    ])
    setAddProductId('')
    setShowAddProduct(false)
  }

  /** 荷姿選択時は「販売単位数 × base_per_selling」で総数（基準単位）に換算。総数モードはそのまま。 */
  function resolveQuantity(it: FormItem): number {
    const raw = parseFloat(it.quantity)
    if (isNaN(raw) || raw <= 0) return 0
    if (it.pack_config_id && it.base_per_selling && it.base_per_selling > 0) {
      return Math.round(raw * it.base_per_selling)
    }
    return raw
  }

  /** 行の荷姿を切り替える（pack_config_id と base_per_selling を更新）。 */
  function setItemPack(idx: number, packId: string) {
    setItems((prev) =>
      prev.map((it, i) => {
        if (i !== idx) return it
        if (!packId) return { ...it, pack_config_id: null, base_per_selling: null }
        const opt = (packsByProduct[it.product_id] ?? []).find((o) => o.id === packId)
        return {
          ...it,
          pack_config_id: packId,
          base_per_selling: opt?.base_per_selling ?? null,
        }
      }),
    )
  }

  const canProceed =
    Boolean(customerId) &&
    Boolean(deliveryDate) &&
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
          destination_id: destinationId || undefined,
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
            pack_config_id: it.pack_config_id ?? undefined,
          })),
          original_file: originalFile ?? undefined,
        }),
      })
      const json = (await res.json()) as { orderId?: string; error?: string; warnings?: Record<string, unknown> }
      if (!res.ok) throw new Error(json.error ?? `登録失敗 (${res.status})`)
      const warnCount = Object.keys(json.warnings ?? {}).length
      if (warnCount > 0) {
        toast(`登録しました（数量に${warnCount}件の注意あり）`, { icon: '⚠️' })
      } else {
        toast.success('注文を登録しました（収穫タスクを自動作成しました）')
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
        <h2 className="font-display text-lg font-bold text-ink">登録内容の最終確認</h2>
        <div className="rounded-xl border border-line bg-bg-soft p-4 space-y-3 shadow-xs">
          <div className="flex items-center gap-2">
            <ColorDot color={selectedCustomer?.display_color ?? null} name={selectedCustomer?.name ?? ''} size="md" />
            <span className="font-bold text-ink text-base">{selectedCustomer?.name}</span>
          </div>

          {selectedDestination && (
            <p className="text-sm text-ink font-bold flex items-center gap-1.5">
              <span>📍 納入先:</span>
              <span className="text-emerald-800">{selectedDestination.full_name}</span>
              {selectedDestination.code && <span className="text-xs text-ink-muted">({selectedDestination.code})</span>}
            </p>
          )}

          <p className="text-sm text-ink-soft">
            出荷日: <span className="font-bold text-ink">{formatJpDateShort(deliveryDate)}</span>
            {shippingTime && <span className="ml-2 font-medium text-ink-soft">({shippingTime === 'am' ? '午前' : '午後'})</span>}
          </p>

          {originalFile && (
            <div className="rounded-lg bg-emerald-100/90 border border-emerald-300 px-3 py-1.5 text-xs font-bold text-emerald-950 flex items-center gap-2">
              <span>📎 添付原本: {originalFile.fileName}</span>
              <span className="text-[10px] text-emerald-700 bg-white/70 px-1.5 py-0.2 rounded font-semibold">
                現場ボード「FAX原本」で閲覧可能
              </span>
            </div>
          )}

          <div className="divide-y divide-line border-t border-line pt-2">
            {items.map((it) => {
              const qty = resolveQuantity(it)
              const st = stats[it.product_id]
              return (
                <div key={it.product_id} className="flex items-center gap-3 py-2">
                  {it.photo_url && (
                    <Image src={it.photo_url} alt="" width={40} height={40} className="h-10 w-10 rounded object-cover shrink-0" />
                  )}
                  <div className="flex-1">
                    <p className="text-sm font-bold text-ink">{it.product_name}</p>
                    {st && <AnomalyBadge qty={qty} stats={st} />}
                  </div>
                  <span className="num text-lg font-black tabular-nums text-ink shrink-0">
                    {qty} {it.unit}
                  </span>
                </div>
              )
            })}
          </div>
          {note && <p className="text-xs text-ink-soft border-t border-line pt-2">備考: {note}</p>}
        </div>
        <div className="flex gap-3 justify-end">
          <Button variant="secondary" onClick={() => setStep('entry')}>
            戻って修正
          </Button>
          <Button variant="primary" onClick={handleSave} isLoading={saving}>
            <Check className="h-4 w-4" aria-hidden />
            この内容で登録して収穫タスク同期
          </Button>
        </div>
      </div>
    )
  }

  // ───── 入力画面 ─────
  return (
    <div className="space-y-5">
      {/* AIスマート注文読取 ＆ AI質問カード（上部に常時配置） */}
      <OrderSmartResolver
        customers={customers}
        destinations={destinationsList}
        products={products}
        onOrderResolved={handleOrderResolved}
        onDestinationCreated={(newDest) => {
          setDestinationsList((prev) => [...prev, { ...newDest, code: newDest.code ?? null }])
          setDestinationId(newDest.id)
        }}
      />

      <div className="pt-2 border-t border-line/60">
        <h3 className="text-xs font-black text-ink-muted uppercase tracking-wider mb-3">
          📝 注文内容の確認・手動調整
        </h3>

        {/* 取引先・納入先・出荷日 */}
        <div className="grid gap-4 sm:grid-cols-2">
          {/* 取引先 */}
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

          {/* 出荷日 */}
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

        {/* 納入先（届け先） ＆ 出荷時間帯 */}
        <div className="grid gap-4 sm:grid-cols-2 mt-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-ink" htmlFor="order-destination">
              納入先（店舗・センター）
            </label>
            <select
              id="order-destination"
              value={destinationId}
              onChange={(e) => setDestinationId(e.target.value)}
              className={inputCls}
            >
              <option value="">指定なし（取引先標準）</option>
              {customerDestinations.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.full_name} {d.code ? `(${d.code})` : ''}
                </option>
              ))}
            </select>
          </div>

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
              <option value="am">午前便</option>
              <option value="pm">午後便</option>
            </select>
          </div>
        </div>
      </div>

      {/* 商品リスト */}
      {customerId ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-ink">
              品目・数量明細
              {items.length > 0 && (
                <span className="ml-1.5 text-ink-soft font-normal">{items.length}件</span>
              )}
            </h2>
          </div>

          {items.length === 0 && (
            <p className="py-4 text-center text-sm text-ink-soft">
              このお客様のデフォルトセットはありません。ファイル読込または下から商品を追加してください。
            </p>
          )}

          <div className="space-y-2">
            {items.map((it, idx) => {
              const qty = resolveQuantity(it)
              const st = stats[it.product_id]
              return (
                <div key={`${it.product_id}-${idx}`} className="rounded-xl border border-line bg-bg-card p-3 shadow-xs">
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

                    {/* 商品名＋荷姿選択 */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-ink truncate">{it.product_name}</p>
                      {(packsByProduct[it.product_id]?.length ?? 0) > 0 && (
                        <select
                          value={it.pack_config_id ?? ''}
                          onChange={(e) => setItemPack(idx, e.target.value)}
                          className="mt-0.5 h-7 rounded border border-line bg-bg-card px-1.5 text-xs text-ink-soft focus:outline-none focus:border-trust-500"
                          aria-label={`${it.product_name}の荷姿`}
                        >
                          <option value="">総数（{it.unit}）</option>
                          {(packsByProduct[it.product_id] ?? []).map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.selling_unit_label}（×{o.base_per_selling}）
                            </option>
                          ))}
                        </select>
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
                        className="num h-11 w-24 rounded-lg border border-line-strong bg-bg-card px-2 text-center text-xl font-black tabular-nums text-ink focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                        aria-label={`${it.product_name}の数量`}
                      />
                      <span className="text-sm font-bold text-ink-soft shrink-0">
                        {it.pack_config_id
                          ? (packsByProduct[it.product_id] ?? []).find((o) => o.id === it.pack_config_id)?.selling_unit_label ?? it.unit
                          : it.unit}
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

                  {/* 総数表示（荷姿選択時）+ 異常値警告 */}
                  {(it.pack_config_id && qty > 0) || (st && qty > 0) ? (
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 pl-[52px]">
                      {it.pack_config_id && qty > 0 && (
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
                  {groupByCategory(products.filter((p) => !items.some((it) => it.product_id === p.id))).map((g) => (
                    <optgroup key={g.group} label={g.group}>
                      {g.items.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}（{p.unit}）
                        </option>
                      ))}
                    </optgroup>
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
                className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-line py-2 text-sm font-bold text-ink-soft hover:border-emerald-500 hover:text-emerald-700 transition-colors"
              >
                <Plus className="h-4 w-4" aria-hidden />
                品目を手動追加
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-line py-8 text-center text-sm text-ink-faint">
          ファイル読み取りを実行するか、取引先を選ぶと明細入力欄が表示されます
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
      <div className="flex justify-end pt-2">
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
