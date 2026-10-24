'use client'

import { useEffect, useMemo, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import {
  Plus,
  ArrowRight,
  UserPlus,
  Check,
  Sparkles,
  Camera,
  Image as ImageIcon,
  FileText,
  Clipboard,
  X,
  Loader2,
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { parseQuantity } from '@/lib/calculations/parse-quantity'
import { fieldErrorMessage } from '@/lib/field/net-error'
import { cn } from '@/lib/cn'

export interface ShipmentAddFormProps {
  deliveryDate: string
  customers: { id: string; name: string }[]
  products: { id: string; name: string; unit: string; category?: string | null }[]
  /** 取引先配下の納入先（届け先） */
  destinations: { id: string; customerId: string; label: string }[]
  /** `${customer_id}:${product_id}` → packs_per_case（c記法プレビュー用） */
  packsByPair: Record<string, number | null>
}

type LocalCustomer = { id: string; name: string }
type LocalProduct = { id: string; name: string; unit: string; category?: string | null }

const UNGROUPED_LABEL = 'その他'
const CATEGORY_PRIORITY = ['チンゲン菜', 'キュウリ', 'トマト', 'ネギ']

function resolveProductCategory(p: { name: string; category?: string | null }): string {
  const cat = p.category?.trim()
  if (cat) return cat
  const name = p.name
  if (/キュウリ|胡瓜/.test(name)) return 'キュウリ'
  if (/青梗菜|チンゲン|ちんげん/.test(name)) return 'チンゲン菜'
  if (/トマト/.test(name)) return 'トマト'
  if (/ネギ|長ねぎ|ねぎ/.test(name)) return 'ネギ'
  return UNGROUPED_LABEL
}

const ADD_ERRORS: Record<string, string> = {
  packs_per_case_required: 'ケース記法ですが P/C（1ケースの入数）が未設定です。取引先設定で登録してください。',
  unparseable: '数量を解釈できませんでした（例: 10 / 15c2 / x58）。',
  negative: '数量が負の値です。',
  empty_quantity: '数量を入力してください。',
  unknown_product: '商品が見つかりません。',
}

interface UncertainItem {
  field: string
  question: string
  suggestions: string[]
}

/**
 * 出荷一覧の「スマート追加・変更」フォーム（1画面統合 ＆ 差分確認ステップ）。
 * 1. 上部: 自然言語（例:「ここ1週間でA社を1000パック増やしたよ」）＋ 写真メモ読取
 * 2. ステップ進捗演出（1/3 → 2/3 → 3/3 ＆ キャンセル可）
 * 3. 【確定事項】と【確認・不足項目（ワンタップ選択チップ）】の提示
 * 4. 下部: 直接手動入力フォーム（常時操作可能）
 * 5. 確認ステップ（Step 2: 修正前後の数量差分カード明示）
 */
export function ShipmentAddForm({
  deliveryDate,
  customers: initialCustomers,
  products: initialProducts,
  destinations = [],
  packsByPair,
}: ShipmentAddFormProps) {
  const router = useRouter()
  const [isOpen, setIsOpen] = useState(false)
  const [step, setStep] = useState<'input' | 'confirm'>('input')

  // マスタ state
  const [customers, setCustomers] = useState<LocalCustomer[]>(initialCustomers)
  const [products, setProducts] = useState<LocalProduct[]>(initialProducts)
  const [allDestinations, setAllDestinations] = useState<Array<{ id: string; customerId: string; label: string }>>(destinations)
  const [localPacksByPair, setLocalPacksByPair] = useState<Record<string, number | null>>(packsByPair)

  // フォーム入力値
  const [targetDate, setTargetDate] = useState(deliveryDate)
  const [customerId, setCustomerId] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string>('')
  const [productId, setProductId] = useState('')
  const [destinationId, setDestinationId] = useState('')
  const [qtyRaw, setQtyRaw] = useState('')
  const [mode, setMode] = useState<'create' | 'increase' | 'decrease' | 'set'>('create')
  const [shippingTime, setShippingTime] = useState<'am' | 'pm' | ''>('')
  const [note, setNote] = useState('')
  const [actionSheetOpen, setActionSheetOpen] = useState(false)
  const fileSelectorRef = useRef<HTMLInputElement | null>(null)

  // 📦 3連動数量エディタ state（入数 × 箱数 ＝ 総パック数）
  const [inputPacksPerCase, setInputPacksPerCase] = useState<number>(20)
  const [inputCases, setInputCases] = useState<string>('')
  const [inputTotalPacks, setInputTotalPacks] = useState<string>('')

  // 自然言語スマート入力 state
  const [naturalText, setNaturalText] = useState('')
  const [analyzingNatural, setAnalyzingNatural] = useState(false)
  const [streamStep, setStreamStep] = useState<number>(0) // 1: 読取, 2: 照合, 3: まとめ
  const abortControllerRef = useRef<AbortController | null>(null)

  // AI解析結果・確認事項
  const [aiExplanation, setAiExplanation] = useState<string | null>(null)
  const [confirmedBadges, setConfirmedBadges] = useState<string[]>([])
  const [uncertainItems, setUncertainItems] = useState<UncertainItem[]>([])
  const [existingShipmentInfo, setExistingShipmentInfo] = useState<{
    order_id: string
    current_quantity: number
    product_name: string
    delivery_date: string
  } | null>(null)

  // ⚡ AI初回読取の記録（ユーザー修正差分を学習ループへ蓄積用）
  const aiOriginalParsedRef = useRef<{
    customer_name?: string | null
    destination_name?: string | null
    cases?: number | null
    packs_per_case?: number | null
    quantity?: string | number | null
    product_name?: string | null
  } | null>(null)

  // 画像・カメラ
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const galleryInputRef = useRef<HTMLInputElement | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [analyzingPhoto, setAnalyzingPhoto] = useState(false)

  // 📄 1枚の伝票に複数明細・複数店舗がある場合の候補リスト
  interface ParsedCandidateEntry {
    customer_name?: string | null
    delivery_date?: string | null
    destination_name?: string | null
    product_name?: string | null
    raw_name?: string | null
    cases?: number | null
    quantity?: string | number | null
    packs_per_case?: number | null
    registered?: boolean
  }
  const [parsedCandidates, setParsedCandidates] = useState<ParsedCandidateEntry[]>([])
  const [activeCandidateIdx, setActiveCandidateIdx] = useState<number>(0)

  // 📍 既存取引先への新規納入先クイック追加 state
  const [showNewDestForExisting, setShowNewDestForExisting] = useState(false)
  const [newDestForExistingName, setNewDestForExistingName] = useState('')
  const [creatingDestForExisting, setCreatingDestForExisting] = useState(false)

  // 🏢 新規取引先ワンストップ一括作成 state
  const [showNewCustomer, setShowNewCustomer] = useState(false)
  const [newCustomerName, setNewCustomerName] = useState('')
  const [newDestinationName, setNewDestinationName] = useState('')
  const [newPacksPerCase, setNewPacksPerCase] = useState<number>(20)
  const [newContainerType, setNewContainerType] = useState<'ケース' | 'コンテナ'>('ケース')
  const [newAliases, setNewAliases] = useState('')
  const [creatingCustomer, setCreatingCustomer] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // 親更新追従
  useEffect(() => setCustomers(initialCustomers), [initialCustomers])
  useEffect(() => setProducts(initialProducts), [initialProducts])
  useEffect(() => setAllDestinations(destinations), [destinations])
  useEffect(() => setLocalPacksByPair(packsByPair), [packsByPair])
  useEffect(() => {
    if (isOpen) {
      setStep('input')
      setTargetDate(deliveryDate)
    }
  }, [isOpen, deliveryDate])

  // クイック日付用
  const todayStr = useMemo(() => new Date().toISOString().split('T')[0] || '', [])
  const tomorrowStr = useMemo(() => {
    const d = new Date()
    d.setDate(d.getDate() + 1)
    return d.toISOString().split('T')[0] || ''
  }, [])
  const dayAfterTomorrowStr = useMemo(() => {
    const d = new Date()
    d.setDate(d.getDate() + 2)
    return d.toISOString().split('T')[0] || ''
  }, [])

  // 品目カテゴリグループ
  const categoryGroups = useMemo(() => {
    const map = new Map<string, LocalProduct[]>()
    for (const p of products) {
      const cat = resolveProductCategory(p)
      if (!map.has(cat)) map.set(cat, [])
      map.get(cat)!.push(p)
    }

    const sortedCategories = Array.from(map.keys()).sort((a, b) => {
      const idxA = CATEGORY_PRIORITY.indexOf(a)
      const idxB = CATEGORY_PRIORITY.indexOf(b)
      if (idxA !== -1 && idxB !== -1) return idxA - idxB
      if (idxA !== -1) return -1
      if (idxB !== -1) return 1
      if (a === UNGROUPED_LABEL) return 1
      if (b === UNGROUPED_LABEL) return -1
      return a.localeCompare(b, 'ja')
    })

    return sortedCategories.map((category) => ({
      category,
      products: map.get(category) ?? [],
    }))
  }, [products])

  useEffect(() => {
    if (categoryGroups.length > 0 && !selectedCategory) {
      const defaultGroup = categoryGroups[0]!
      setSelectedCategory(defaultGroup.category)
      if (defaultGroup.products.length > 0 && !productId) {
        setProductId(defaultGroup.products[0]!.id)
      }
    }
  }, [categoryGroups, selectedCategory, productId])

  const activeGroup = useMemo(() => {
    return categoryGroups.find((g) => g.category === selectedCategory) ?? categoryGroups[0]
  }, [categoryGroups, selectedCategory])

  const categoryProducts = activeGroup?.products ?? []

  const handleSelectCategory = (cat: string) => {
    setSelectedCategory(cat)
    const grp = categoryGroups.find((g) => g.category === cat)
    if (grp && grp.products.length > 0) {
      setProductId(grp.products[0]!.id)
    }
  }

  // 納入先リスト
  const customerDestinations = useMemo(
    () => allDestinations.filter((d) => d.customerId === customerId),
    [allDestinations, customerId],
  )

  useEffect(() => {
    if (!customerId) return
    const destsForCust = allDestinations.filter((d) => d.customerId === customerId)
    if (destsForCust.length === 1 && !showNewDestForExisting) setDestinationId(destsForCust[0]!.id)
    else if (!destsForCust.some((d) => d.id === destinationId)) setDestinationId('')
  }, [customerId, allDestinations, destinationId, showNewDestForExisting])

  const selectedProduct = products.find((p) => p.id === productId)
  const unit = selectedProduct?.unit ?? 'P'
  const packsPerCase = customerId && productId ? localPacksByPair[`${customerId}:${productId}`] ?? null : null

  // 取引先・品目変更時に連動して1箱の入数を更新
  useEffect(() => {
    if (customerId && productId) {
      const p = localPacksByPair[`${customerId}:${productId}`]
      if (p != null && p > 0) {
        setInputPacksPerCase(p)
        setInputCases((curCases) => {
          if (curCases && Number(curCases) > 0) {
            const tot = Math.round(Number(curCases) * p)
            setInputTotalPacks(String(tot))
            setQtyRaw(`${curCases}c`)
          }
          return curCases
        })
      }
    }
  }, [customerId, productId, localPacksByPair])

  // 📦 3連動数量ハンドラ
  const handlePacksPerCaseChange = (newP: number) => {
    const p = Math.max(1, newP)
    setInputPacksPerCase(p)
    if (inputCases && Number(inputCases) > 0) {
      const tot = Math.round(Number(inputCases) * p)
      setInputTotalPacks(String(tot))
      setQtyRaw(`${inputCases}c`)
    } else if (inputTotalPacks && Number(inputTotalPacks) > 0) {
      setInputCases(String(Math.floor(Number(inputTotalPacks) / p)))
    }
  }

  const handleCasesChange = (val: string) => {
    setInputCases(val)
    const c = parseFloat(val)
    if (!isNaN(c) && c >= 0) {
      const tot = Math.round(c * inputPacksPerCase)
      setInputTotalPacks(String(tot))
      setQtyRaw(`${val}c`)
    } else if (val === '') {
      setInputTotalPacks('')
      setQtyRaw('')
    }
  }

  const handleTotalPacksChange = (val: string) => {
    setInputTotalPacks(val)
    const tot = parseFloat(val)
    if (!isNaN(tot) && tot >= 0) {
      setQtyRaw(val)
      if (inputPacksPerCase > 0) {
        const c = Math.floor(tot / inputPacksPerCase)
        setInputCases(String(c))
      }
    } else if (val === '') {
      setInputCases('')
      setQtyRaw('')
    }
  }

  // 数量プレビュー
  const preview = useMemo(() => {
    if (qtyRaw.trim() === '') return null
    return parseQuantity(qtyRaw, { packsPerCase: inputPacksPerCase || packsPerCase })
  }, [qtyRaw, inputPacksPerCase, packsPerCase])

  const previewText = (() => {
    if (!preview) return null
    if (preview.type === 'delete') return null
    if (preview.type === 'error')
      return { kind: 'error' as const, text: ADD_ERRORS[preview.reason] ?? '解釈できません', reason: preview.reason }
    const parts = [`合計 ${preview.total.toString()} ${unit}`]
    if (preview.interpretation === 'cases' && preview.cases != null) {
      parts.push(`（${preview.cases}ケース × ${inputPacksPerCase || packsPerCase || 20} + 端数${preview.loose}）`)
    }
    return { kind: 'ok' as const, text: parts.join(' ') }
  })()

  const destinationRequired = customerDestinations.length >= 2

  // -------------------------------------------------------------
  // 自然言語解析（ストリーミング・ステップ進捗演出付き）
  // -------------------------------------------------------------
  async function handleNaturalInputSubmit() {
    const q = naturalText.trim()
    if (!q) {
      toast.error('指示テキストを入力してください（例: A社を1000パック増やしたよ）')
      return
    }

    setAnalyzingNatural(true)
    setStreamStep(1)
    setConfirmedBadges([])
    setUncertainItems([])
    setAiExplanation(null)
    setExistingShipmentInfo(null)

    // 中断用コントローラー
    const abortController = new AbortController()
    abortControllerRef.current = abortController

    // ステップ演出タイマー
    const t1 = setTimeout(() => setStreamStep(2), 500)
    const t2 = setTimeout(() => setStreamStep(3), 1200)

    try {
      const res = await fetch('/api/shipments/natural-input', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: q, referenceDate: targetDate }),
        signal: abortController.signal,
      })
      clearTimeout(t1)
      clearTimeout(t2)

      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error || '解析に失敗しました')

      const data = json.data
      const badges: string[] = []

      // 1. 取引先の反映
      if (data.customer_id) {
        setCustomerId(data.customer_id)
        const c = customers.find((x) => x.id === data.customer_id)
        badges.push(`取引先: ${c?.name || data.customer_name}`)
      }

      // 2. 納入先の反映
      if (data.destination_id) {
        setDestinationId(data.destination_id)
        badges.push(`納入先: ${data.destination_name}`)
      }

      // 3. 品目の反映
      if (data.product_id) {
        setProductId(data.product_id)
        const p = products.find((x) => x.id === data.product_id)
        if (p) setSelectedCategory(resolveProductCategory(p))
        badges.push(`品目: ${p?.name || data.product_name}`)
      }

      // 4. 数量の反映
      if (data.cases != null && data.cases > 0) {
        setQtyRaw(`${data.cases}c`)
        badges.push(`数量: ${data.cases}ケース`)
      } else if (data.quantity_number != null && data.quantity_number > 0) {
        setQtyRaw(String(data.quantity_number))
        badges.push(`数量: ${data.quantity_number} ${data.unit || 'P'}`)
      }

      // 5. 操作モード
      if (data.action) {
        setMode(data.action)
        if (data.action === 'increase') badges.push('操作: 既存出荷に加算（増量）')
        else if (data.action === 'decrease') badges.push('操作: 減量')
        else if (data.action === 'set') badges.push('操作: 数量上書き')
      }

      // 6. 日付の反映
      if (data.delivery_date) {
        setTargetDate(data.delivery_date)
        badges.push(`納品日: ${data.delivery_date}`)
      }

      setConfirmedBadges(badges)
      setAiExplanation(data.explanation || null)
      setUncertainItems(data.uncertain_items || [])
      setExistingShipmentInfo(data.existing_shipment || null)

      toast.success('AIが指示を解析しました！確認事項をチェックしてください')
    } catch (err: unknown) {
      if ((err as Error)?.name === 'AbortError') {
        toast('解析を中断し、手動入力へ戻りました', { icon: 'ℹ️' })
      } else {
        toast.error((err as Error)?.message || '解析に失敗しました')
      }
    } finally {
      clearTimeout(t1)
      clearTimeout(t2)
      setAnalyzingNatural(false)
      setStreamStep(0)
      abortControllerRef.current = null
    }
  }

  function handleCancelNaturalAnalysis() {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    setAnalyzingNatural(false)
    setStreamStep(0)
  }

  // 不明点チップの選択
  function handleSelectSuggestion(item: UncertainItem, suggestion: string) {
    if (item.field === 'delivery_date') {
      if (suggestion.includes('明日') || suggestion.includes(tomorrowStr)) setTargetDate(tomorrowStr)
      else if (suggestion.includes('明後日') || suggestion.includes(dayAfterTomorrowStr)) setTargetDate(dayAfterTomorrowStr)
      else if (suggestion.includes('今日') || suggestion.includes(todayStr)) setTargetDate(todayStr)
      else {
        const match = suggestion.match(/\d{4}-\d{2}-\d{2}/)
        if (match && match[0]) setTargetDate(match[0])
      }
    } else if (item.field === 'destination') {
      const hit = customerDestinations.find((d) => d.label.includes(suggestion) || suggestion.includes(d.label))
      if (hit) setDestinationId(hit.id)
    } else if (item.field === 'product') {
      const hit = products.find((p) => p.name.includes(suggestion) || suggestion.includes(p.name))
      if (hit) {
        setProductId(hit.id)
        setSelectedCategory(resolveProductCategory(hit))
      }
    }
    // 解決された項目を除外
    setUncertainItems((prev) => prev.filter((u) => u.field !== item.field))
    toast.success(`「${suggestion}」を反映しました`)
  }

  // 📷 画像圧縮・読込
  async function compressImageFile(file: File): Promise<{ dataUrl: string; base64: string; mime: string }> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = (e) => {
        const img = new Image()
        img.onload = () => {
          const MAX_DIM = 1600
          let { width, height } = img
          if (width > MAX_DIM || height > MAX_DIM) {
            if (width > height) {
              height = Math.round((height * MAX_DIM) / width)
              width = MAX_DIM
            } else {
              width = Math.round((width * MAX_DIM) / height)
              height = MAX_DIM
            }
          }
          const canvas = document.createElement('canvas')
          canvas.width = width
          canvas.height = height
          const ctx = canvas.getContext('2d')
          if (!ctx) {
            const dataUrl = e.target?.result as string
            resolve({ dataUrl, base64: dataUrl.split(',')[1] || '', mime: file.type || 'image/jpeg' })
            return
          }
          ctx.drawImage(img, 0, 0, width, height)
          const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.8)
          resolve({ dataUrl: compressedDataUrl, base64: compressedDataUrl.split(',')[1] || '', mime: 'image/jpeg' })
        }
        img.onerror = () => {
          const dataUrl = e.target?.result as string
          resolve({ dataUrl, base64: dataUrl.split(',')[1] || '', mime: file.type || 'image/jpeg' })
        }
        img.src = e.target?.result as string
      }
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  function applyAllParsedOrders(
    orders?: Array<{
      customer_name?: string | null
      delivery_date?: string | null
      destination_name?: string | null
      items?: Array<{
        product_name?: string | null
        raw_name?: string | null
        cases?: number | null
        quantity?: string | number | null
        packs_per_case?: number | null
      }>
    }> | null,
    clarifications?: Array<{
      targetField: string
      title: string
      reason: string
      options: Array<{ label: string; value: string }>
    }> | null,
  ) {
    const entries: ParsedCandidateEntry[] = []
    for (const ord of orders ?? []) {
      const items = ord.items ?? []
      if (items.length === 0) {
        entries.push({
          customer_name: ord.customer_name,
          delivery_date: ord.delivery_date,
          destination_name: ord.destination_name,
          registered: false,
        })
      } else {
        for (const it of items) {
          entries.push({
            customer_name: ord.customer_name,
            delivery_date: ord.delivery_date,
            destination_name: ord.destination_name,
            product_name: it.product_name,
            raw_name: it.raw_name,
            cases: it.cases,
            quantity: it.quantity,
            packs_per_case: it.packs_per_case,
            registered: false,
          })
        }
      }
    }

    setParsedCandidates(entries)
    setActiveCandidateIdx(0)
    if (entries.length === 0) {
      applyParsedOrder(null, clarifications)
      return
    }
    const first = entries[0]!
    applyParsedOrder(
      {
        customer_name: first.customer_name,
        delivery_date: first.delivery_date,
        destination_name: first.destination_name,
        items: [first],
      },
      clarifications,
    )
  }

  function selectParsedCandidate(idx: number, candidatesList = parsedCandidates) {
    const target = candidatesList[idx]
    if (!target) return
    setActiveCandidateIdx(idx)
    setUncertainItems([])
    applyParsedOrder(
      {
        customer_name: target.customer_name,
        delivery_date: target.delivery_date,
        destination_name: target.destination_name,
        items: [target],
      },
      null,
    )
  }

  function applyParsedOrder(
    parsedOrder?: {
      customer_name?: string | null
      delivery_date?: string | null
      destination_name?: string | null
      items?: Array<{
        product_name?: string | null
        raw_name?: string | null
        cases?: number | null
        quantity?: string | number | null
        packs_per_case?: number | null
      }>
    } | null,
    clarifications?: Array<{
      targetField: string
      title: string
      reason: string
      options: Array<{ label: string; value: string }>
    }> | null,
  ) {
    if (!parsedOrder) {
      toast('注文を特定できませんでした。下の欄に手動入力してください。', { icon: 'ℹ️' })
      return
    }

    const firstItem = parsedOrder.items?.[0]
    // ⚡ 初回AI解析結果を記録（ユーザーが下で修正・確定した差分を自動学習ループに送るため）
    aiOriginalParsedRef.current = {
      customer_name: parsedOrder.customer_name ?? null,
      destination_name: parsedOrder.destination_name ?? null,
      cases: firstItem?.cases ?? null,
      packs_per_case: firstItem?.packs_per_case ?? null,
      quantity: firstItem?.quantity ?? null,
      product_name: firstItem?.product_name || firstItem?.raw_name || null,
    }

    const badges: string[] = []
    let detectedCustName = parsedOrder.customer_name?.trim() || ''

    // 宛名「アイプラス」「小島農園」は当農園（受託側）のため取引先トリガーとしない
    if (/アイプラス|小島農園/.test(detectedCustName)) {
      detectedCustName = ''
    }

    // 1. 取引先照合
    const matchedCust = detectedCustName
      ? customers.find((c) => {
          const cNorm = c.name.replace(/[\s　株式会社有限会社農事組合法人]/g, '')
          const dNorm = detectedCustName.replace(/[\s　株式会社有限会社農事組合法人]/g, '')
          return cNorm.includes(dNorm) || dNorm.includes(cNorm)
        })
      : undefined

    if (matchedCust) {
      setCustomerId(matchedCust.id)
      setShowNewCustomer(false)
      badges.push(`取引先: ${matchedCust.name}`)
    } else if (detectedCustName) {
      // 未知の取引先が検出された場合：ワンストップ新規登録を開き、AI抽出値を初期セット！
      setNewCustomerName(detectedCustName)
      if (parsedOrder.destination_name) setNewDestinationName(parsedOrder.destination_name.trim())
      const firstItemPacks = parsedOrder.items?.[0]?.packs_per_case
      if (firstItemPacks && firstItemPacks > 0) setNewPacksPerCase(firstItemPacks)
      setNewAliases(detectedCustName)
      setShowNewCustomer(true)
      badges.push(`未登録取引先: ${detectedCustName} (一括登録枠を開きました)`)
    }

    // 2. 納品日
    if (parsedOrder.delivery_date) {
      // 過去日付判定
      if (parsedOrder.delivery_date < todayStr) {
        setUncertainItems((prev) => [
          ...prev,
          {
            field: 'delivery_date',
            question: `伝票上の日付（${parsedOrder.delivery_date}）は過去です。いつの納品にしますか？`,
            suggestions: [`直近の次回納品 (${tomorrowStr})`, `今日 (${todayStr})`, `明後日 (${dayAfterTomorrowStr})`],
          },
        ])
        setTargetDate(tomorrowStr)
      } else {
        setTargetDate(parsedOrder.delivery_date)
        badges.push(`納品日: ${parsedOrder.delivery_date}`)
      }
    } else {
      setUncertainItems((prev) => [
        ...prev,
        {
          field: 'delivery_date',
          question: '納品日が記載されていませんでした。いつの出荷にしますか？',
          suggestions: [`明日 (${tomorrowStr})`, `今日 (${todayStr})`],
        },
      ])
    }

    // 3. 納入先（取引先が確定している場合はその取引先の納入先プール内で照合し、他社への誤マッチを完全防止）
    if (parsedOrder.destination_name) {
      const dName = parsedOrder.destination_name.trim()
      const destPool = matchedCust
        ? allDestinations.filter((d) => d.customerId === matchedCust.id)
        : allDestinations
      const matchedDest = destPool.find(
        (d) => d.label.includes(dName) || dName.includes(d.label),
      )
      if (matchedDest) {
        setDestinationId(matchedDest.id)
        setShowNewDestForExisting(false)
        badges.push(`納入先: ${matchedDest.label}`)
      } else if (matchedCust) {
        // 既存取引先の未登録納入先・運送便が検出された場合は自動で「＋新規納入先」枠を展開！
        setDestinationId('')
        setNewDestForExistingName(dName)
        setShowNewDestForExisting(true)
        badges.push(`未登録の納入先・運送: ${dName} (登録枠を開きました)`)
      } else {
        setNewDestinationName(dName)
        badges.push(`納入先候補: ${dName}`)
      }
    } else {
      setShowNewDestForExisting(false)
    }

    // 4. 品目・数量・入数
    if (firstItem) {
      const pName = firstItem.product_name || firstItem.raw_name || ''
      const matchedProd = products.find(
        (p) =>
          p.name.includes(pName) ||
          pName.includes(p.name) ||
          (pName.includes('チンゲン') && p.name.includes('青梗菜')),
      )
      if (matchedProd) {
        setProductId(matchedProd.id)
        setSelectedCategory(resolveProductCategory(matchedProd))
        badges.push(`品目: ${matchedProd.name}`)
      }

      // 伝票上の入数
      const rawText = firstItem.raw_name || ''
      const parsedPacks = firstItem.packs_per_case || (rawText.match(/(\d+)入/)?.[1] ? parseInt(RegExp.$1, 10) : null)
      const currentPacks = parsedPacks || inputPacksPerCase || 20
      if (parsedPacks) {
        setInputPacksPerCase(parsedPacks)
      }

      // 箱数・総パック数の連動反映
      if (firstItem.cases != null && firstItem.cases > 0) {
        const c = firstItem.cases
        const tot = c * currentPacks
        setInputCases(String(c))
        setInputTotalPacks(String(tot))
        setQtyRaw(`${c}c`)
        badges.push(`数量: ${c}箱 (${currentPacks}P/箱 ＝ 計${tot}P)`)
      } else if (firstItem.quantity) {
        const qNum = typeof firstItem.quantity === 'number' ? firstItem.quantity : parseInt(String(firstItem.quantity), 10)
        if (!isNaN(qNum) && qNum > 0) {
          setInputTotalPacks(String(qNum))
          setQtyRaw(String(qNum))
          const c = Math.floor(qNum / currentPacks)
          setInputCases(String(c))
          badges.push(`数量: ${qNum} P (${c}箱相当)`)
        }
      }
    }

    // 5. 不明点・確認カードの統合
    if (clarifications && clarifications.length > 0) {
      const mapped: UncertainItem[] = clarifications.map((c) => ({
        field: c.targetField,
        question: c.title ? `${c.title}: ${c.reason}` : c.reason,
        suggestions: c.options.map((o) => o.label),
      }))
      setUncertainItems((prev) => [...prev, ...mapped])
    }

    setConfirmedBadges(badges)
    toast.success('注文データを読み取りました！内容を確認してください')
  }

  async function handlePhotoFile(file: File) {
    if (fileInputRef.current) fileInputRef.current.value = ''
    if (galleryInputRef.current) galleryInputRef.current.value = ''
    if (fileSelectorRef.current) fileSelectorRef.current.value = ''
    setAnalyzingPhoto(true)

    try {
      const { dataUrl, base64, mime } = await compressImageFile(file)
      setPhotoPreview(dataUrl)

      const res = await fetch('/api/ocr/analyze', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ imageBase64: base64, mimeType: mime }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'AI解析に失敗しました')

      applyAllParsedOrders(data.orders, data.clarifications)
    } catch (err: unknown) {
      toast.error((err as Error)?.message || '読み取りに失敗しました')
    } finally {
      setAnalyzingPhoto(false)
    }
  }

  async function handleGenericFile(file: File) {
    if (fileInputRef.current) fileInputRef.current.value = ''
    if (galleryInputRef.current) galleryInputRef.current.value = ''
    if (fileSelectorRef.current) fileSelectorRef.current.value = ''
    setActionSheetOpen(false)

    if (file.type?.startsWith('image/')) {
      await handlePhotoFile(file)
      return
    }

    setAnalyzingPhoto(true)
    try {
      const reader = new FileReader()
      reader.onload = async (e) => {
        try {
          const dataUrl = e.target?.result as string
          const base64 = dataUrl.split(',')[1] || ''
          const res = await fetch('/api/ocr/analyze', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              fileBase64: base64,
              mimeType: file.type || 'application/octet-stream',
              filename: file.name,
            }),
          })
          const data = await res.json()
          if (!res.ok) throw new Error(data.error ?? 'AI解析に失敗しました')
          applyAllParsedOrders(data.orders, data.clarifications)
        } catch (err: unknown) {
          toast.error((err as Error)?.message || 'ファイルの読み取りに失敗しました')
        } finally {
          setAnalyzingPhoto(false)
        }
      }
      reader.onerror = () => {
        setAnalyzingPhoto(false)
        toast.error('ファイルの読み込みに失敗しました')
      }
      reader.readAsDataURL(file)
    } catch (err: unknown) {
      setAnalyzingPhoto(false)
      toast.error((err as Error)?.message || 'ファイルの処理に失敗しました')
    }
  }

  // 📍 既存取引先への新規納入先クイック追加
  async function handleCreateDestinationForExisting() {
    const dName = newDestForExistingName.trim()
    if (!customerId) {
      toast.error('先に取引先を選択してください')
      return
    }
    if (!dName) {
      toast.error('納入先・運送便名を入力してください')
      return
    }
    setCreatingDestForExisting(true)
    try {
      const res = await fetch('/api/destinations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          customer_id: customerId,
          code: dName,
          full_name: dName,
        }),
      })
      const json = await res.json()
      if (res.status === 409 && json.existing) {
        const ex = json.existing
        const label = ex.code || ex.full_name || dName
        setAllDestinations((prev) =>
          prev.some((d) => d.id === ex.id) ? prev : [...prev, { id: ex.id, customerId, label }],
        )
        setDestinationId(ex.id)
        setShowNewDestForExisting(false)
        setNewDestForExistingName('')
        toast.success(`登録済みの納入先「${label}」を選択しました`)
        return
      }
      if (!res.ok || !json.destination?.id) {
        throw new Error(json.error ?? '納入先の作成に失敗しました')
      }
      const created = json.destination
      const label = created.code || created.full_name || dName
      setAllDestinations((prev) => [
        ...prev.filter((d) => d.id !== created.id),
        { id: created.id, customerId, label },
      ])
      setDestinationId(created.id)
      setShowNewDestForExisting(false)
      setNewDestForExistingName('')
      toast.success(`納入先「${label}」を追加し、選択しました！`)
    } catch (e: unknown) {
      toast.error(fieldErrorMessage(e, '納入先の追加に失敗しました'))
    } finally {
      setCreatingDestForExisting(false)
    }
  }

  // 🏢 新規取引先ワンストップ一括作成（納入先・入数ルール・AIルールも同時登録）
  async function handleCreateOneStopCustomer() {
    const name = newCustomerName.trim()
    if (!name) {
      toast.error('取引先名を入力してください')
      return
    }
    setCreatingCustomer(true)
    try {
      const aliasList = newAliases
        .split(/[,、\s]+/)
        .map((s) => s.trim())
        .filter(Boolean)

      const res = await fetch('/api/customers/quick', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name,
          destination_name: newDestinationName.trim() || undefined,
          packs_per_case: newPacksPerCase > 0 ? newPacksPerCase : undefined,
          container_type: newContainerType,
          aliases: aliasList.length > 0 ? aliasList : undefined,
          product_id: productId || undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok || !json.id) throw new Error(json.error ?? '作成失敗')

      // 取引先リストへ追加・選択
      setCustomers((prev) => (prev.some((c) => c.id === json.id) ? prev : [...prev, { id: json.id, name: json.name }]))
      setCustomerId(json.id)

      // 納入先が作成された場合は追加・選択
      if (json.destination) {
        setAllDestinations((prev) => [
          ...prev.filter((d) => d.id !== json.destination.id),
          { id: json.destination.id, customerId: json.id, label: json.destination.label },
        ])
        setDestinationId(json.destination.id)
      }

      // 入数が設定された場合は反映
      if (json.packs_per_case) {
        setInputPacksPerCase(json.packs_per_case)
        if (productId) {
          setLocalPacksByPair((prev) => ({
            ...prev,
            [`${json.id}:${productId}`]: json.packs_per_case,
          }))
        }
        if (inputCases && Number(inputCases) > 0) {
          const tot = Math.round(Number(inputCases) * json.packs_per_case)
          setInputTotalPacks(String(tot))
          setQtyRaw(`${inputCases}c`)
        }
      }

      setShowNewCustomer(false)
      setNewCustomerName('')
      setNewDestinationName('')
      setNewAliases('')
      toast.success(
        `「${json.name}」を一括登録しました！` +
          (json.destination ? `（納入先: ${json.destination.label}）` : '') +
          (json.packs_per_case ? `（入数: ${json.packs_per_case}P）` : ''),
      )
    } catch (e: unknown) {
      toast.error(fieldErrorMessage(e, '取引先の作成に失敗しました'))
    } finally {
      setCreatingCustomer(false)
    }
  }

  // -------------------------------------------------------------
  // ステップ1: 確認画面への遷移バリデーション（最新の既存出荷差分を取得）
  // -------------------------------------------------------------
  async function proceedToConfirm() {
    if (!customerId) {
      toast.error('取引先を選択してください')
      return
    }
    if (!productId) {
      toast.error('品目を選択してください')
      return
    }
    if (!qtyRaw.trim() || previewText?.kind === 'error') {
      toast.error('有効な数量を入力してください')
      return
    }
    if (destinationRequired && !destinationId) {
      toast.error('納入先を選択してください')
      return
    }

    // 選択された最新の(取引先・納入先・品目・納品日)に基づき、最新の既存出荷状況を取得
    try {
      const q = new URLSearchParams({
        customerId,
        deliveryDate: targetDate,
        productId,
        ...(destinationId ? { destinationId } : {}),
      })
      const res = await fetch(`/api/shipments?${q.toString()}`)
      if (res.ok) {
        const json = await res.json()
        setExistingShipmentInfo(json.existingShipment || null)
        if (json.existingShipment && mode === 'create') {
          // 既に同一出荷が存在する場合は自動的に加算（増量）を提案
          setMode('increase')
        }
      }
    } catch {
      // ネットワーク不通時は手動設定値を維持
    }

    setStep('confirm')
  }

  // -------------------------------------------------------------
  // ステップ2: 最終確定・DB保存
  // -------------------------------------------------------------
  async function submitFinal() {
    setSubmitting(true)
    try {
      const res = await fetch('/api/shipments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          customer_id: customerId,
          product_id: productId,
          delivery_date: targetDate,
          shipping_time: shippingTime || undefined,
          quantity_raw: qtyRaw,
          destination_id: destinationId || null,
          mode,
          note: note.trim() || undefined,
          ai_original: aiOriginalParsedRef.current || undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        throw new Error(ADD_ERRORS[json.error ?? ''] ?? json.error ?? `追加に失敗 (${res.status})`)
      }

      toast.success(
        mode === 'increase'
          ? '既存出荷に数量を加算しました！'
          : mode === 'decrease'
          ? '出荷数量を減量しました！'
          : '出荷を登録・更新しました！',
      )

      if (json.learnedMistake) {
        toast('💡 修正内容をAI自動学習ループに蓄積しました（次回から自動補正されます）', {
          icon: '⚡',
          duration: 4000,
        })
      }

      // 複数明細候補がある場合は、現在の候補を登録済みにし、次の未登録候補へ自動遷移
      if (parsedCandidates.length > 1) {
        const updatedCandidates = parsedCandidates.map((c, idx) =>
          idx === activeCandidateIdx ? { ...c, registered: true } : c,
        )
        const nextUnregisteredIdx = updatedCandidates.findIndex((c) => !c.registered)
        setParsedCandidates(updatedCandidates)
        router.refresh()

        if (nextUnregisteredIdx !== -1) {
          const remainingCount = updatedCandidates.filter((c) => !c.registered).length
          toast.success(
            `続けて次の明細（残り ${remainingCount} 件）を入力欄にセットしました！`,
            { duration: 4000 },
          )
          setStep('input')
          selectParsedCandidate(nextUnregisteredIdx, updatedCandidates)
          return
        }
      }

      // すべて完了時のリセット
      setIsOpen(false)
      setStep('input')
      setQtyRaw('')
      setNaturalText('')
      setPhotoPreview(null)
      setConfirmedBadges([])
      setUncertainItems([])
      setParsedCandidates([])
      setActiveCandidateIdx(0)
      aiOriginalParsedRef.current = null
      router.refresh()
    } catch (e: unknown) {
      toast.error(fieldErrorMessage(e, '登録に失敗しました'))
    } finally {
      setSubmitting(false)
    }
  }

  const custObj = customers.find((c) => c.id === customerId)
  const destObj = customerDestinations.find((d) => d.id === destinationId)
  const prodObj = products.find((p) => p.id === productId)

  return (
    <>
      {/* フローティング追加ボタン */}
      <div
        className="fixed right-5 z-40 print:hidden"
        style={{ bottom: 'calc(1.5rem + env(safe-area-inset-bottom, 0px))' }}
      >
        <button
          type="button"
          onClick={() => {
            setIsOpen(true)
            setStep('input')
          }}
          className="flex h-14 w-14 items-center justify-center rounded-full bg-forest-600 text-white shadow-2xl hover:bg-forest-700 active:scale-90 transition-transform focus:outline-none focus:ring-4 focus:ring-forest-300/50"
          aria-label="出荷を追加・変更"
          title="出荷を追加・変更"
        >
          <Plus className="h-7 w-7 stroke-[2.5]" aria-hidden />
        </button>
      </div>

      {/* 統合モーダル */}
      <Modal
        open={isOpen}
        onClose={() => {
          if (!submitting) setIsOpen(false)
        }}
        title={step === 'confirm' ? '出荷登録・変更の最終確認' : '新規出荷の追加 / 変更'}
        className="max-w-xl max-h-[92vh] overflow-y-auto"
        footer={
          step === 'confirm' ? (
            <div className="flex w-full items-center justify-between gap-3">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setStep('input')}
                disabled={submitting}
                className="flex items-center gap-1.5"
              >
                <ArrowLeft className="h-4 w-4" />
                修正に戻る
              </Button>
              <Button
                type="button"
                onClick={submitFinal}
                isLoading={submitting}
                className="bg-forest-600 hover:bg-forest-700 text-white font-black px-6 flex items-center gap-2 shadow-md"
              >
                <Check className="h-4 w-4" />
                この内容で確定・保存する
              </Button>
            </div>
          ) : (
            <div className="flex w-full items-center justify-between gap-2.5">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setIsOpen(false)}
                disabled={submitting || analyzingNatural}
              >
                キャンセル
              </Button>
              <Button
                type="button"
                onClick={proceedToConfirm}
                disabled={analyzingNatural || !customerId || !productId || !qtyRaw.trim()}
                className="bg-forest-600 hover:bg-forest-700 text-white font-black px-6 flex items-center gap-2"
              >
                <span>内容を確認する</span>
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          )
        }
      >
        {step === 'confirm' ? (
          // =========================================================
          // Step 2: 変更前後差分付き確認カード
          // =========================================================
          <div className="space-y-4 py-1">
            <div className="rounded-2xl border-2 border-forest-300 bg-forest-50/70 p-5 space-y-3.5 shadow-sm">
              <div className="flex items-center justify-between border-b border-forest-200 pb-2">
                <span className="text-xs font-black text-forest-800 uppercase tracking-wide">
                  {mode === 'increase'
                    ? '⚡ 既存出荷への加算（増量）'
                    : mode === 'decrease'
                    ? '📉 出荷数量の減量'
                    : mode === 'set'
                    ? '🔄 数量上書き'
                    : '✨ 新規出荷登録'}
                </span>
                <span className="rounded-lg bg-forest-200/80 px-2.5 py-0.5 text-xs font-black text-forest-900">
                  {targetDate} 納品分
                </span>
              </div>

              {/* 取引先 & 納入先 */}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-[11px] font-bold text-ink-muted">取引先</p>
                  <p className="font-black text-base text-ink">{custObj?.name || '未指定'}</p>
                </div>
                <div>
                  <p className="text-[11px] font-bold text-ink-muted">納入先</p>
                  <p className="font-bold text-sm text-ink">{destObj?.label || '（指定なし・通常便）'}</p>
                </div>
              </div>

              {/* 品目 */}
              <div>
                <p className="text-[11px] font-bold text-ink-muted">出荷品目</p>
                <p className="font-black text-base text-ink">{prodObj?.name || 'チンゲン菜'}</p>
              </div>

              {/* 数量（差分表示） */}
              <div className="rounded-xl border border-forest-300 bg-white p-3.5 space-y-1">
                <p className="text-[11px] font-bold text-ink-muted">出荷数量・ケース換算</p>
                {existingShipmentInfo ? (
                  <div className="space-y-1">
                    <div className="flex items-center gap-3 text-sm">
                      <span className="text-ink-muted font-bold line-through">
                        現在: {existingShipmentInfo.current_quantity} {unit}
                      </span>
                      <span className="font-black text-forest-700 text-lg">
                        ➔ {mode === 'set' ? '変更後' : '反映後'}:{' '}
                        {(() => {
                          const delta = preview && preview.type === 'ok' ? preview.total.toNumber() : 0
                          if (mode === 'increase' || mode === 'create') return existingShipmentInfo.current_quantity + delta
                          if (mode === 'decrease') return Math.max(0, existingShipmentInfo.current_quantity - delta)
                          return delta
                        })()}{' '}
                        {unit}
                      </span>
                    </div>
                    <p className="text-xs font-bold text-forest-800">
                      （差分: {mode === 'decrease' ? '-' : '+'}{previewText?.text}
                      {mode === 'create' ? ' ※既存出荷に自動合算されます' : ''}）
                    </p>
                  </div>
                ) : (
                  <div className="text-forest-900">
                    <p className="text-xl font-black">{previewText?.text}</p>
                  </div>
                )}
              </div>

              {/* 現場メモ */}
              {note && (
                <div className="rounded-lg bg-sand-100/60 p-2 text-xs font-bold text-ink-soft">
                  <span>📝 現場メモ: </span>
                  <span className="text-ink">{note}</span>
                </div>
              )}
            </div>

            <p className="text-center text-xs text-ink-soft font-bold">
              内容に間違いがなければ「この内容で確定・保存する」を押してください。
            </p>
          </div>
        ) : (
          // =========================================================
          // Step 1: 1画面統合レイアウト（スマートバー ＋ 直接入力）
          // =========================================================
          <div className="space-y-4">
            {/* 📷 ファイル・画像隠しInput群 */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) handleGenericFile(file)
              }}
              className="hidden"
              id="shipment-camera-input-unified"
            />
            <input
              ref={galleryInputRef}
              type="file"
              accept="image/*"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) handleGenericFile(file)
              }}
              className="hidden"
              id="shipment-gallery-input-unified"
            />
            <input
              ref={fileSelectorRef}
              type="file"
              accept="image/*,application/pdf,.xlsx,.xls,.csv"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) handleGenericFile(file)
              }}
              className="hidden"
              id="shipment-file-selector-unified"
            />

            {/* ① スマート入力エリア（ボトムアクションシート起動 ＋ 自然言語） */}
            <div className="rounded-2xl border-2 border-forest-200 bg-gradient-to-br from-forest-50/70 to-emerald-50/40 p-4 space-y-3 shadow-2xs">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-xs font-black text-forest-900">
                  <Sparkles className="h-4 w-4 text-forest-600" />
                  自然言語・ファイル・写真からスマート入力
                </span>
              </div>

              {/* 1タップで下から開く読み込みアクションボタン */}
              <button
                type="button"
                onClick={() => setActionSheetOpen(true)}
                className="w-full py-2.5 px-3.5 rounded-xl bg-forest-800 hover:bg-forest-900 text-white font-bold text-xs flex items-center justify-between shadow-2xs active:scale-[0.99] transition"
              >
                <span className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-emerald-300" />
                  <span>📄 注文書・写真・ファイルから自動読込</span>
                </span>
                <span className="text-[11px] font-bold text-emerald-200 bg-white/10 px-2 py-0.5 rounded">
                  カメラ / 写真 / PDF / Excel ➜
                </span>
              </button>

              {/* 自然言語入力欄 */}
              <div className="relative">
                <textarea
                  id="shipment-natural-text-area"
                  value={naturalText}
                  onChange={(e) => setNaturalText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault()
                      handleNaturalInputSubmit()
                    }
                  }}
                  rows={2}
                  placeholder="例:「ここ1週間でA社を1000パック増やしたよ」「明日の和郷園に20c追加」「寺崎 50P」"
                  className="w-full rounded-xl border border-forest-300/80 bg-white p-3 text-sm text-ink placeholder:text-ink-soft/60 focus:border-forest-600 focus:outline-none focus:ring-2 focus:ring-forest-200"
                />
              </div>

              {/* 解析ボタン */}
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-ink-muted">
                  Ctrl+Enter または「AIで解析して入力」を押すと下のフォームへ自動反映されます
                </span>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleNaturalInputSubmit}
                  disabled={analyzingNatural || !naturalText.trim()}
                  className="bg-forest-700 hover:bg-forest-800 text-white font-bold shrink-0 text-xs px-3.5 h-8 flex items-center gap-1.5 shadow-xs"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>AIで解析して入力</span>
                </Button>
              </div>

              {/* 📷 写真プレビューがある場合 */}
              {photoPreview && (
                <div className="flex items-center justify-between rounded-xl bg-white p-2 border border-forest-200">
                  <div className="flex items-center gap-2">
                    <img src={photoPreview} alt="写真" className="h-10 w-10 object-cover rounded-md border" />
                    <span className="text-xs font-bold text-ink">画像を添付中</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPhotoPreview(null)}
                    className="text-xs text-alert font-bold hover:underline px-2 py-1"
                  >
                    解除
                  </button>
                </div>
              )}

              {/* ⏳ ストリーミング・ステップ進捗演出（待ち時間対策） */}
              {(analyzingNatural || analyzingPhoto) && (
                <div className="rounded-xl border border-forest-300 bg-white p-3.5 space-y-2.5 shadow-sm">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-xs font-black text-forest-800">
                      <Loader2 className="h-4 w-4 animate-spin text-forest-600" />
                      <span>
                        {streamStep === 1
                          ? '📖 (1/3) テキスト・画像読み取り中...'
                          : streamStep === 2
                          ? '🏢 (2/3) 取引先・日付・品目マスタ照合中...'
                          : '✨ (3/3) 確定事項・確認項目まとめ中...'}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={handleCancelNaturalAnalysis}
                      className="text-xs text-ink-soft hover:text-ink font-bold underline"
                    >
                      手動入力へ戻る（中断）
                    </button>
                  </div>
                  {/* プログレスバー */}
                  <div className="h-1.5 w-full bg-forest-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-forest-600 transition-all duration-300 ease-out"
                      style={{ width: `${(streamStep / 3) * 100}%` }}
                    />
                  </div>
                </div>
              )}

              {/* 📄 1枚の伝票に複数明細・複数店舗が検出された場合の切替セレクタ */}
              {parsedCandidates.length > 1 && !analyzingNatural && !analyzingPhoto && (
                <div className="rounded-xl border-2 border-forest-300 bg-white p-3 space-y-2 shadow-2xs">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-black text-forest-900 flex items-center gap-1.5">
                      <span>📄 伝票から {parsedCandidates.length} 件の明細を検出（順番にすべて登録できます）</span>
                    </span>
                    <span className="rounded-full bg-forest-100 px-2 py-0.5 text-[10px] font-black text-forest-800">
                      完了 {parsedCandidates.filter((c) => c.registered).length} / {parsedCandidates.length}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {parsedCandidates.map((cand, cIdx) => {
                      const labelDest = cand.destination_name || cand.customer_name || `明細${cIdx + 1}`
                      const labelProd = cand.product_name || cand.raw_name || '品目'
                      const labelQty =
                        cand.cases != null && cand.cases > 0
                          ? `${cand.cases}箱`
                          : cand.quantity
                          ? `${cand.quantity}P`
                          : ''
                      const isCurrent = cIdx === activeCandidateIdx
                      return (
                        <button
                          key={cIdx}
                          type="button"
                          onClick={() => selectParsedCandidate(cIdx)}
                          className={cn(
                            'rounded-lg border px-2.5 py-1.5 text-xs font-bold transition-all flex items-center gap-1.5',
                            cand.registered
                              ? 'border-emerald-300 bg-emerald-50 text-emerald-800 opacity-75'
                              : isCurrent
                              ? 'border-forest-700 bg-forest-700 text-white shadow-xs ring-2 ring-forest-300'
                              : 'border-line bg-bg-soft/70 text-ink hover:bg-bg-soft',
                          )}
                        >
                          <span>
                            {cIdx + 1}. {labelDest} / {labelProd} {labelQty}
                          </span>
                          {cand.registered && (
                            <span className="rounded bg-emerald-600 text-white px-1 py-0.2 text-[10px] font-black">
                              ✓済
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* 🟢 【確定事項】バッジ表示 */}
              {confirmedBadges.length > 0 && !analyzingNatural && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/80 p-3 space-y-1.5">
                  <p className="text-xs font-black text-emerald-900 flex items-center gap-1.5">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                    <span>【確定事項】以下の項目を特定し、下の入力欄へ反映しました</span>
                  </p>
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {confirmedBadges.map((b, i) => (
                      <span key={i} className="rounded-md bg-white border border-emerald-300 px-2 py-0.5 text-xs font-bold text-emerald-800 shadow-2xs">
                        ✓ {b}
                      </span>
                    ))}
                  </div>
                  {aiExplanation && (
                    <p className="text-xs text-emerald-950 font-medium pt-1 border-t border-emerald-200/60">
                      💡 {aiExplanation}
                    </p>
                  )}
                </div>
              )}

              {/* 🟡 【確認・不足項目】提示カード（勝手に補正せずユーザーに選択させる） */}
              {uncertainItems.length > 0 && !analyzingNatural && (
                <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-3.5 space-y-2.5">
                  <p className="text-xs font-black text-amber-950 flex items-center gap-1.5">
                    <AlertCircle className="h-4 w-4 text-amber-600 shrink-0" />
                    <span>【確認・不足項目】以下の項目を選択または補完してください</span>
                  </p>
                  <div className="space-y-2">
                    {uncertainItems.map((item, idx) => (
                      <div key={idx} className="rounded-lg bg-white p-2.5 border border-amber-200 space-y-1.5">
                        <p className="text-xs font-bold text-ink">{item.question}</p>
                        <div className="flex flex-wrap gap-1.5">
                          {item.suggestions.map((sug, sIdx) => (
                            <button
                              key={sIdx}
                              type="button"
                              onClick={() => handleSelectSuggestion(item, sug)}
                              className="rounded-lg border border-amber-300 bg-amber-50/70 hover:bg-amber-100 px-2.5 py-1 text-xs font-black text-amber-900 transition-colors shadow-2xs active:scale-95"
                            >
                              👉 {sug}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* ② 構造化直接入力フォーム（常時操作可能・手入力も即座にOK） */}
            <div className="space-y-3.5 pt-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black text-ink-muted uppercase tracking-wide">
                  ▼ 出荷内容の入力・微修正
                </span>
                {/* 操作モード選択 */}
                <div className="flex items-center gap-1 text-xs font-bold">
                  <span className="text-ink-muted">操作:</span>
                  <select
                    value={mode}
                    onChange={(e) => setMode(e.target.value as typeof mode)}
                    className="rounded-lg border border-line bg-white px-2 py-0.5 text-xs font-bold text-ink"
                  >
                    <option value="create">✨ 新規追加</option>
                    <option value="increase">⚡ 既存出荷に加算（増量）</option>
                    <option value="decrease">📉 減量</option>
                    <option value="set">🔄 数量上書き</option>
                  </select>
                </div>
              </div>

              {/* 納品日 ＆ 時間帯指定 */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-black text-ink">納品日 ＆ 出荷時間</label>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        setTargetDate(tomorrowStr)
                        setShippingTime('am')
                      }}
                      className={cn(
                        'rounded-md px-2 py-0.5 text-xs font-bold transition-colors',
                        targetDate === tomorrowStr && shippingTime === 'am'
                          ? 'bg-forest-600 text-white shadow-2xs'
                          : 'bg-sand-100 text-ink hover:bg-sand-200',
                      )}
                    >
                      🌅 明日朝
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setTargetDate(tomorrowStr)
                        setShippingTime('pm')
                      }}
                      className={cn(
                        'rounded-md px-2 py-0.5 text-xs font-bold transition-colors',
                        targetDate === tomorrowStr && shippingTime === 'pm'
                          ? 'bg-forest-600 text-white shadow-2xs'
                          : 'bg-sand-100 text-ink hover:bg-sand-200',
                      )}
                    >
                      ☀️ 明日昼
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setTargetDate(todayStr)
                        setShippingTime('')
                      }}
                      className={cn(
                        'rounded-md px-2 py-0.5 text-xs font-bold transition-colors',
                        targetDate === todayStr ? 'bg-forest-600 text-white' : 'bg-sand-100 text-ink hover:bg-sand-200',
                      )}
                    >
                      🚚 今日
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-5 gap-2">
                  <Input
                    type="date"
                    value={targetDate}
                    onChange={(e) => setTargetDate(e.target.value)}
                    className="col-span-3 h-9 text-xs"
                  />
                  <select
                    value={shippingTime}
                    onChange={(e) => setShippingTime(e.target.value as 'am' | 'pm' | '')}
                    className="col-span-2 h-9 rounded-md border border-line bg-white px-2 text-xs font-bold text-ink"
                  >
                    <option value="">指定なし</option>
                    <option value="am">🌅 朝便 (am)</option>
                    <option value="pm">☀️ 昼便 (pm)</option>
                  </select>
                </div>
              </div>

              {/* 取引先セレクト */}
              <div className="space-y-1">
                <Select
                  label="取引先"
                  required
                  placeholder="取引先を選択..."
                  value={customerId}
                  onChange={(e) => setCustomerId(e.target.value)}
                  options={customers.map((c) => ({ value: c.id, label: c.name }))}
                />
                {!showNewCustomer && (
                  <div className="text-right">
                    <button
                      type="button"
                      onClick={() => setShowNewCustomer(true)}
                      className="inline-flex items-center gap-1 text-xs font-bold text-forest-700 hover:underline"
                    >
                      <UserPlus className="h-3 w-3" />
                      ＋ その場で取引先を追加
                    </button>
                  </div>
                )}
              </div>

              {/* 取引先ワンストップ一括作成 */}
              {showNewCustomer && (
                <div className="rounded-2xl border-2 border-forest-400 bg-gradient-to-br from-forest-50 to-sand-50 p-4 space-y-3.5 shadow-md animate-in fade-in duration-200">
                  <div className="flex items-center justify-between border-b border-forest-200 pb-2">
                    <div className="flex items-center gap-2">
                      <span className="rounded-lg bg-forest-600 p-1 text-white">
                        <UserPlus className="h-4 w-4" />
                      </span>
                      <div>
                        <h4 className="text-xs font-black text-forest-950">✨ 新規取引先のワンストップ一括登録</h4>
                        <p className="text-[10px] text-ink-muted">納入先・入数ルール・AI解析ルールも同時に登録し即座に適用します</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowNewCustomer(false)}
                      className="text-xs font-bold text-ink-muted hover:text-ink px-2 py-1 rounded-md hover:bg-forest-100"
                    >
                      ✕ 閉じる
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    {/* 取引先名 */}
                    <div className="space-y-1">
                      <label className="font-black text-ink">取引先名（必須）</label>
                      <Input
                        placeholder="例: ランドローム（やなぎさわファーム）"
                        value={newCustomerName}
                        onChange={(e) => setNewCustomerName(e.target.value)}
                        className="h-9 text-xs"
                        autoFocus
                      />
                    </div>

                    {/* 納入先（店舗・センター・運送会社） */}
                    <div className="space-y-1">
                      <label className="font-black text-ink">納入先（店舗・センター・運送）</label>
                      <Input
                        placeholder="例: 小松運輸 / 本社 / 成田センター"
                        value={newDestinationName}
                        onChange={(e) => setNewDestinationName(e.target.value)}
                        className="h-9 text-xs"
                      />
                    </div>

                    {/* 入数（P/箱） */}
                    <div className="space-y-1">
                      <label className="font-black text-ink">1箱の入数（P/箱）</label>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          min="1"
                          value={newPacksPerCase}
                          onChange={(e) => setNewPacksPerCase(Math.max(1, Number(e.target.value)))}
                          className="h-9 text-xs w-24"
                        />
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setNewPacksPerCase(10)}
                            className={cn(
                              'px-2 py-1 text-xs font-bold rounded transition-colors',
                              newPacksPerCase === 10 ? 'bg-forest-600 text-white' : 'bg-sand-200 text-ink hover:bg-sand-300',
                            )}
                          >
                            10入
                          </button>
                          <button
                            type="button"
                            onClick={() => setNewPacksPerCase(20)}
                            className={cn(
                              'px-2 py-1 text-xs font-bold rounded transition-colors',
                              newPacksPerCase === 20 ? 'bg-forest-600 text-white' : 'bg-sand-200 text-ink hover:bg-sand-300',
                            )}
                          >
                            20入
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* 容器種別 */}
                    <div className="space-y-1">
                      <label className="font-black text-ink">荷姿・容器種別</label>
                      <select
                        value={newContainerType}
                        onChange={(e) => setNewContainerType(e.target.value as 'ケース' | 'コンテナ')}
                        className="w-full h-9 rounded-md border border-line bg-white px-2 text-xs font-bold text-ink"
                      >
                        <option value="ケース">ケース（ダンボール・箱）</option>
                        <option value="コンテナ">コンテナ（通い箱）</option>
                      </select>
                    </div>

                    {/* FAX・伝票上の別名（AI自動識別用） */}
                    <div className="sm:col-span-2 space-y-1">
                      <div className="flex items-center justify-between">
                        <label className="font-black text-ink">伝票上の表記・別名（AI自動認識用）</label>
                        <span className="text-[10px] text-ink-muted">カンマ区切りで複数指定可</span>
                      </div>
                      <Input
                        placeholder="例: やなぎさわファーム, ランドローム, 株式会社 やなぎさわファーム"
                        value={newAliases}
                        onChange={(e) => setNewAliases(e.target.value)}
                        className="h-9 text-xs"
                      />
                      <p className="text-[10px] text-forest-800">
                        💡 ここに入力した別名やルールは AI（ai_rules）にも即座に学習され、次回以降のFAX・注文書で自動認識されます。
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-1 border-t border-forest-200">
                    <Button
                      variant="tertiary"
                      size="sm"
                      onClick={() => setShowNewCustomer(false)}
                      className="h-8 text-xs"
                    >
                      キャンセル
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleCreateOneStopCustomer}
                      isLoading={creatingCustomer}
                      disabled={!newCustomerName.trim()}
                      className="bg-forest-700 hover:bg-forest-800 text-white font-bold h-8 text-xs px-4 shadow-sm"
                    >
                      ✨ 取引先・納入先・ルールを一括作成して適用
                    </Button>
                  </div>
                </div>
              )}

              {/* 納入先セレクト ＆ 既存取引先への新規納入先クイック追加 */}
              {customerId && !showNewCustomer && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-black text-ink">
                      納入先・運送便{destinationRequired ? '（必須）' : '（任意）'}
                    </label>
                    <button
                      type="button"
                      onClick={() => setShowNewDestForExisting(!showNewDestForExisting)}
                      className="text-xs font-bold text-forest-700 hover:text-forest-800 flex items-center gap-0.5"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      {showNewDestForExisting ? '閉じる' : '新しい納入先・運送便を追加'}
                    </button>
                  </div>

                  {customerDestinations.length > 0 ? (
                    <Select
                      placeholder="納入先を選択..."
                      value={destinationId}
                      onChange={(e) => setDestinationId(e.target.value)}
                      options={customerDestinations.map((d) => ({ value: d.id, label: d.label }))}
                    />
                  ) : (
                    !showNewDestForExisting && (
                      <p className="text-xs text-ink-muted bg-bg-soft/60 rounded-lg px-3 py-2 border border-line">
                        登録済みの納入先はありません（直接納品、または右上の「＋新しい納入先・運送便を追加」から小松運輸などを登録できます）
                      </p>
                    )
                  )}

                  {showNewDestForExisting && (
                    <div className="rounded-xl border-2 border-forest-300 bg-forest-50/60 p-3 space-y-2 shadow-2xs">
                      <p className="text-xs font-black text-forest-900">
                        📍 選択中の取引先に新しい納入先・運送便を追加
                      </p>
                      <div className="flex items-center gap-2">
                        <Input
                          placeholder="例: 小松運輸 / 船橋センター / 柏店"
                          value={newDestForExistingName}
                          onChange={(e) => setNewDestForExistingName(e.target.value)}
                          className="bg-white flex-1"
                        />
                        <Button
                          type="button"
                          size="sm"
                          onClick={handleCreateDestinationForExisting}
                          isLoading={creatingDestForExisting}
                          disabled={!newDestForExistingName.trim()}
                          className="bg-forest-700 hover:bg-forest-800 text-white font-bold h-10 px-3.5 shrink-0"
                        >
                          追加して選択
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* 品目選択（カテゴリ別） */}
              <div className="space-y-2">
                <label className="text-xs font-black text-ink">品目・規格</label>
                <div className="flex flex-wrap gap-1.5">
                  {categoryGroups.map((g) => (
                    <button
                      key={g.category}
                      type="button"
                      onClick={() => handleSelectCategory(g.category)}
                      className={cn(
                        'rounded-lg px-2.5 py-1 text-xs font-bold transition-all',
                        selectedCategory === g.category
                          ? 'bg-forest-700 text-white shadow-xs'
                          : 'border border-line bg-white text-ink-soft hover:bg-bg-soft',
                      )}
                    >
                      {g.category}
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                  {categoryProducts.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setProductId(p.id)}
                      className={cn(
                        'rounded-xl border p-2 text-left text-xs font-bold transition-all',
                        productId === p.id
                          ? 'border-forest-600 bg-forest-50 text-forest-900 ring-2 ring-forest-600 shadow-2xs'
                          : 'border-line bg-white text-ink hover:bg-bg-soft',
                      )}
                    >
                      <p className="truncate">{p.name}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* 📦 3連動数量エディタ（箱数・入数・総パック数の完全連動） */}
              <div className="rounded-2xl border-2 border-forest-300 bg-gradient-to-br from-forest-50/60 to-emerald-50/40 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-black text-forest-950 flex items-center gap-1.5">
                    <span>📦 数量入力（箱数・入数・総パック数の連動計算）</span>
                  </label>
                  <span className="text-[11px] font-bold text-forest-700 bg-forest-100 px-2 py-0.5 rounded-full">
                    どの枠に入力しても自動計算
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  {/* ① 1箱の入数 (P/箱) */}
                  <div className="rounded-xl bg-white p-3 border border-forest-200 shadow-2xs space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-black text-ink">① 1箱の入数</span>
                      <span className="text-[10px] font-bold text-ink-muted">P/箱</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        min="1"
                        value={inputPacksPerCase}
                        onChange={(e) => handlePacksPerCaseChange(Number(e.target.value))}
                        className="w-full h-10 rounded-lg border border-line bg-white px-2.5 font-black text-base text-ink focus:border-forest-600 focus:outline-none"
                      />
                      <div className="flex flex-col gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => handlePacksPerCaseChange(10)}
                          className={cn(
                            'text-[10px] font-bold px-2 py-0.5 rounded transition-colors',
                            inputPacksPerCase === 10 ? 'bg-forest-600 text-white' : 'bg-sand-100 hover:bg-sand-200 text-ink',
                          )}
                        >
                          10入
                        </button>
                        <button
                          type="button"
                          onClick={() => handlePacksPerCaseChange(20)}
                          className={cn(
                            'text-[10px] font-bold px-2 py-0.5 rounded transition-colors',
                            inputPacksPerCase === 20 ? 'bg-forest-600 text-white' : 'bg-sand-100 hover:bg-sand-200 text-ink',
                          )}
                        >
                          20入
                        </button>
                      </div>
                    </div>
                    <p className="text-[10px] text-ink-muted">標準: 20P（やなぎさわ等は10P）</p>
                  </div>

                  {/* ② 箱数（ケース数） */}
                  <div className="rounded-xl bg-white p-3 border border-forest-200 shadow-2xs space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-black text-forest-900">② 箱数（ケース）</span>
                      <span className="text-[10px] font-bold text-forest-700">箱 / ケース</span>
                    </div>
                    <input
                      type="number"
                      min="0"
                      placeholder="例: 30"
                      value={inputCases}
                      onChange={(e) => handleCasesChange(e.target.value)}
                      className="w-full h-10 rounded-lg border-2 border-forest-400 bg-forest-50/30 px-3 font-black text-lg text-forest-900 focus:border-forest-600 focus:outline-none"
                    />
                    <div className="flex items-center gap-1 pt-0.5">
                      {[5, 10, 20, 30].map((n) => (
                        <button
                          key={n}
                          type="button"
                          onClick={() => {
                            const cur = Number(inputCases) || 0
                            handleCasesChange(String(cur + n))
                          }}
                          className="flex-1 text-[10px] font-bold py-0.5 rounded bg-sand-100 hover:bg-forest-100 text-ink active:scale-95 transition"
                        >
                          +{n}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* ③ 総パック数 (P) */}
                  <div className="rounded-xl bg-white p-3 border border-forest-200 shadow-2xs space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-black text-emerald-900">③ 総パック数</span>
                      <span className="text-[10px] font-bold text-emerald-700">{unit}</span>
                    </div>
                    <input
                      type="number"
                      min="0"
                      placeholder="例: 300"
                      value={inputTotalPacks}
                      onChange={(e) => handleTotalPacksChange(e.target.value)}
                      className="w-full h-10 rounded-lg border-2 border-emerald-400 bg-emerald-50/30 px-3 font-black text-lg text-emerald-950 focus:border-emerald-600 focus:outline-none"
                    />
                    <div className="flex items-center gap-1 pt-0.5">
                      {[50, 100, 200].map((n) => (
                        <button
                          key={n}
                          type="button"
                          onClick={() => {
                            const cur = Number(inputTotalPacks) || 0
                            handleTotalPacksChange(String(cur + n))
                          }}
                          className="flex-1 text-[10px] font-bold py-0.5 rounded bg-sand-100 hover:bg-emerald-100 text-ink active:scale-95 transition"
                        >
                          +{n}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => {
                          setInputCases('')
                          setInputTotalPacks('')
                          setQtyRaw('')
                        }}
                        className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-50 text-red-700 hover:bg-red-100"
                      >
                        クリア
                      </button>
                    </div>
                  </div>
                </div>

                {/* 連動計算ビジュアル帯 */}
                <div className="rounded-xl border border-forest-200 bg-white/95 p-2.5 flex flex-wrap items-center justify-between gap-2 shadow-2xs">
                  <div className="flex items-center gap-2 text-xs font-black text-forest-950">
                    <span className="text-sm">📦</span>
                    <span>{inputCases || 0} 箱</span>
                    <span className="text-ink-muted">×</span>
                    <span>{inputPacksPerCase} P/箱</span>
                    <span className="text-forest-600">＝</span>
                    <span className="text-sm text-forest-800 underline decoration-forest-400 font-black">
                      {inputTotalPacks || 0} {unit}（総数）
                    </span>
                  </div>
                  {previewText && (
                    <span
                      className={cn(
                        'text-xs font-bold px-2 py-0.5 rounded',
                        previewText.kind === 'error' ? 'bg-red-100 text-alert' : 'bg-forest-100 text-forest-900',
                      )}
                    >
                      {previewText.text}
                    </span>
                  )}
                </div>

                {/* 自由入力・記法併用用インプット */}
                <div className="pt-1">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] font-bold text-ink-muted">
                      自由記法入力（直接のバラ数や「15c2」「x58」など）
                    </label>
                  </div>
                  <input
                    type="text"
                    value={qtyRaw}
                    onChange={(e) => {
                      const val = e.target.value
                      setQtyRaw(val)
                      const cMatch = val.match(/^(\d+)\s*[cCケース箱]$/)
                      if (cMatch && cMatch[1]) {
                        const c = parseInt(cMatch[1], 10)
                        setInputCases(String(c))
                        setInputTotalPacks(String(c * inputPacksPerCase))
                      } else {
                        const num = parseInt(val, 10)
                        if (!isNaN(num) && num > 0) {
                          setInputTotalPacks(String(num))
                          if (inputPacksPerCase > 0) {
                            setInputCases(String(Math.floor(num / inputPacksPerCase)))
                          }
                        }
                      }
                    }}
                    placeholder="例: 10 / 15c / x58"
                    className="w-full h-8 rounded-lg border border-line bg-white px-2.5 text-xs text-ink placeholder:text-ink-soft/60 focus:border-forest-600 focus:outline-none"
                  />
                </div>
              </div>

              {/* 現場メモ */}
              <div>
                <label className="text-xs font-black text-ink">現場メモ・備考（任意）</label>
                <input
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="例: 電話口頭受付、急ぎパック希望など"
                  className="mt-1 w-full rounded-xl border border-line bg-white p-2.5 text-xs text-ink placeholder:text-ink-soft/60 focus:border-forest-600 focus:outline-none"
                />
              </div>
            </div>
          </div>
        )}

        {/* 📄 下からせり出すアクションシート（カメラ・メディア・ファイル・テキスト） */}
        {actionSheetOpen && (
          <div
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-xs animate-in fade-in duration-200"
            onClick={() => setActionSheetOpen(false)}
          >
            <div
              className="w-full max-w-lg rounded-t-3xl bg-white p-5 shadow-2xl space-y-4 animate-in slide-in-from-bottom duration-200"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between pb-2 border-b border-line">
                <div>
                  <h3 className="text-base font-black text-ink">注文の読み込み・取り込み</h3>
                  <p className="text-xs text-ink-muted">取り込み方法を以下から選択してください</p>
                </div>
                <button
                  type="button"
                  onClick={() => setActionSheetOpen(false)}
                  className="p-2 rounded-full text-ink-muted hover:bg-bg-soft"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="grid grid-cols-1 gap-2.5">
                {/* ① カメラで撮影 */}
                <button
                  type="button"
                  onClick={() => {
                    setActionSheetOpen(false)
                    fileInputRef.current?.click()
                  }}
                  className="flex items-center gap-3.5 p-3.5 rounded-2xl border border-line bg-white hover:bg-emerald-50/50 hover:border-emerald-300 transition text-left active:scale-[0.99] shadow-2xs"
                >
                  <div className="w-11 h-11 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center shrink-0">
                    <Camera className="h-6 w-6" />
                  </div>
                  <div>
                    <div className="font-black text-sm text-ink">📷 カメラで撮影</div>
                    <div className="text-xs text-ink-muted mt-0.5">FAX用紙や手書き伝票をその場で撮影して即解析</div>
                  </div>
                </button>

                {/* ② 写真・メディアライブラリ */}
                <button
                  type="button"
                  onClick={() => {
                    setActionSheetOpen(false)
                    galleryInputRef.current?.click()
                  }}
                  className="flex items-center gap-3.5 p-3.5 rounded-2xl border border-line bg-white hover:bg-sky-50/50 hover:border-sky-300 transition text-left active:scale-[0.99] shadow-2xs"
                >
                  <div className="w-11 h-11 rounded-xl bg-sky-100 text-sky-800 flex items-center justify-center shrink-0">
                    <ImageIcon className="h-6 w-6" />
                  </div>
                  <div>
                    <div className="font-black text-sm text-ink">🖼 写真・画像ライブラリから選択</div>
                    <div className="text-xs text-ink-muted mt-0.5">スマホの写真フォルダや撮影済みの画像を選択</div>
                  </div>
                </button>

                {/* ③ ファイル選択（PDF・Excel・CSV） */}
                <button
                  type="button"
                  onClick={() => {
                    setActionSheetOpen(false)
                    fileSelectorRef.current?.click()
                  }}
                  className="flex items-center gap-3.5 p-3.5 rounded-2xl border border-line bg-white hover:bg-purple-50/50 hover:border-purple-300 transition text-left active:scale-[0.99] shadow-2xs"
                >
                  <div className="w-11 h-11 rounded-xl bg-purple-100 text-purple-800 flex items-center justify-center shrink-0">
                    <FileText className="h-6 w-6" />
                  </div>
                  <div>
                    <div className="font-black text-sm text-ink">📁 ファイルを選択（PDF / Excel / CSV）</div>
                    <div className="text-xs text-ink-muted mt-0.5">電子FAX（PDF）、発注Excel表（.xlsx / .xls）、CSVデータ</div>
                  </div>
                </button>

                {/* ④ メモ・テキスト貼付 */}
                <button
                  type="button"
                  onClick={() => {
                    setActionSheetOpen(false)
                    const area = document.getElementById('shipment-natural-text-area')
                    area?.focus()
                  }}
                  className="flex items-center gap-3.5 p-3.5 rounded-2xl border border-line bg-white hover:bg-amber-50/50 hover:border-amber-300 transition text-left active:scale-[0.99] shadow-2xs"
                >
                  <div className="w-11 h-11 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center shrink-0">
                    <Clipboard className="h-6 w-6" />
                  </div>
                  <div>
                    <div className="font-black text-sm text-ink">📋 テキスト貼付・手入力</div>
                    <div className="text-xs text-ink-muted mt-0.5">LINEやメールの注文指示文をそのまま貼り付けて解析</div>
                  </div>
                </button>
              </div>

              <button
                type="button"
                onClick={() => setActionSheetOpen(false)}
                className="w-full py-3 rounded-xl border border-line bg-bg-soft text-ink font-bold text-sm hover:bg-slate-200"
              >
                キャンセル
              </button>
            </div>
          </div>
        )}
      </Modal>
    </>
  )
}
