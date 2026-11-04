'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import {
  Plus,
  Trash2,
  AlertTriangle,
  ShoppingCart,
  Check,
  UserPlus,
  Sparkles,
  Loader2,
  History,
} from 'lucide-react'
import toast from 'react-hot-toast'
import Image from 'next/image'
import { cn } from '@/lib/cn'
import { jstTodayStr, shiftDateStr, formatJpDateShort, formatJpDate } from '@/lib/dates'
import { groupByCategory } from '@/lib/products/group'
import { determineContainerType,
  determineHasCard,
  resolveContainerType, determineUnitCount } from '@/lib/pipeline/schemas'
import {
  findBestMatchingCustomer,
  findBestMatchingDestination,
} from '@/lib/orders/natural-parser'
import { Button } from '@/components/ui/Button'
import { ColorDot } from '@/components/ui/ColorDot'
import { Modal } from '@/components/ui/Modal'
import { OrderSmartResolver, type ResolvedOrderData } from '@/components/admin/OrderSmartResolver'
import type { ParsedOrder } from '@/lib/gemini/analyze'
import { IntakeChannelPicker, type ManualIntakeChannel } from '@/components/ui/IntakeChannelPicker'
import { suggestIntakeChannel } from '@/lib/orders/intake-suggest'

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
  spec?: string | null
  has_card?: boolean | null
}

export interface CustomerRuleInfo {
  packs_per_case: number | null
  container_type: string | null
  spec: string | null
  has_card: boolean | null
}

export interface PackOption {
  id: string
  customer_id?: string | null
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
  /** `${customer_id}:${product_id}` ごとの取引ルール */
  customerRulesByPair?: Record<string, CustomerRuleInfo>
  /** 商品ごとの荷姿 { [product_id]: PackOption[] }（共通＋取引先別） */
  packsByProduct: Record<string, PackOption[]>
  /** 設定: 'total' | 'cases'（後方互換） */
  qtyInputMode: 'total' | 'cases'
}

interface FormItem {
  product_id: string
  product_name: string
  /** 総数（パック数・基準単位）の文字列 */
  quantity: string
  /** 3連動エディタ：1箱あたりの入数 */
  packs_per_case: number
  /** 3連動エディタ：箱数（ケース数） */
  cases_input: string
  /** 3連動エディタ：端数（バラ） */
  loose_input: string
  unit: string
  unit_price: string
  tax_rate: 8 | 10
  photo_url: string | null
  /** 選択中の荷姿（null=基準単位または3連動換算） */
  pack_config_id: string | null
  base_per_selling: number | null
  /** 現場荷姿属性 */
  spec: string
  container_type: string
  has_card: boolean
}

interface ProductStats {
  max: number
  min: number
  avg: number
  count: number
  lastDate: string
}

const ANOMALY_THRESHOLD = 2.5

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
 * 注文新規入力フォーム（画面B・完全網羅版）。
 * 1. AIスマート読取: FAX画像・PDF・写真・Excel・テキストを置くと即座に入力欄へ反映。
 *    複数注文が含まれる場合は「✨ 全件まとめて一括登録」にもワンタップ対応。
 * 2. 手動入力: 取引先・納入先のその場でのワンストップ新規作成に対応。
 *    取引先選択時に「いつものセット」が無い場合でも主力品目（青梗菜等）を初期展開し、手数を最小化。
 * 3. 3連動数量エディタ: 「入数(P/箱) × 箱数 ＋ 端数 ＝ 総パック数」のどれを入れても相互自動計算。
 * 4. 既存注文のリアルタイム検知＆重複解決: 同一（取引先×納入先×出荷日）に注文がある場合、
 *    409エラーで止めず「既存注文に合算（追加）」「既存注文を上書き（置換）」「別便として追加」を選択可能。
 */
const EMPTY_DESTINATIONS: DestinationOption[] = []
const EMPTY_CUSTOMER_RULES: Record<string, CustomerRuleInfo> = {}

