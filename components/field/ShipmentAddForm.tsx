'use client'

import { useEffect, useMemo, useState, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Plus,
  ArrowRight,
  UserPlus,
  Check,
  Sparkles,
  Camera,
  Image as ImageIcon,
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

  // フォーム入力値
  const [targetDate, setTargetDate] = useState(deliveryDate)
  const [customerId, setCustomerId] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string>('')
  const [productId, setProductId] = useState('')
  const [destinationId, setDestinationId] = useState('')
  const [qtyRaw, setQtyRaw] = useState('')
  const [mode, setMode] = useState<'create' | 'increase' | 'decrease' | 'set'>('create')
  const [note, setNote] = useState('')

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

  // 画像・カメラ
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const galleryInputRef = useRef<HTMLInputElement | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [analyzingPhoto, setAnalyzingPhoto] = useState(false)

  // インライン新規作成
  const [showNewCustomer, setShowNewCustomer] = useState(false)
  const [newCustomerName, setNewCustomerName] = useState('')
  const [creatingCustomer, setCreatingCustomer] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // 親更新追従
  useEffect(() => setCustomers(initialCustomers), [initialCustomers])
  useEffect(() => setProducts(initialProducts), [initialProducts])
  useEffect(() => setTargetDate(deliveryDate), [deliveryDate])

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
    () => destinations.filter((d) => d.customerId === customerId),
    [destinations, customerId],
  )

  useEffect(() => {
    if (customerDestinations.length === 1) setDestinationId(customerDestinations[0]!.id)
    else if (!customerDestinations.some((d) => d.id === destinationId)) setDestinationId('')
  }, [customerId, customerDestinations, destinationId])

  const selectedProduct = products.find((p) => p.id === productId)
  const unit = selectedProduct?.unit ?? 'P'
  const packsPerCase = customerId && productId ? packsByPair[`${customerId}:${productId}`] ?? null : null

  // 数量プレビュー
  const preview = useMemo(() => {
    if (qtyRaw.trim() === '') return null
    return parseQuantity(qtyRaw, { packsPerCase })
  }, [qtyRaw, packsPerCase])

  const previewText = (() => {
    if (!preview) return null
    if (preview.type === 'delete') return null
    if (preview.type === 'error')
      return { kind: 'error' as const, text: ADD_ERRORS[preview.reason] ?? '解釈できません', reason: preview.reason }
    const parts = [`合計 ${preview.total.toString()} ${unit}`]
    if (preview.interpretation === 'cases' && preview.cases != null) {
      parts.push(`（${preview.cases}ケース × ${packsPerCase || 20} + 端数${preview.loose}）`)
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

  async function handlePhotoFile(file: File) {
    if (fileInputRef.current) fileInputRef.current.value = ''
    if (galleryInputRef.current) galleryInputRef.current.value = ''
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

      const parsedOrder = data.orders?.[0]
      if (!parsedOrder) {
        toast('注文を特定できませんでした。下の欄に手動入力してください。', { icon: 'ℹ️' })
        return
      }

      const badges: string[] = []
      // 1. 取引先
      const cName = parsedOrder.customer_name?.trim() || ''
      const matchedCust = customers.find((c) => c.name.includes(cName) || cName.includes(c.name))
      if (matchedCust) {
        setCustomerId(matchedCust.id)
        badges.push(`取引先: ${matchedCust.name}`)
      }

      // 2. 納品日
      if (parsedOrder.delivery_date) {
        setTargetDate(parsedOrder.delivery_date)
        badges.push(`納品日: ${parsedOrder.delivery_date}`)
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

      // 3. 品目・数量
      const firstItem = parsedOrder.items?.[0]
      if (firstItem) {
        const pName = firstItem.product_name || firstItem.raw_name || ''
        const matchedProd = products.find(
          (p) => p.name.includes(pName) || pName.includes(p.name) || (pName.includes('チンゲン') && p.name.includes('青梗菜')),
        )
        if (matchedProd) {
          setProductId(matchedProd.id)
          setSelectedCategory(resolveProductCategory(matchedProd))
          badges.push(`品目: ${matchedProd.name}`)
        }
        if (firstItem.cases != null && firstItem.cases > 0) {
          setQtyRaw(`${firstItem.cases}c`)
          badges.push(`数量: ${firstItem.cases}ケース`)
        } else if (firstItem.quantity) {
          setQtyRaw(String(firstItem.quantity))
          badges.push(`数量: ${firstItem.quantity} P`)
        }
      }

      setConfirmedBadges(badges)
      toast.success('画像を読み取りました！内容を確認してください')
    } catch (err: unknown) {
      toast.error((err as Error)?.message || '読み取りに失敗しました')
    } finally {
      setAnalyzingPhoto(false)
    }
  }

  // 取引先その場作成
  async function createCustomer() {
    const name = newCustomerName.trim()
    if (!name) return
    setCreatingCustomer(true)
    try {
      const res = await fetch('/api/customers/quick', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const json = await res.json()
      if (!res.ok || !json.id) throw new Error(json.error ?? '作成失敗')
      setCustomers((prev) => (prev.some((c) => c.id === json.id) ? prev : [...prev, { id: json.id, name: json.name }]))
      setCustomerId(json.id)
      setNewCustomerName('')
      setShowNewCustomer(false)
      toast.success(`「${json.name}」を作成しました`)
    } catch (e: unknown) {
      toast.error(fieldErrorMessage(e, '作成に失敗しました'))
    } finally {
      setCreatingCustomer(false)
    }
  }

  // -------------------------------------------------------------
  // ステップ1: 確認画面への遷移バリデーション
  // -------------------------------------------------------------
  function proceedToConfirm() {
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
          quantity_raw: qtyRaw,
          destination_id: destinationId || null,
          mode,
          note: note.trim() || undefined,
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

      // リセット
      setIsOpen(false)
      setStep('input')
      setQtyRaw('')
      setNaturalText('')
      setPhotoPreview(null)
      setConfirmedBadges([])
      setUncertainItems([])
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
                {existingShipmentInfo && mode !== 'create' ? (
                  <div className="space-y-1">
                    <div className="flex items-center gap-3 text-sm">
                      <span className="text-ink-muted font-bold line-through">
                        修正前: {existingShipmentInfo.current_quantity} {unit}
                      </span>
                      <span className="font-black text-forest-700 text-lg">
                        ➔ 修正後:{' '}
                        {(() => {
                          const delta = preview && preview.type === 'ok' ? preview.total.toNumber() : 0
                          if (mode === 'increase') return existingShipmentInfo.current_quantity + delta
                          if (mode === 'decrease') return Math.max(0, existingShipmentInfo.current_quantity - delta)
                          return delta
                        })()}{' '}
                        {unit}
                      </span>
                    </div>
                    <p className="text-xs font-bold text-forest-800">
                      （差分: {mode === 'increase' ? '+' : mode === 'decrease' ? '-' : ''}
                      {previewText?.text}）
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
            {/* 📷 写真隠しInput */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) handlePhotoFile(file)
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
                if (file) handlePhotoFile(file)
              }}
              className="hidden"
              id="shipment-gallery-input-unified"
            />

            {/* ① スマート入力エリア（自然言語 ＋ 写真） */}
            <div className="rounded-2xl border-2 border-forest-200 bg-gradient-to-br from-forest-50/70 to-emerald-50/40 p-4 space-y-3 shadow-2xs">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs font-black text-forest-900">
                  <Sparkles className="h-4 w-4 text-forest-600" />
                  自然言語・メモ・写真からスマート入力
                </span>
                <div className="flex items-center gap-2">
                  <label
                    htmlFor="shipment-camera-input-unified"
                    className="inline-flex items-center gap-1 cursor-pointer rounded-lg border border-forest-300 bg-white px-2 py-1 text-xs font-bold text-forest-800 hover:bg-forest-50 shadow-2xs active:scale-95"
                    title="カメラで撮影"
                  >
                    <Camera className="h-3.5 w-3.5 text-forest-600" />
                    <span>撮影</span>
                  </label>
                  <label
                    htmlFor="shipment-gallery-input-unified"
                    className="inline-flex items-center gap-1 cursor-pointer rounded-lg border border-sky-300 bg-white px-2 py-1 text-xs font-bold text-sky-800 hover:bg-sky-50 shadow-2xs active:scale-95"
                    title="画像から選択"
                  >
                    <ImageIcon className="h-3.5 w-3.5 text-sky-600" />
                    <span>画像</span>
                  </label>
                </div>
              </div>

              {/* 自然言語入力欄 */}
              <div className="relative">
                <textarea
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

              {/* 納品日 */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-black text-ink">納品日（出荷日）</label>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setTargetDate(todayStr)}
                      className={cn(
                        'rounded-md px-2 py-0.5 text-xs font-bold transition-colors',
                        targetDate === todayStr ? 'bg-forest-600 text-white' : 'bg-sand-100 text-ink hover:bg-sand-200',
                      )}
                    >
                      今日
                    </button>
                    <button
                      type="button"
                      onClick={() => setTargetDate(tomorrowStr)}
                      className={cn(
                        'rounded-md px-2 py-0.5 text-xs font-bold transition-colors',
                        targetDate === tomorrowStr ? 'bg-forest-600 text-white' : 'bg-sand-100 text-ink hover:bg-sand-200',
                      )}
                    >
                      明日
                    </button>
                    <button
                      type="button"
                      onClick={() => setTargetDate(dayAfterTomorrowStr)}
                      className={cn(
                        'rounded-md px-2 py-0.5 text-xs font-bold transition-colors',
                        targetDate === dayAfterTomorrowStr ? 'bg-forest-600 text-white' : 'bg-sand-100 text-ink hover:bg-sand-200',
                      )}
                    >
                      明後日
                    </button>
                  </div>
                </div>
                <Input
                  type="date"
                  value={targetDate}
                  onChange={(e) => setTargetDate(e.target.value)}
                  className="h-9 text-xs"
                />
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

              {/* 取引先インライン作成 */}
              {showNewCustomer && (
                <div className="flex flex-wrap items-end gap-2 rounded-xl border border-forest-300 bg-forest-50/70 p-3">
                  <Input
                    label="新しい取引先の名前"
                    placeholder="例：株式会社○○"
                    value={newCustomerName}
                    onChange={(e) => setNewCustomerName(e.target.value)}
                    className="min-w-[12rem] flex-1"
                    autoFocus
                  />
                  <Button onClick={createCustomer} isLoading={creatingCustomer} className="h-10 text-xs">
                    作成して使う
                  </Button>
                  <Button
                    variant="tertiary"
                    onClick={() => {
                      setShowNewCustomer(false)
                      setNewCustomerName('')
                    }}
                    className="h-10 text-xs"
                  >
                    閉じる
                  </Button>
                </div>
              )}

              {/* 納入先セレクト */}
              {customerDestinations.length > 0 && (
                <Select
                  label={`納入先${destinationRequired ? '（必須）' : '（任意）'}`}
                  placeholder="納入先を選択..."
                  value={destinationId}
                  onChange={(e) => setDestinationId(e.target.value)}
                  options={customerDestinations.map((d) => ({ value: d.id, label: d.label }))}
                />
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

              {/* 数量入力 */}
              <div className="space-y-1.5">
                <Input
                  label={`数量（単位: ${unit}）`}
                  placeholder="例: 10 / 15c / x58"
                  inputMode="text"
                  value={qtyRaw}
                  onChange={(e) => setQtyRaw(e.target.value)}
                  hint="バラ数（10）、ケース記法（15c = 15ケース）、x記法（x58）が入力できます"
                />
              </div>

              {/* 数量リアルタイム換算プレビュー */}
              {previewText && (
                <div
                  className={cn(
                    'rounded-xl p-3 text-sm font-bold',
                    previewText.kind === 'error'
                      ? 'border border-red-200 bg-red-50 text-alert'
                      : 'border border-emerald-200 bg-emerald-50 text-forest-900',
                  )}
                >
                  <p>{previewText.text}</p>
                  {previewText.kind === 'error' && previewText.reason === 'packs_per_case_required' && customerId && (
                    <Link
                      href={`/admin/customers/${customerId}`}
                      className="mt-1 inline-flex items-center gap-0.5 text-xs font-bold text-trust-700 underline underline-offset-2 hover:text-trust-800"
                    >
                      取引先設定を開く
                      <ArrowRight className="h-3 w-3" aria-hidden />
                    </Link>
                  )}
                </div>
              )}

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
      </Modal>
    </>
  )
}