export function OrderNewForm({
  customers: initialCustomers,
  destinations = EMPTY_DESTINATIONS,
  products,
  defaultSets,
  customerRulesByPair = EMPTY_CUSTOMER_RULES,
  packsByProduct,
}: OrderNewFormProps) {
  const router = useRouter()

  const today = useMemo(() => jstTodayStr(), [])
  const tomorrow = useMemo(() => shiftDateStr(today, 1), [today])
  const dayAfterTomorrow = useMemo(() => shiftDateStr(today, 2), [today])

  const [customersList, setCustomersList] = useState<CustomerOption[]>(initialCustomers)
  const [destinationsList, setDestinationsList] = useState<DestinationOption[]>(destinations)
  const [customerId, setCustomerId] = useState('')
  const [destinationId, setDestinationId] = useState('')
  // 全品目「出荷日の前日に収穫・パック」の原則および現場ボード既定日（翌日出荷）に合わせ、初期値を明日（tomorrow）に設定
  const [deliveryDate, setDeliveryDate] = useState(tomorrow)
  const [shippingTime, setShippingTime] = useState<'am' | 'pm' | ''>('am')
  const [intakeChannel, setIntakeChannel] = useState<ManualIntakeChannel | null>(null)
  // AI読み取りのコールバック内で最新の経路を参照するための写し（コールバックの依存を増やさない）
  const intakeChannelRef = useRef<ManualIntakeChannel | null>(null)
  useEffect(() => {
    intakeChannelRef.current = intakeChannel
  }, [intakeChannel])
  const [note, setNote] = useState('')
  const [items, setItems] = useState<FormItem[]>([])
  const [stats, setStats] = useState<Record<string, ProductStats>>({})
  const [step, setStep] = useState<'entry' | 'confirm'>('entry')
  const [saving, setSaving] = useState(false)
  const [copyingLast, setCopyingLast] = useState(false)
  const [showAddProduct, setShowAddProduct] = useState(false)
  const [addProductId, setAddProductId] = useState('')
  const [originalFile, setOriginalFile] = useState<{
    base64: string
    mimeType: string
    fileName: string
  } | null>(null)

  // AI読取による明細セット中フラグ（customerId 変更時のデフォルトセット上書きを防止）
  const isAiResolvedRef = useRef(false)
  const [allParsedOrders, setAllParsedOrders] = useState<ParsedOrder[]>([])
  const [batchSaving, setBatchSaving] = useState(false)

  // 既存注文（同一 取引先×納入先×出荷日）のリアルタイムチェック＆重複解決モーダル
  const [existingItemsMap, setExistingItemsMap] = useState<Record<string, number>>({})
  const [duplicateAction, setDuplicateAction] = useState<'merge' | 'replace' | 'add_anyway'>('merge')
  const [dupModalOpen, setDupModalOpen] = useState(false)
  const [dupExistingOrders, setDupExistingOrders] = useState<
    Array<{ id: string; created_at: string; updated_at: string; item_count: number }>
  >([])

  // インライン新規取引先作成 state
  const [showNewCustomer, setShowNewCustomer] = useState(false)
  const [newCustomerName, setNewCustomerName] = useState('')
  const [newCustomerDestName, setNewCustomerDestName] = useState('')
  const [newCustomerPacks, setNewCustomerPacks] = useState<number>(20)
  const [creatingCustomer, setCreatingCustomer] = useState(false)

  // インライン新規納入先作成 state
  const [showNewDestination, setShowNewDestination] = useState(false)
  const [newDestName, setNewDestName] = useState('')
  const [creatingDestination, setCreatingDestination] = useState(false)

  useEffect(() => {
    setCustomersList(initialCustomers)
  }, [initialCustomers])

  useEffect(() => {
    if (destinations) setDestinationsList(destinations)
  }, [destinations])

  const selectedCustomer = customersList.find((c) => c.id === customerId)
  const selectedDestination = destinationsList.find((d) => d.id === destinationId)
  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products])

  // 主力品目（青梗菜 / チンゲン菜）
  const defaultMainProduct = useMemo(
    () =>
      products.find((p) => p.name.includes('青梗菜') || p.name.includes('チンゲン')) ??
      products.find((p) => p.category !== '資材') ??
      products[0],
    [products],
  )

  // 選択中取引先の納入先一覧
  const customerDestinations = useMemo(
    () => (customerId ? destinationsList.filter((d) => d.customer_id === customerId) : destinationsList),
    [customerId, destinationsList],
  )

  /** 取引先・納入先・品目に応じたデフォルト FormItem を組み立てるヘルパー */
  const buildDefaultFormItem = useCallback(
    (
      prod: ProductOption,
      custId: string,
      destId: string,
      overrideQty?: number | string | null,
      overridePacks?: number | null,
      overrideSpec?: string | null,
      overrideContainer?: string | null,
      overrideHasCard?: boolean | null,
    ): FormItem => {
      const custName = customersList.find((c) => c.id === custId)?.name ?? ''
      const destName = destinationsList.find((d) => d.id === destId)?.full_name ?? ''
      const pairRule = custId ? customerRulesByPair[`${custId}:${prod.id}`] : undefined

      const ppc =
        (overridePacks && overridePacks > 0 ? overridePacks : null) ??
        (pairRule?.packs_per_case && pairRule.packs_per_case > 0 ? pairRule.packs_per_case : null) ??
        determineUnitCount(custName, overrideSpec ?? pairRule?.spec ?? destName, undefined, prod.name)

      const baseLabel = prod.name.includes('小松菜')
        ? '200g'
        : prod.name.includes('青梗菜') || prod.name.includes('チンゲン')
        ? '2〜3株'
        : '標準'
      const resolvedSpec =
        overrideSpec?.trim() ||
        pairRule?.spec ||
        `${baseLabel} (入数${ppc})`

      const resolvedContainer = resolveContainerType({
        explicitContainer: overrideContainer,
        ruleContainer: pairRule?.container_type,
        clientName: custName,
        destination: destName,
      })

      const resolvedHasCard = determineHasCard({
        explicitHasCard: overrideHasCard,
        ruleHasCard: pairRule?.has_card,
        clientName: custName,
        destination: destName,
      })

      const totalNum =
        overrideQty != null && String(overrideQty).trim() !== '' ? Number(overrideQty) : 0
      const hasValidTotal = Number.isFinite(totalNum) && totalNum > 0
      const cNum = hasValidTotal && ppc > 0 ? Math.floor(totalNum / ppc) : 0
      const rNum = hasValidTotal && ppc > 0 ? totalNum % ppc : 0

      return {
        product_id: prod.id,
        product_name: prod.name,
        quantity: hasValidTotal ? String(totalNum) : '',
        packs_per_case: ppc,
        cases_input: hasValidTotal && cNum > 0 ? String(cNum) : '',
        loose_input: hasValidTotal && rNum > 0 ? String(rNum) : '',
        unit: prod.unit || '袋',
        unit_price: String(prod.default_unit_price ?? 0),
        tax_rate: prod.default_tax_rate ?? 8,
        photo_url: prod.photo_url ?? null,
        pack_config_id: null,
        base_per_selling: null,
        spec: resolvedSpec,
        container_type: resolvedContainer,
        has_card: resolvedHasCard,
      }
    },
    [customersList, destinationsList, customerRulesByPair],
  )

  // 初回マウント時: 主力品目1行を初期表示しておき、すぐ入力できるようにする
  useEffect(() => {
    if (items.length === 0 && defaultMainProduct) {
      setItems([buildDefaultFormItem(defaultMainProduct, '', '')])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultMainProduct])

  // 取引先の手動変更ハンドラ
  function handleCustomerChange(newCustId: string) {
    isAiResolvedRef.current = false
    setCustomerId(newCustId)

    if (!newCustId) {
      setDestinationId('')
      setStats({})
      return
    }

    // 納入先の自動選択（1件のみなら自動セット、複数または別取引先ならリセット）
    const custDests = destinationsList.filter((d) => d.customer_id === newCustId)
    let nextDestId = ''
    if (custDests.length === 1 && custDests[0]) {
      nextDestId = custDests[0].id
    } else if (custDests.some((d) => d.id === destinationId)) {
      nextDestId = destinationId
    }
    setDestinationId(nextDestId)

    // すでに数量を入力済みの行がある場合は、数量を保ったまま入数・規格・コンテナを新しい取引先ルールに合わせる
    const hasEnteredQty = items.some((it) => parseFloat(it.quantity) > 0)
    const defaults = defaultSets[newCustId] ?? []

    if (!hasEnteredQty && defaults.length > 0) {
      setItems(
        defaults.map((d) => {
          const p = productById.get(d.product_id) ?? defaultMainProduct!
          return buildDefaultFormItem(
            p,
            newCustId,
            nextDestId,
            d.default_quantity,
            d.packs_per_case,
            d.spec ?? d.label_spec,
            d.container_type,
            d.has_card,
          )
        }),
      )
    } else if (items.length > 0) {
      setItems((prev) =>
        prev.map((it) => {
          const p = productById.get(it.product_id) ?? defaultMainProduct
          if (!p) return it
          const updated = buildDefaultFormItem(p, newCustId, nextDestId, it.quantity)
          // 箱数入力があった場合は新しい入数で総数を再計算
          const c = parseFloat(it.cases_input)
          const l = parseFloat(it.loose_input) || 0
          if (!isNaN(c) && c > 0) {
            const newTotal = Math.round(c * updated.packs_per_case + l)
            return {
              ...updated,
              cases_input: it.cases_input,
              loose_input: it.loose_input,
              quantity: String(newTotal),
            }
          }
          return updated
        }),
      )
    } else if (defaultMainProduct) {
      setItems([buildDefaultFormItem(defaultMainProduct, newCustId, nextDestId)])
    }
  }

  // 電話で「いつもの」「前回と同じ」と言われたとき: 直近の確定注文の明細を1タップで写す。
  // 規格・荷姿・カード有無も前回の値を引き継ぐ。数量は必ず目で確認してもらう（トーストで促す）。
  async function copyLastOrder() {
    if (!customerId) return
    setCopyingLast(true)
    try {
      const qs = new URLSearchParams({ customer_id: customerId })
      if (destinationId) qs.set('destination_id', destinationId)
      const res = await fetch(`/api/orders/last?${qs.toString()}`)
      const json = (await res.json().catch(() => ({}))) as {
        order?: { delivery_date: string | null; destination_id: string | null; shipping_time: 'am' | 'pm' | null } | null
        items?: { product_id: string; quantity: number; spec: string | null; container_type: string | null; has_card: boolean | null }[]
        error?: string
      }
      if (!res.ok) throw new Error(json.error ?? `前回の注文の取得に失敗 (${res.status})`)
      if (!json.order || !json.items?.length) {
        toast('この取引先の過去の確定注文がありません', { icon: 'ℹ️' })
        return
      }
      const destId = destinationId || json.order.destination_id || ''
      if (!destinationId && json.order.destination_id) setDestinationId(json.order.destination_id)
      if (json.order.shipping_time) setShippingTime(json.order.shipping_time)
      const next = json.items
        .map((it) => {
          const p = productById.get(it.product_id)
          return p
            ? buildDefaultFormItem(p, customerId, destId, it.quantity, null, it.spec, it.container_type, it.has_card)
            : null
        })
        .filter((x): x is FormItem => x !== null)
      if (next.length === 0) {
        toast.error('前回の品目が品目マスタに見つかりません')
        return
      }
      setItems(next)
      toast.success(
        `${json.order.delivery_date ? formatJpDateShort(json.order.delivery_date) : '前回'} の注文（${next.length}品目）を写しました。数量を確認してください`,
      )
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '前回の注文の取得に失敗しました')
    } finally {
      setCopyingLast(false)
    }
  }

  // 納入先変更時にコンテナ種別等を自動更新
  function handleDestinationChange(newDestId: string) {
    setDestinationId(newDestId)
    const custName = customersList.find((c) => c.id === customerId)?.name ?? ''
    const destName = destinationsList.find((d) => d.id === newDestId)?.full_name ?? ''
    if (custName || destName) {
      const autoCont = determineContainerType(custName, destName)
      setItems((prev) =>
        prev.map((it) => ({
          ...it,
          container_type: autoCont,
        })),
      )
    }
  }

  // 取引先変更時: 過去90日統計を非同期取得
  useEffect(() => {
    if (!customerId) {
      setStats({})
      return
    }
    void fetch(`/api/orders/stats?customer_id=${customerId}`)
      .then((r) => r.json())
      .then((j: { stats?: Record<string, ProductStats> }) => setStats(j.stats ?? {}))
      .catch(() => {})
  }, [customerId])

  // 同一（取引先×納入先×出荷日）の既存注文をリアルタイムチェック
  useEffect(() => {
    if (!customerId || !deliveryDate) {
      setExistingItemsMap({})
      return
    }
    const params = new URLSearchParams({ customer_id: customerId, delivery_date: deliveryDate })
    if (destinationId) params.set('destination_id', destinationId)
    let cancelled = false
    fetch(`/api/orders/existing?${params.toString()}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((j: { items?: { product_id: string; quantity: number }[] }) => {
        if (cancelled) return
        const m: Record<string, number> = {}
        for (const it of j.items ?? []) m[it.product_id] = Number(it.quantity)
        setExistingItemsMap(m)
      })
      .catch(() => {
        if (!cancelled) setExistingItemsMap({})
      })
    return () => {
      cancelled = true
    }
  }, [customerId, destinationId, deliveryDate])

  // AIスマート読取からの反映ハンドラ
  const handleOrderResolved = useCallback(
    (data: ResolvedOrderData) => {
      isAiResolvedRef.current = true
      const resolvedCustId = data.customerId || customerId
      const resolvedDestId = data.destinationId || destinationId
      if (data.customerId) setCustomerId(data.customerId)
      if (data.destinationId !== undefined) setDestinationId(data.destinationId || '')
      if (data.deliveryDate) setDeliveryDate(data.deliveryDate)
      if (data.shippingTime) setShippingTime(data.shippingTime)
      if (data.note !== undefined) setNote(data.note)
      if (data.originalFile) setOriginalFile(data.originalFile)
      if (data.allParsedOrders) setAllParsedOrders(data.allParsedOrders)
      // 読み取りの入力種類から受注経路を推定（テキスト→LINE、写真→紙）。違えば画面で選び直せる
      const suggested = data.inputKind ? suggestIntakeChannel(data.inputKind) : null
      if (suggested && intakeChannelRef.current !== suggested) {
        intakeChannelRef.current = suggested
        setIntakeChannel(suggested)
        toast(`受注経路を「${suggested === 'line' ? 'LINE' : '紙・口頭'}」にしました（違えば選び直してください）`, { icon: '📮' })
      }

      // 未登録の取引先名が検出された場合、インライン新規取引先登録枠にプリセット
      if (!data.customerId && data.customerNameHint) {
        setNewCustomerName(data.customerNameHint)
        if (data.destinationNameHint) setNewCustomerDestName(data.destinationNameHint)
        setShowNewCustomer(true)
      } else if (data.customerId && !data.destinationId && data.destinationNameHint) {
        setNewDestName(data.destinationNameHint)
        setShowNewDestination(true)
      }

      if (data.items.length > 0) {
        const custName =
          customersList.find((c) => c.id === resolvedCustId)?.name ?? data.customerNameHint ?? ''
        const destName =
          destinationsList.find((d) => d.id === resolvedDestId)?.full_name ?? data.destinationNameHint ?? ''

        setItems(
          data.items.map((it) => {
            const prod = productById.get(it.product_id) ?? defaultMainProduct
            const ppc =
              (it.packs_per_case && it.packs_per_case > 0 ? it.packs_per_case : null) ??
              determineUnitCount(custName, it.spec ?? destName, undefined, it.product_name)
            const totalQty = parseFloat(it.quantity) || 0
            const c =
              it.cases != null && it.cases > 0
                ? it.cases
                : totalQty > 0 && ppc > 0
                ? Math.floor(totalQty / ppc)
                : 0
            const r =
              it.remainder_packs != null && it.remainder_packs > 0
                ? it.remainder_packs
                : totalQty > 0 && ppc > 0
                ? totalQty % ppc
                : 0
            const baseLabel = it.product_name.includes('小松菜') ? '200g' : '2〜3株'
            return {
              product_id: it.product_id || prod?.id || '',
              product_name: it.product_name || prod?.name || '青梗菜',
              quantity: totalQty > 0 ? String(totalQty) : '',
              packs_per_case: ppc,
              cases_input: c > 0 ? String(c) : '',
              loose_input: r > 0 ? String(r) : '',
              unit: it.unit || prod?.unit || '袋',
              unit_price: it.unit_price || String(prod?.default_unit_price ?? 0),
              tax_rate: it.tax_rate || prod?.default_tax_rate || 8,
              photo_url: it.photo_url ?? prod?.photo_url ?? null,
              pack_config_id: it.pack_config_id,
              base_per_selling: it.base_per_selling,
              spec: it.spec || `${baseLabel} (入数${ppc})`,
              container_type: resolveContainerType({
                explicitContainer: it.container_type,
                clientName: custName,
                destination: destName,
              }),
              has_card: determineHasCard({
                explicitHasCard: it.has_card,
                clientName: custName,
                destination: destName,
              }),
            }
          }),
        )
      }
    },
    [customerId, destinationId, customersList, destinationsList, productById, defaultMainProduct],
  )

  // 🏢 インライン新規取引先ワンストップ作成
  async function handleCreateInlineCustomer() {
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
          destination_name: newCustomerDestName.trim() || undefined,
          packs_per_case: newCustomerPacks > 0 ? newCustomerPacks : 20,
          product_id: items[0]?.product_id || defaultMainProduct?.id,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.id) throw new Error(json.error ?? '取引先の作成に失敗しました')

      const createdCust: CustomerOption = {
        id: json.id as string,
        name: (json.name as string) || name,
        display_color: null,
      }
      setCustomersList((prev) =>
        prev.some((c) => c.id === createdCust.id) ? prev : [...prev, createdCust],
      )
      setCustomerId(createdCust.id)

      if (json.destination?.id) {
        const createdDest: DestinationOption = {
          id: json.destination.id as string,
          customer_id: createdCust.id,
          code: json.destination.label as string,
          full_name: json.destination.label as string,
        }
        setDestinationsList((prev) =>
          prev.some((d) => d.id === createdDest.id) ? prev : [...prev, createdDest],
        )
        setDestinationId(createdDest.id)
      }

      setShowNewCustomer(false)
      setNewCustomerName('')
      setNewCustomerDestName('')
      toast.success(`取引先「${createdCust.name}」を登録し選択しました`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '取引先の作成に失敗しました')
    } finally {
      setCreatingCustomer(false)
    }
  }

  // 📍 インライン新規納入先作成
  async function handleCreateInlineDestination() {
    if (!customerId) {
      toast.error('先に取引先を選択してください')
      return
    }
    const name = newDestName.trim()
    if (!name) {
      toast.error('納入先名を入力してください')
      return
    }
    setCreatingDestination(true)
    try {
      const res = await fetch('/api/destinations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          customer_id: customerId,
          code: name,
          full_name: name,
        }),
      })
      const json = await res.json().catch(() => ({}))
      const destObj = res.status === 409 ? json.existing : json.destination
      if (!destObj?.id) throw new Error(json.error ?? '納入先の作成に失敗しました')

      const createdDest: DestinationOption = {
        id: destObj.id as string,
        customer_id: customerId,
        code: (destObj.code as string | null) ?? name,
        full_name: (destObj.full_name as string) || name,
      }
      setDestinationsList((prev) =>
        prev.some((d) => d.id === createdDest.id) ? prev : [...prev, createdDest],
      )
      setDestinationId(createdDest.id)
      setShowNewDestination(false)
      setNewDestName('')
      toast.success(`納入先「${createdDest.full_name}」を登録し選択しました`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '納入先の作成に失敗しました')
    } finally {
      setCreatingDestination(false)
    }
  }

  // 📦 明細行の3連動数量変更ハンドラ（入数・箱数・端数・総数）
  function updateItemPacksPerCase(idx: number, newPacks: number) {
    const ppc = Math.max(1, Math.round(newPacks || 20))
    setItems((prev) =>
      prev.map((it, i) => {
        if (i !== idx) return it
        const cleanedSpec = it.spec.replace(/\s*\(入数\d+\)/g, '').trim() || '2〜3株'
        const nextSpec = `${cleanedSpec} (入数${ppc})`
        const c = parseFloat(it.cases_input)
        const l = parseFloat(it.loose_input) || 0
        if (!isNaN(c) && c > 0) {
          const tot = Math.round(c * ppc + l)
          return { ...it, packs_per_case: ppc, spec: nextSpec, quantity: String(tot) }
        }
        const tot = parseFloat(it.quantity)
        if (!isNaN(tot) && tot > 0) {
          return {
            ...it,
            packs_per_case: ppc,
            spec: nextSpec,
            cases_input: String(Math.floor(tot / ppc)),
            loose_input: tot % ppc > 0 ? String(tot % ppc) : '',
          }
        }
        return { ...it, packs_per_case: ppc, spec: nextSpec }
      }),
    )
  }

  function updateItemCases(idx: number, casesVal: string) {
    setItems((prev) =>
      prev.map((it, i) => {
        if (i !== idx) return it
        const c = parseFloat(casesVal)
        const l = parseFloat(it.loose_input) || 0
        if (!isNaN(c) && c >= 0) {
          const tot = Math.round(c * it.packs_per_case + l)
          return {
            ...it,
            cases_input: casesVal,
            quantity: tot > 0 ? String(tot) : '',
            pack_config_id: null,
            base_per_selling: null,
          }
        }
        return {
          ...it,
          cases_input: '',
          quantity: l > 0 ? String(l) : '',
        }
      }),
    )
  }

  function updateItemLoose(idx: number, looseVal: string) {
    setItems((prev) =>
      prev.map((it, i) => {
        if (i !== idx) return it
        const c = parseFloat(it.cases_input) || 0
        const l = parseFloat(looseVal)
        const validL = !isNaN(l) && l >= 0 ? l : 0
        const tot = Math.round(c * it.packs_per_case + validL)
        return {
          ...it,
          loose_input: looseVal,
          quantity: tot > 0 ? String(tot) : '',
          pack_config_id: null,
          base_per_selling: null,
        }
      }),
    )
  }

  function updateItemTotalQuantity(idx: number, totalVal: string) {
    setItems((prev) =>
      prev.map((it, i) => {
        if (i !== idx) return it
        const tot = parseFloat(totalVal)
        if (!isNaN(tot) && tot >= 0 && !it.pack_config_id) {
          const ppc = it.packs_per_case > 0 ? it.packs_per_case : 20
          const c = Math.floor(tot / ppc)
          const r = tot % ppc
          return {
            ...it,
            quantity: totalVal,
            cases_input: c > 0 ? String(c) : '',
            loose_input: r > 0 ? String(r) : '',
          }
        }
        return { ...it, quantity: totalVal, cases_input: '', loose_input: '' }
      }),
    )
  }

  function updateItemField<K extends keyof FormItem>(idx: number, field: K, value: FormItem[K]) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, [field]: value } : it)))
  }

  function removeItem(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx))
  }

  function addProduct() {
    const targetId = addProductId || defaultMainProduct?.id
    if (!targetId) return
    const p = productById.get(targetId)
    if (!p) return
    setItems((prev) => [...prev, buildDefaultFormItem(p, customerId, destinationId)])
    setAddProductId('')
    setShowAddProduct(false)
  }

  /** 荷姿選択時は「販売単位数 × base_per_selling」で総数（基準単位）に換算。3連動モードは quantity そのまま。 */
  function resolveQuantity(it: FormItem): number {
    const raw = parseFloat(it.quantity)
    if (isNaN(raw) || raw <= 0) return 0
    if (it.pack_config_id && it.base_per_selling && it.base_per_selling > 0) {
      return Math.round(raw * it.base_per_selling)
    }
    return Math.round(raw)
  }

  /** 行の荷姿を切り替える（pack_config_id と base_per_selling・入数を連動更新）。 */
  function setItemPack(idx: number, packId: string) {
    setItems((prev) =>
      prev.map((it, i) => {
        if (i !== idx) return it
        if (!packId) return { ...it, pack_config_id: null, base_per_selling: null }
        const opt = (packsByProduct[it.product_id] ?? []).find((o) => o.id === packId)
        const base = opt?.base_per_selling ?? it.packs_per_case
        return {
          ...it,
          pack_config_id: packId,
          base_per_selling: opt?.base_per_selling ?? null,
          packs_per_case: base,
          spec: opt?.label || it.spec,
        }
      }),
    )
  }

  const hasExistingOrder = Object.keys(existingItemsMap).length > 0

  const canProceed =
    Boolean(customerId) &&
    Boolean(deliveryDate) &&
    items.length > 0 &&
    items.some((it) => resolveQuantity(it) > 0)

  // 保存実行（通常・合算・上書き・別便追加に対応）
  async function handleSave(
    overrideMode?:
      | 'normal'
      | 'add_anyway'
      | { mergeOrderId: string }
      | { replaceOrderId: string; expectedUpdatedAt?: string },
  ) {
    const validItems = items.filter((it) => resolveQuantity(it) > 0)
    if (!customerId) {
      toast.error('取引先を選択してください')
      return
    }
    if (!deliveryDate) {
      toast.error('出荷日を入力してください')
      return
    }
    if (validItems.length === 0) {
      toast.error('数量を1以上入力してください')
      return
    }

    setSaving(true)
    try {
      const payload: Record<string, unknown> = {
        customer_id: customerId,
        destination_id: destinationId || undefined,
        delivery_date: deliveryDate,
        shipping_time: shippingTime || undefined,
        intake_channel: intakeChannel ?? undefined,
        note: note || undefined,
        items: validItems.map((it) => ({
          product_id: it.product_id,
          product_name: it.product_name,
          quantity: resolveQuantity(it),
          unit: it.unit,
          unit_price: parseFloat(it.unit_price) || 0,
          tax_rate: it.tax_rate,
          pack_config_id: it.pack_config_id ?? undefined,
          packs_per_case: it.packs_per_case > 0 ? it.packs_per_case : undefined,
          spec: it.spec.trim() || undefined,
          container_type: it.container_type.trim() || undefined,
          has_card: it.has_card,
        })),
        original_file: originalFile ?? undefined,
      }

      if (overrideMode === 'add_anyway' || (!overrideMode && hasExistingOrder && duplicateAction === 'add_anyway')) {
        payload.confirm_duplicate = true
      } else if (typeof overrideMode === 'object' && 'mergeOrderId' in overrideMode) {
        payload.merge_order_id = overrideMode.mergeOrderId
      } else if (typeof overrideMode === 'object' && 'replaceOrderId' in overrideMode) {
        payload.replace_order_id = overrideMode.replaceOrderId
        if (overrideMode.expectedUpdatedAt) payload.expected_updated_at = overrideMode.expectedUpdatedAt
      }

      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = (await res.json().catch(() => ({}))) as {
        orderId?: string
        replaced?: boolean
        merged?: boolean
        duplicate?: boolean
        conflict?: boolean
        existing?: Array<{ id: string; created_at: string; updated_at: string; item_count: number }>
        error?: string
        warnings?: Record<string, unknown>
      }

      // 409 duplicate: 既存注文が見つかった場合
      if (res.status === 409 && json.duplicate && json.existing && json.existing.length > 0) {
        const firstExisting = json.existing[0]!
        // ユーザーが画面上で既に「合算」または「上書き」を選択していた場合は確認モーダルを出さず自動解決
        if (!overrideMode && hasExistingOrder && json.existing.length === 1) {
          if (duplicateAction === 'merge') {
            setSaving(false)
            await handleSave({ mergeOrderId: firstExisting.id })
            return
          }
          if (duplicateAction === 'replace') {
            setSaving(false)
            await handleSave({ replaceOrderId: firstExisting.id, expectedUpdatedAt: firstExisting.updated_at })
            return
          }
        }
        setDupExistingOrders(json.existing)
        setDupModalOpen(true)
        return
      }

      if (res.status === 409 && json.conflict) {
        toast.error(json.error ?? '他の人がこの注文を変更しました。再度お試しください。')
        router.refresh()
        return
      }

      if (!res.ok) throw new Error(json.error ?? `登録失敗 (${res.status})`)

      const warnCount = Object.keys(json.warnings ?? {}).length
      if (warnCount > 0) {
        toast(`登録しました（数量に${warnCount}件の注意あり）`, { icon: '⚠️' })
      } else if (json.merged) {
        toast.success('既存の注文に数量を合算し、収穫タスクを同期しました！')
      } else if (json.replaced) {
        toast.success('既存の注文を上書き更新し、収穫タスクを同期しました！')
      } else {
        toast.success('注文を登録しました（出荷ボード・収穫タスクに反映済み）')
      }

      router.push(`/field/shipments?date=${deliveryDate}`)
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '登録に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  // 📄 AIスマート読取で複数注文が検出された場合の一括登録
  async function handleBatchSaveAllParsedOrders() {
    if (allParsedOrders.length <= 1) return
    setBatchSaving(true)
    let savedCount = 0
    const errors: string[] = []
    const currentCusts = [...customersList]
    const currentDests = [...destinationsList]

    try {
      for (let i = 0; i < allParsedOrders.length; i++) {
        const ord = allParsedOrders[i]!
        const ordDate = ord.delivery_date && ord.delivery_date >= today ? ord.delivery_date : deliveryDate

        // 1. 取引先解決（無ければ現在選択中または自動作成）
        let matchedCust = findBestMatchingCustomer(ord.customer_name, currentCusts)
        if (!matchedCust && customerId) {
          matchedCust = currentCusts.find((c) => c.id === customerId)
        }
        if (!matchedCust && ord.customer_name?.trim()) {
          const cr = await fetch('/api/customers/quick', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: ord.customer_name.trim() }),
          })
          const cj = await cr.json().catch(() => ({}))
          if (cr.ok && cj.id) {
            const newC: CustomerOption = { id: cj.id, name: cj.name || ord.customer_name.trim(), display_color: null }
            currentCusts.push(newC)
            matchedCust = newC
          }
        }
        if (!matchedCust) {
          errors.push(`注文${i + 1}: 取引先が特定できません`)
          continue
        }

        // 2. 納入先解決（未登録なら自動作成）
        let matchedDest = findBestMatchingDestination(ord.destination_name, currentDests, matchedCust.id)
        if (!matchedDest && ord.destination_name?.trim()) {
          const dName = ord.destination_name.trim()
          const dr = await fetch('/api/destinations', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ customer_id: matchedCust.id, code: dName, full_name: dName }),
          })
          const dj = await dr.json().catch(() => ({}))
          const destObj = dr.status === 409 ? dj.existing : dj.destination
          if (destObj?.id) {
            const newD: DestinationOption = {
              id: destObj.id,
              customer_id: matchedCust.id,
              code: destObj.code ?? dName,
              full_name: destObj.full_name ?? dName,
            }
            currentDests.push(newD)
            matchedDest = newD
          }
        }

        // 3. 明細構築
        const batchItems = ord.items
          .map((it) => {
            const prod =
              products.find((p) => p.name === it.product_name) ??
              products.find((p) => p.name.includes('青梗菜') || p.name.includes('チンゲン')) ??
              defaultMainProduct
            const qty = parseFloat(String(it.quantity)) || 0
            if (!prod || qty <= 0) return null
            const ppc =
              it.packs_per_case ??
              determineUnitCount(matchedCust!.name, it.spec ?? ord.destination_name, undefined, prod.name)
            return {
              product_id: prod.id,
              product_name: prod.name,
              quantity: Math.round(qty),
              unit: prod.unit || '袋',
              unit_price: prod.default_unit_price ?? 0,
              tax_rate: prod.default_tax_rate ?? 8,
              packs_per_case: ppc,
              spec: it.spec ?? undefined,
              container_type: resolveContainerType({
                explicitContainer: it.container_type,
                clientName: matchedCust!.name,
                destination: matchedDest?.full_name,
              }),
              has_card: determineHasCard({
                explicitHasCard: it.has_card,
                clientName: matchedCust!.name,
                destination: matchedDest?.full_name,
              }),
            }
          })
          .filter((x): x is NonNullable<typeof x> => x !== null)

        if (batchItems.length === 0) continue

        // 4. 保存（既存があれば自動合算）
        const res = await fetch('/api/orders', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            customer_id: matchedCust.id,
            destination_id: matchedDest?.id || undefined,
            delivery_date: ordDate,
            shipping_time: shippingTime || undefined,
            intake_channel: intakeChannel ?? undefined,
            note: ord.note || note || undefined,
            items: batchItems,
            original_file: i === 0 ? originalFile ?? undefined : undefined,
          }),
        })
        const rj = await res.json().catch(() => ({}))
        if (res.status === 409 && rj.duplicate && rj.existing?.[0]?.id) {
          const mergeRes = await fetch('/api/orders', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              customer_id: matchedCust.id,
              destination_id: matchedDest?.id || undefined,
              delivery_date: ordDate,
              shipping_time: shippingTime || undefined,
              note: ord.note || note || undefined,
              items: batchItems,
              merge_order_id: rj.existing[0].id,
            }),
          })
          if (mergeRes.ok) savedCount++
          else errors.push(`注文${i + 1}: 合算に失敗しました`)
        } else if (res.ok) {
          savedCount++
        } else {
          errors.push(`注文${i + 1}: ${rj.error ?? '保存失敗'}`)
        }
      }

      setCustomersList(currentCusts)
      setDestinationsList(currentDests)

      if (errors.length > 0) {
        toast.error(`一部登録失敗 (${errors.length}件): ${errors.join(' / ')}`)
      }
      if (savedCount > 0) {
        toast.success(`✨ 全 ${savedCount} 件の注文を一括登録しました！`)
        router.push(`/field/shipments?date=${deliveryDate}`)
        router.refresh()
      }
    } finally {
      setBatchSaving(false)
    }
  }

  const inputCls =
    'h-10 w-full rounded border border-line-strong bg-bg-card px-3 text-sm text-ink focus:outline-none focus:border-trust-500 focus:ring-2 focus:ring-trust-100'

  // ───── 確認画面 ─────
  if (step === 'confirm') {
    const validConfirmItems = items.filter((it) => resolveQuantity(it) > 0)
    return (
      <div className="space-y-4">
        <h2 className="font-display text-lg font-bold text-ink">登録内容の最終確認</h2>
        <div className="rounded-xl border border-line bg-bg-soft p-4 space-y-3 shadow-xs">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <ColorDot color={selectedCustomer?.display_color ?? null} name={selectedCustomer?.name ?? ''} size="md" />
              <span className="font-bold text-ink text-base">{selectedCustomer?.name}</span>
            </div>
            {hasExistingOrder && (
              <span className="rounded-full bg-amber-100 border border-amber-300 px-2.5 py-0.5 text-xs font-bold text-amber-900">
                {duplicateAction === 'merge'
                  ? '⚡ 既存注文に合算（追加）'
                  : duplicateAction === 'replace'
                  ? '🔄 既存注文を上書き'
                  : '✨ 別便として新規登録'}
              </span>
            )}
          </div>

          {selectedDestination && (
            <p className="text-sm text-ink font-bold flex items-center gap-1.5">
              <span>📍 納入先:</span>
              <span className="text-emerald-800">{selectedDestination.full_name}</span>
              {selectedDestination.code && selectedDestination.code !== selectedDestination.full_name && (
                <span className="text-xs text-ink-muted">({selectedDestination.code})</span>
              )}
            </p>
          )}

          <p className="text-sm text-ink-soft">
            出荷日: <span className="font-bold text-ink">{formatJpDateShort(deliveryDate)}</span>
            {shippingTime && (
              <span className="ml-2 font-medium text-ink-soft">({shippingTime === 'am' ? '午前便' : '午後便'})</span>
            )}
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
            {validConfirmItems.map((it, idx) => {
              const qty = resolveQuantity(it)
              const st = stats[it.product_id]
              const prevQty = existingItemsMap[it.product_id]
              const cases = it.packs_per_case > 0 ? Math.floor(qty / it.packs_per_case) : 0
              const rem = it.packs_per_case > 0 ? qty % it.packs_per_case : 0
              return (
                <div key={`${it.product_id}-${idx}`} className="flex items-center gap-3 py-2.5">
                  {it.photo_url && (
                    <Image
                      src={it.photo_url}
                      alt=""
                      width={40}
                      height={40}
                      className="h-10 w-10 rounded object-cover shrink-0"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-ink">{it.product_name}</p>
                    <p className="text-xs text-ink-soft">
                      {it.spec} ・ {it.container_type} ・ {it.has_card ? 'カードあり' : 'カードなし'}
                    </p>
                    {prevQty != null && (
                      <p className="text-xs font-bold text-amber-800 mt-0.5">
                        現在登録済: {prevQty} {it.unit}{' '}
                        {duplicateAction === 'merge'
                          ? `➔ 合算後: ${prevQty + qty} ${it.unit}`
                          : duplicateAction === 'replace'
                          ? `➔ 上書き後: ${qty} ${it.unit}`
                          : `（別便として +${qty} ${it.unit}）`}
                      </p>
                    )}
                    {st && <AnomalyBadge qty={qty} stats={st} />}
                  </div>
                  <div className="text-right shrink-0">
                    <span className="num text-lg font-black tabular-nums text-ink block">
                      {qty} {it.unit}
                    </span>
                    {it.packs_per_case > 0 && (
                      <span className="text-xs font-bold text-forest-800">
                        （{cases}箱{rem > 0 ? `+端数${rem}` : ''} / {it.packs_per_case}入）
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
          {note && <p className="text-xs text-ink-soft border-t border-line pt-2">備考: {note}</p>}
        </div>
        <div className="flex gap-3 justify-end">
          <Button variant="secondary" onClick={() => setStep('entry')} disabled={saving}>
            戻って修正
          </Button>
          <Button variant="primary" onClick={() => void handleSave()} isLoading={saving}>
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
        customers={customersList}
        destinations={destinationsList}
        products={products}
        selectedCustomerId={customerId}
        onOrderResolved={handleOrderResolved}
        onCustomerCreated={(newCust) => {
          setCustomersList((prev) =>
            prev.some((c) => c.id === newCust.id)
              ? prev
              : [...prev, { ...newCust, display_color: null }],
          )
          setCustomerId(newCust.id)
          setShowNewCustomer(false)
        }}
        onDestinationCreated={(newDest) => {
          setDestinationsList((prev) =>
            prev.some((d) => d.id === newDest.id)
              ? prev
              : [...prev, { ...newDest, code: newDest.code ?? null }],
          )
          setDestinationId(newDest.id)
          setShowNewDestination(false)
        }}
      />

      {/* 複数注文検出時のワンタップ一括登録ボタン */}
      {allParsedOrders.length > 1 && (
        <div className="rounded-xl border-2 border-emerald-300 bg-emerald-50/80 p-3 flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs font-bold text-emerald-950">
            📑 伝票から <span className="font-black underline">{allParsedOrders.length}件</span> の注文が検出されています
          </div>
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={() => void handleBatchSaveAllParsedOrders()}
            isLoading={batchSaving}
            className="bg-emerald-600 hover:bg-emerald-700 text-white font-black"
          >
            {batchSaving ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>一括登録中...</span>
              </>
            ) : (
              <>
                <Sparkles className="h-3.5 w-3.5" />
                <span>✨ 検出された全 {allParsedOrders.length} 件をまとめて一括登録する</span>
              </>
            )}
          </Button>
        </div>
      )}

      <div className="pt-2 border-t border-line/60">
        <h3 className="text-xs font-black text-ink-muted uppercase tracking-wider mb-3">
          📝 注文内容の確認・手動調整
        </h3>

        {/* 取引先・出荷日 */}
        <div className="grid gap-4 sm:grid-cols-2">
          {/* 取引先 */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-ink" htmlFor="order-customer">
                取引先 <span className="text-alert">*</span>
              </label>
              <button
                type="button"
                onClick={() => setShowNewCustomer((v) => !v)}
                className="inline-flex items-center gap-1 text-xs font-bold text-forest-700 hover:underline"
              >
                <UserPlus className="h-3.5 w-3.5" />
                {showNewCustomer ? '閉じる' : '＋ 新規取引先を追加'}
              </button>
            </div>
            <div className="relative">
              <select
                id="order-customer"
                value={customerId}
                onChange={(e) => handleCustomerChange(e.target.value)}
                className={cn(inputCls, customerId ? 'pl-8' : '')}
              >
                <option value="">取引先を選択…</option>
                {customersList.map((c) => (
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
            {customerId && (
              <button
                type="button"
                onClick={copyLastOrder}
                disabled={copyingLast}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-line bg-bg-card px-3 text-sm font-bold text-ink hover:bg-bg-soft focus:outline-none focus:ring-2 focus:ring-trust-500 focus:ring-offset-2 disabled:opacity-60"
              >
                {copyingLast ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <History className="h-4 w-4" aria-hidden />}
                前回と同じ内容を入れる
              </button>
            )}
          </div>

          {/* 出荷日 */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-ink" htmlFor="order-delivery-date">
                出荷日 <span className="text-alert">*</span>
              </label>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setDeliveryDate(tomorrow)
                    setShippingTime('am')
                  }}
                  className={cn(
                    'rounded-md px-2 py-0.5 text-xs font-bold transition-colors',
                    deliveryDate === tomorrow && shippingTime === 'am'
                      ? 'bg-forest-600 text-white shadow-2xs'
                      : 'bg-sand-100 text-ink hover:bg-sand-200',
                  )}
                >
                  🌅 明日朝
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDeliveryDate(tomorrow)
                    setShippingTime('pm')
                  }}
                  className={cn(
                    'rounded-md px-2 py-0.5 text-xs font-bold transition-colors',
                    deliveryDate === tomorrow && shippingTime === 'pm'
                      ? 'bg-forest-600 text-white shadow-2xs'
                      : 'bg-sand-100 text-ink hover:bg-sand-200',
                  )}
                >
                  ☀️ 明日昼
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDeliveryDate(dayAfterTomorrow)
                    setShippingTime('am')
                  }}
                  className={cn(
                    'rounded-md px-2 py-0.5 text-xs font-bold transition-colors',
                    deliveryDate === dayAfterTomorrow
                      ? 'bg-forest-600 text-white shadow-2xs'
                      : 'bg-sand-100 text-ink hover:bg-sand-200',
                  )}
                >
                  📅 明後日
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDeliveryDate(today)
                    setShippingTime('')
                  }}
                  className={cn(
                    'rounded-md px-2 py-0.5 text-xs font-bold transition-colors',
                    deliveryDate === today
                      ? 'bg-forest-600 text-white shadow-2xs'
                      : 'bg-sand-100 text-ink hover:bg-sand-200',
                  )}
                >
                  🚚 今日
                </button>
              </div>
            </div>
            <input
              id="order-delivery-date"
              type="date"
              value={deliveryDate}
              onChange={(e) => setDeliveryDate(e.target.value)}
              className={inputCls}
            />
          </div>
        </div>

        {/* 🏢 インライン新規取引先作成フォーム */}
        {showNewCustomer && (
          <div className="mt-3 rounded-xl border-2 border-forest-300 bg-forest-50/70 p-3.5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-black text-forest-950">
                ✨ 新規取引先のワンストップ登録（納入先・入数も同時設定可）
              </span>
              <button
                type="button"
                onClick={() => setShowNewCustomer(false)}
                className="text-xs text-ink-muted hover:text-ink"
              >
                ✕ 閉じる
              </button>
            </div>
            <div className="grid gap-2.5 sm:grid-cols-3">
              <div>
                <label className="block text-[11px] font-bold text-ink mb-1">取引先名（必須）</label>
                <input
                  type="text"
                  value={newCustomerName}
                  onChange={(e) => setNewCustomerName(e.target.value)}
                  placeholder="例: 株式会社 勘兵衛"
                  className={cn(inputCls, 'h-9 text-xs bg-white')}
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-ink mb-1">納入先・店舗名（任意）</label>
                <input
                  type="text"
                  value={newCustomerDestName}
                  onChange={(e) => setNewCustomerDestName(e.target.value)}
                  placeholder="例: イオンタウン向け"
                  className={cn(inputCls, 'h-9 text-xs bg-white')}
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-ink mb-1">標準入数（P/箱）</label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    min={1}
                    value={newCustomerPacks}
                    onChange={(e) => setNewCustomerPacks(Math.max(1, Number(e.target.value) || 20))}
                    className={cn(inputCls, 'h-9 text-xs bg-white w-20')}
                  />
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void handleCreateInlineCustomer()}
                    isLoading={creatingCustomer}
                    disabled={!newCustomerName.trim()}
                    className="h-9 text-xs shrink-0"
                  >
                    登録して選択
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 受注経路（電話・LINE・紙）— 評価指標「紙の卒業」の計測用 */}
        <IntakeChannelPicker value={intakeChannel} onChange={setIntakeChannel} className="mt-4" />

        {/* 納入先（届け先） ＆ 出荷時間帯 */}
        <div className="grid gap-4 sm:grid-cols-2 mt-4">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-ink" htmlFor="order-destination">
                納入先（店舗・センター）
              </label>
              {customerId && (
                <button
                  type="button"
                  onClick={() => setShowNewDestination((v) => !v)}
                  className="inline-flex items-center gap-0.5 text-xs font-bold text-forest-700 hover:underline"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {showNewDestination ? '閉じる' : '新しい納入先を追加'}
                </button>
              )}
            </div>
            <select
              id="order-destination"
              value={destinationId}
              onChange={(e) => handleDestinationChange(e.target.value)}
              className={inputCls}
            >
              <option value="">指定なし（取引先標準）</option>
              {customerDestinations.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.full_name} {d.code && d.code !== d.full_name ? `(${d.code})` : ''}
                </option>
              ))}
            </select>

            {showNewDestination && customerId && (
              <div className="mt-2 flex items-center gap-2 rounded-lg border border-forest-300 bg-forest-50/70 p-2">
                <input
                  type="text"
                  value={newDestName}
                  onChange={(e) => setNewDestName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      void handleCreateInlineDestination()
                    }
                  }}
                  placeholder="新しい納入先・店舗・便名を入力..."
                  className={cn(inputCls, 'h-8 text-xs bg-white flex-1')}
                />
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void handleCreateInlineDestination()}
                  isLoading={creatingDestination}
                  disabled={!newDestName.trim()}
                  className="h-8 text-xs shrink-0"
                >
                  追加
                </Button>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-ink" htmlFor="order-shipping-time">
              出荷時間帯
            </label>
            <select
              id="order-shipping-time"
              value={shippingTime}
              onChange={(e) => setShippingTime(e.target.value as 'am' | 'pm' | '')}
              className={cn(inputCls, 'w-full sm:w-48')}
            >
              <option value="">指定なし</option>
              <option value="am">🌅 午前便 (am)</option>
              <option value="pm">☀️ 午後便 (pm)</option>
            </select>
          </div>
        </div>
      </div>

      {/* 💡 同一（取引先×納入先×出荷日）に既存注文がある場合のリアルタイム案内バナー */}
      {hasExistingOrder && (
        <div className="rounded-xl border-2 border-amber-300 bg-amber-50/90 p-3.5 space-y-2 shadow-2xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-black text-amber-950 flex items-center gap-1.5">
              <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
              <span>
                この取引先・納入先・出荷日（{formatJpDateShort(deliveryDate)}）には既に注文が登録されています
              </span>
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
            <button
              type="button"
              onClick={() => setDuplicateAction('merge')}
              className={cn(
                'rounded-lg py-1.5 px-2.5 text-xs font-black border transition',
                duplicateAction === 'merge'
                  ? 'border-forest-700 bg-forest-700 text-white shadow-2xs'
                  : 'border-amber-300 bg-white text-amber-950 hover:bg-amber-100',
              )}
            >
              ⚡ 既存注文に合算（追加）
            </button>
            <button
              type="button"
              onClick={() => setDuplicateAction('replace')}
              className={cn(
                'rounded-lg py-1.5 px-2.5 text-xs font-black border transition',
                duplicateAction === 'replace'
                  ? 'border-amber-700 bg-amber-700 text-white shadow-2xs'
                  : 'border-amber-300 bg-white text-amber-950 hover:bg-amber-100',
              )}
            >
              🔄 既存注文を上書き（訂正）
            </button>
            <button
              type="button"
              onClick={() => setDuplicateAction('add_anyway')}
              className={cn(
                'rounded-lg py-1.5 px-2.5 text-xs font-black border transition',
                duplicateAction === 'add_anyway'
                  ? 'border-trust-700 bg-trust-700 text-white shadow-2xs'
                  : 'border-amber-300 bg-white text-amber-950 hover:bg-amber-100',
              )}
            >
              ✨ 別便として新規追加
            </button>
          </div>
        </div>
      )}

      {/* 商品・数量明細リスト（取引先未選択時でも常時表示して即時入力・AI確認可能） */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-ink">
            品目・数量明細
            {items.length > 0 && (
              <span className="ml-1.5 text-ink-soft font-normal">{items.length}件</span>
            )}
          </h2>
          {!customerId && (
            <span className="text-xs font-bold text-amber-700">
              ※ 保存前に上の「取引先」を選択（または新規追加）してください
            </span>
          )}
        </div>

        <div className="space-y-3">
          {items.map((it, idx) => {
            const qty = resolveQuantity(it)
            const st = stats[it.product_id]
            const prevQty = existingItemsMap[it.product_id]
            const applicablePacks = (packsByProduct[it.product_id] ?? []).filter(
              (o) => !o.customer_id || o.customer_id === customerId,
            )
            return (
              <div
                key={`${it.product_id}-${idx}`}
                className="rounded-xl border border-line bg-bg-card p-3.5 shadow-xs space-y-3"
              >
                {/* 1段目: 品目選択 ＋ 荷姿選択 ＋ 削除ボタン */}
                <div className="flex items-center gap-3">
                  {it.photo_url ? (
                    <Image
                      src={it.photo_url}
                      alt=""
                      width={40}
                      height={40}
                      className="h-10 w-10 rounded object-cover shrink-0"
                    />
                  ) : (
                    <div className="h-10 w-10 shrink-0 rounded bg-bg-soft flex items-center justify-center text-ink-faint text-sm">
                      🥬
                    </div>
                  )}

                  <div className="flex-1 min-w-0 grid gap-2 sm:grid-cols-2">
                    <select
                      value={it.product_id}
                      onChange={(e) => {
                        const newProd = productById.get(e.target.value)
                        if (!newProd) return
                        setItems((prev) =>
                          prev.map((row, rIdx) =>
                            rIdx === idx
                              ? buildDefaultFormItem(newProd, customerId, destinationId, row.quantity)
                              : row,
                          ),
                        )
                      }}
                      className="h-9 rounded-lg border border-line-strong bg-white px-2.5 text-sm font-bold text-ink focus:outline-none focus:border-trust-500"
                      aria-label="品目を選択"
                    >
                      {groupByCategory(products).map((g) => (
                        <optgroup key={g.group} label={g.group}>
                          {g.items.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}（{p.unit}）
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>

                    {applicablePacks.length > 0 ? (
                      <select
                        value={it.pack_config_id ?? ''}
                        onChange={(e) => setItemPack(idx, e.target.value)}
                        className="h-9 rounded-lg border border-line bg-bg-soft/60 px-2 text-xs font-medium text-ink focus:outline-none focus:border-trust-500"
                        aria-label={`${it.product_name}の荷姿マスタ`}
                      >
                        <option value="">標準（箱数×入数 / 総数入力）</option>
                        {applicablePacks.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.label}（{o.selling_unit_label} ×{o.base_per_selling}）
                          </option>
                        ))}
                      </select>
                    ) : (
                      <div className="flex items-center gap-1.5 text-xs text-ink-soft">
                        <span className="font-bold">容器:</span>
                        <select
                          value={it.container_type}
                          onChange={(e) => updateItemField(idx, 'container_type', e.target.value)}
                          className="h-9 flex-1 rounded-lg border border-line bg-white px-2 text-xs font-bold text-ink"
                        >
                          {['青コン', '茶コン', '房総青コン', '農業総研専用折りたたみコンテナ', '緑コン'].map(
                            (ct) => (
                              <option key={ct} value={ct}>
                                {ct}
                              </option>
                            ),
                          )}
                        </select>
                      </div>
                    )}
                  </div>

                  {items.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeItem(idx)}
                      aria-label={`${it.product_name}を削除`}
                      className="p-1.5 text-ink-faint hover:text-alert rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-alert"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </button>
                  )}
                </div>

                {/* 2段目: 3連動数量エディタ（①入数 × ②箱数 ＋ ③端数 ＝ ④総数） */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 rounded-xl bg-bg-soft/70 p-2.5 border border-line/80">
                  {/* ① 1箱の入数 */}
                  <div>
                    <label className="block text-[10px] font-bold text-ink-muted mb-1">
                      ① 1箱の入数 (P/箱)
                    </label>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min={1}
                        value={it.packs_per_case}
                        onChange={(e) => updateItemPacksPerCase(idx, Number(e.target.value))}
                        className="num h-9 w-full rounded border border-line bg-white px-2 text-center text-sm font-bold text-ink"
                      />
                      <button
                        type="button"
                        onClick={() => updateItemPacksPerCase(idx, it.packs_per_case === 20 ? 24 : 20)}
                        className="h-9 px-1.5 rounded border border-line bg-white text-[10px] font-bold text-ink-soft hover:bg-sand-100 shrink-0"
                        title="20入 / 24入 切替"
                      >
                        {it.packs_per_case === 20 ? '24入' : '20入'}
                      </button>
                    </div>
                  </div>

                  {/* ② 箱数（ケース） */}
                  <div>
                    <label className="block text-[10px] font-bold text-forest-900 mb-1">
                      ② 箱数（ケース）
                    </label>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      placeholder="例: 5"
                      value={it.cases_input}
                      onChange={(e) => updateItemCases(idx, e.target.value)}
                      className="num h-9 w-full rounded border-2 border-forest-300 bg-white px-2 text-center text-base font-black text-forest-900 focus:border-forest-600 focus:outline-none"
                    />
                  </div>

                  {/* ③ 端数（バラ） */}
                  <div>
                    <label className="block text-[10px] font-bold text-ink-muted mb-1">
                      ③ 端数（バラ {it.unit}）
                    </label>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      placeholder="0"
                      value={it.loose_input}
                      onChange={(e) => updateItemLoose(idx, e.target.value)}
                      className="num h-9 w-full rounded border border-line bg-white px-2 text-center text-sm font-bold text-ink focus:border-trust-500 focus:outline-none"
                    />
                  </div>

                  {/* ④ 総数（基準単位） */}
                  <div>
                    <label className="block text-[10px] font-bold text-emerald-950 mb-1">
                      ④ 総数（合計 {it.unit}）*
                    </label>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        placeholder="例: 100"
                        value={it.quantity}
                        onChange={(e) => updateItemTotalQuantity(idx, e.target.value)}
                        className="num h-9 w-full rounded border-2 border-emerald-500 bg-emerald-50/40 px-2 text-center text-base font-black text-emerald-950 focus:border-emerald-600 focus:outline-none"
                        aria-label={`${it.product_name}の数量`}
                      />
                      <span className="text-xs font-bold text-ink-soft shrink-0">{it.unit}</span>
                    </div>
                  </div>
                </div>

                {/* 3段目: 規格・カード・既存注文比較・異常値バッジ */}
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      value={it.spec}
                      onChange={(e) => updateItemField(idx, 'spec', e.target.value)}
                      placeholder="規格（例: 2〜3株 (入数20)）"
                      className="h-7 w-44 rounded border border-line bg-white px-2 text-xs font-medium text-ink"
                    />
                    <button
                      type="button"
                      onClick={() => updateItemField(idx, 'has_card', !it.has_card)}
                      className={cn(
                        'h-7 rounded px-2 text-xs font-bold border transition',
                        it.has_card
                          ? 'border-emerald-400 bg-emerald-50 text-emerald-900'
                          : 'border-line bg-white text-ink-muted',
                      )}
                    >
                      {it.has_card ? '🏷 カードあり' : 'カードなし'}
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {prevQty != null && (
                      <span className="rounded bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-900">
                        現在登録済: {prevQty} {it.unit}
                      </span>
                    )}
                    {st && qty > 0 && <AnomalyBadge qty={qty} stats={st} />}
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {/* 明細行追加 */}
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
                {groupByCategory(products).map((g) => (
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
                onClick={() => {
                  setShowAddProduct(false)
                  setAddProductId('')
                }}
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
              品目行を追加
            </button>
          )}
        </div>
      </div>

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

      {/* 重複注文の解決モーダル（409発生時の3択フォールバック） */}
      <Modal
        open={dupModalOpen}
        onClose={() => setDupModalOpen(false)}
        title="同じ取引先・納品日の注文が既に存在します"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setDupModalOpen(false)} disabled={saving}>
              キャンセル
            </Button>
            <Button
              variant="secondary"
              size="sm"
              isLoading={saving}
              onClick={() => {
                setDupModalOpen(false)
                void handleSave('add_anyway')
              }}
            >
              別便の注文として新規追加
            </Button>
            {dupExistingOrders.length >= 1 && (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  isLoading={saving}
                  onClick={() => {
                    const target = dupExistingOrders[0]!
                    setDupModalOpen(false)
                    void handleSave({ replaceOrderId: target.id, expectedUpdatedAt: target.updated_at })
                  }}
                >
                  既存を上書き（訂正）
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  isLoading={saving}
                  onClick={() => {
                    const target = dupExistingOrders[0]!
                    setDupModalOpen(false)
                    void handleSave({ mergeOrderId: target.id })
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
            <strong className="text-ink">{selectedCustomer?.name}</strong>
            {selectedDestination ? ` ＞ ${selectedDestination.full_name}` : ''} の{' '}
            <strong className="text-ink">{formatJpDate(deliveryDate)}</strong> 納品分の注文が既に{' '}
            <strong className="text-ink">{dupExistingOrders.length}件</strong> あります。どのように処理しますか？
          </p>
          <ul className="list-disc pl-5 text-xs space-y-1 text-ink">
            <li>
              <strong>既存注文に合算（追加）</strong>：登録済みの数量に今回の数量を足し合わせます（追加発注のとき）
            </li>
            <li>
              <strong>既存を上書き（訂正）</strong>：登録済みの明細を今回の内容で置き換えます（FAX訂正・再送のとき）
            </li>
            <li>
              <strong>別便の注文として新規追加</strong>：既存の注文とは別の注文カードとして並存させます
            </li>
          </ul>
        </div>
      </Modal>
    </div>
  )
}
