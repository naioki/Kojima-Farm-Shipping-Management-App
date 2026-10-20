'use client'

import { useEffect, useMemo, useState, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Plus, ArrowRight, UserPlus, PackagePlus, Check, Sparkles, Camera, Loader2, AlertCircle, Calendar } from 'lucide-react'
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
  /** 取引先配下の納入先（届け先）。複数持つ取引先で「納入先」セレクトを出す。 */
  destinations: { id: string; customerId: string; label: string }[]
  /** `${customer_id}:${product_id}` → packs_per_case（c記法プレビュー用） */
  packsByPair: Record<string, number | null>
}

type LocalCustomer = { id: string; name: string }
type LocalProduct = { id: string; name: string; unit: string; category?: string | null }

const UNGROUPED_LABEL = 'その他'
const CATEGORY_PRIORITY = ['チンゲン菜', 'キュウリ', 'トマト', 'ネギ']

/** 品目・規格から大分類（category）を安全に解決（未設定マスタも名前から賢く分類） */
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

/**
 * 出荷一覧の「スマート追加」フォーム。
 * 普段は「＋ 新規出荷を追加」ボタンとしてスッキリ配置し、タップでモーダル展開。
 * 1. 📷 写真・メモから自動読込 ＆ 不足項目のAI聞き返し（対話的確定）
 * 2. ✏️ 手動で品目・規格を選んで追加
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
  const [mode, setMode] = useState<'photo' | 'manual'>('photo')

  // 現場がその場で作った取引先・品目を即リストへ反映する（楽観追加）ためローカル state で保持。
  const [customers, setCustomers] = useState<LocalCustomer[]>(initialCustomers)
  const [products, setProducts] = useState<LocalProduct[]>(initialProducts)
  const [customerId, setCustomerId] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string>('')
  const [productId, setProductId] = useState('')
  const [destinationId, setDestinationId] = useState('')
  const [qtyRaw, setQtyRaw] = useState('')
  const [targetDate, setTargetDate] = useState(deliveryDate)
  const [submitting, setSubmitting] = useState(false)

  // 画像・カメラ読み取り & AI聞き返し用 state
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [analyzingPhoto, setAnalyzingPhoto] = useState(false)
  const [missingDatePrompt, setMissingDatePrompt] = useState(false)
  const [rawAiCustomerName, setRawAiCustomerName] = useState<string | null>(null)
  const [rawAiProductName, setRawAiProductName] = useState<string | null>(null)

  // インライン新規作成パネルの開閉と入力値。
  const [showNewCustomer, setShowNewCustomer] = useState(false)
  const [newCustomerName, setNewCustomerName] = useState('')
  const [creatingCustomer, setCreatingCustomer] = useState(false)
  const [showNewProduct, setShowNewProduct] = useState(false)
  const [newProductName, setNewProductName] = useState('')
  const [newProductUnit, setNewProductUnit] = useState('')
  const [creatingProduct, setCreatingProduct] = useState(false)

  // 親からの再取得で初期リストが更新されたら追従
  useEffect(() => setCustomers(initialCustomers), [initialCustomers])
  useEffect(() => setProducts(initialProducts), [initialProducts])
  useEffect(() => setTargetDate(deliveryDate), [deliveryDate])

  // 品目をカテゴリ（大分類）ごとにグループ化
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

  // 初期カテゴリ・品目の選択
  useEffect(() => {
    if (categoryGroups.length > 0 && !selectedCategory) {
      const defaultGroup = categoryGroups[0]!
      setSelectedCategory(defaultGroup.category)
      if (defaultGroup.products.length > 0 && !productId) {
        setProductId(defaultGroup.products[0]!.id)
      }
    }
  }, [categoryGroups, selectedCategory, productId])

  // 選択中カテゴリに属する商品（規格）一覧
  const activeGroup = useMemo(() => {
    return categoryGroups.find((g) => g.category === selectedCategory) ?? categoryGroups[0]
  }, [categoryGroups, selectedCategory])

  const categoryProducts = activeGroup?.products ?? []

  // カテゴリ切り替え時のハンドラ
  const handleSelectCategory = (cat: string) => {
    setSelectedCategory(cat)
    const grp = categoryGroups.find((g) => g.category === cat)
    if (grp && grp.products.length > 0) {
      setProductId(grp.products[0]!.id)
    }
  }

  /** 取引先をその場で作成 */
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
        body: JSON.stringify({ name }),
      })
      const json = (await res.json().catch(() => ({}))) as { id?: string; name?: string; existed?: boolean; error?: string }
      if (!res.ok || !json.id) throw new Error(json.error ?? `作成に失敗 (${res.status})`)
      setCustomers((prev) => (prev.some((c) => c.id === json.id) ? prev : [...prev, { id: json.id!, name: json.name! }]))
      setCustomerId(json.id)
      setNewCustomerName('')
      setShowNewCustomer(false)
      toast.success(json.existed ? `既存の「${json.name}」に紐付けました` : `「${json.name}」を作成しました`)
    } catch (e) {
      toast.error(fieldErrorMessage(e, '取引先の作成に失敗しました'))
    } finally {
      setCreatingCustomer(false)
    }
  }

  /** 品目をその場で作成 */
  async function createProduct() {
    const name = newProductName.trim()
    if (!name) {
      toast.error('品目名を入力してください')
      return
    }
    setCreatingProduct(true)
    try {
      const res = await fetch('/api/products/quick', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, unit: newProductUnit.trim() || '個' }),
      })
      const json = (await res.json().catch(() => ({}))) as { id?: string; name?: string; unit?: string; existed?: boolean; error?: string }
      if (!res.ok || !json.id) throw new Error(json.error ?? `作成に失敗 (${res.status})`)
      const newP: LocalProduct = { id: json.id!, name: json.name!, unit: json.unit || '個' }
      setProducts((prev) => (prev.some((p) => p.id === newP.id) ? prev : [...prev, newP]))
      setProductId(json.id)
      setNewProductName('')
      setNewProductUnit('')
      setShowNewProduct(false)
      toast.success(json.existed ? `既存の「${json.name}」に紐付けました` : `「${json.name}」を作成しました`)
    } catch (e) {
      toast.error(fieldErrorMessage(e, '品目の作成に失敗しました'))
    } finally {
      setCreatingProduct(false)
    }
  }

  // 選択中の取引先に紐づく納入先
  const customerDestinations = useMemo(
    () => destinations.filter((d) => d.customerId === customerId),
    [destinations, customerId],
  )

  useEffect(() => {
    if (customerDestinations.length === 1) setDestinationId(customerDestinations[0]!.id)
    else setDestinationId('')
  }, [customerId, customerDestinations])

  const selectedProduct = products.find((p) => p.id === productId)
  const unit = selectedProduct?.unit ?? '個'
  const packsPerCase = customerId && productId ? packsByPair[`${customerId}:${productId}`] ?? null : null

  // ライブプレビュー
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
      parts.push(`（${preview.cases}ケース × ${packsPerCase} + 端数${preview.loose}）`)
    }
    if (preview.interpretation === 'x_total') parts.push('（x記法：x の後の数字を合計とみなす）')
    return { kind: 'ok' as const, text: parts.join(' ') }
  })()

  const destinationRequired = customerDestinations.length >= 2

  /**
   * スマホ撮影写真（5MB〜12MB）による 413 Payload Too Large を防ぐため、
   * クライアント側で長辺最大 1600px・JPEG品質 0.8 に縮小圧縮する。
   */
  async function compressImageFile(file: File): Promise<{ dataUrl: string; base64: string; mime: string }> {
    if (!file.type.startsWith('image/')) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = (e) => {
          const dataUrl = e.target?.result as string
          resolve({
            dataUrl,
            base64: dataUrl.split(',')[1] || '',
            mime: file.type || 'application/octet-stream',
          })
        }
        reader.onerror = reject
        reader.readAsDataURL(file)
      })
    }

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
            resolve({
              dataUrl,
              base64: dataUrl.split(',')[1] || '',
              mime: file.type || 'image/jpeg',
            })
            return
          }
          ctx.drawImage(img, 0, 0, width, height)
          const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.8)
          const base64 = compressedDataUrl.split(',')[1] || ''
          resolve({
            dataUrl: compressedDataUrl,
            base64,
            mime: 'image/jpeg',
          })
        }
        img.onerror = () => {
          const dataUrl = e.target?.result as string
          resolve({
            dataUrl,
            base64: dataUrl.split(',')[1] || '',
            mime: file.type || 'image/jpeg',
          })
        }
        img.src = e.target?.result as string
      }
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  // 📷 写真アップロード & AI解析ハンドラ
  async function handlePhotoFile(file: File) {
    if (fileInputRef.current) fileInputRef.current.value = ''
    setAnalyzingPhoto(true)
    setMissingDatePrompt(false)
    setRawAiCustomerName(null)
    setRawAiProductName(null)

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
        toast('注文情報を特定できませんでした。手動で入力してください。', { icon: 'ℹ️' })
        setMode('manual')
        return
      }

      // 1. 取引先マッチング
      const cName = parsedOrder.customer_name?.trim() || ''
      setRawAiCustomerName(cName || null)
      const matchedCust = customers.find(
        (c) => c.name.includes(cName) || cName.includes(c.name),
      )
      if (matchedCust) {
        setCustomerId(matchedCust.id)
      }

      // 2. 納品日の確認・聞き返し
      if (parsedOrder.delivery_date) {
        setTargetDate(parsedOrder.delivery_date)
        setMissingDatePrompt(false)
      } else {
        // 日付が不明な場合は聞き返しプロンプトをONにする
        setMissingDatePrompt(true)
      }

      // 3. 品目・数量のマッチング
      const firstItem = parsedOrder.items?.[0]
      if (firstItem) {
        const pName = firstItem.product_name || firstItem.raw_name || ''
        setRawAiProductName(pName)
        const matchedProd = products.find(
          (p) => p.name.includes(pName) || pName.includes(p.name) || (pName.includes('チンゲン') && p.name.includes('青梗菜')),
        )
        if (matchedProd) {
          setProductId(matchedProd.id)
          setSelectedCategory(resolveProductCategory(matchedProd))
        }

        if (firstItem.cases != null && firstItem.cases > 0) {
          setQtyRaw(`${firstItem.cases}c`)
        } else if (firstItem.quantity) {
          setQtyRaw(String(firstItem.quantity))
        }
      }

      toast.success('画像を読み取りました！内容を確認して確定してください')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '読み取りに失敗しました')
    } finally {
      setAnalyzingPhoto(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  // 納品日クイック計算
  const tomorrowStr = useMemo(() => {
    const d = new Date()
    d.setDate(d.getDate() + 1)
    return d.toISOString().split('T')[0] || ''
  }, [])

  async function submit() {
    if (!customerId || !productId || qtyRaw.trim() === '') {
      toast.error('取引先・品目・数量をすべて入力してください')
      return
    }
    if (destinationRequired && !destinationId) {
      toast.error('納入先を選択してください')
      return
    }
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
        }),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        throw new Error(ADD_ERRORS[json.error ?? ''] ?? json.error ?? `追加に失敗 (${res.status})`)
      }
      toast.success('出荷を追加しました')
      setQtyRaw('')
      setPhotoPreview(null)
      setIsOpen(false)
      router.refresh()
    } catch (e) {
      toast.error(fieldErrorMessage(e, '追加に失敗しました'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      {/* 画面内：通常位置の新規出荷追加トリガー */}
      <div
        className="rounded-2xl border-2 border-dashed border-emerald-300 bg-emerald-50/60 p-4 transition-all hover:border-emerald-400 hover:bg-emerald-50"
        data-guide="smart-add"
      >
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-center sm:text-left">
          <div className="space-y-0.5">
            <h2 className="font-display text-base font-bold text-forest-950 flex items-center justify-center sm:justify-start gap-1.5">
              <Sparkles className="h-4 w-4 text-forest-600" aria-hidden />
              <span>当日出荷の追加</span>
            </h2>
            <p className="text-xs text-forest-700">
              写真撮影（手書きメモ・FAX）または手動選択で、出荷明細を即座に追加できます。
            </p>
          </div>
          <Button
            type="button"
            onClick={() => setIsOpen(true)}
            size="lg"
            className="w-full sm:w-auto shrink-0 bg-forest-600 hover:bg-forest-700 text-white font-black px-6 py-3 rounded-xl shadow-md text-sm flex items-center justify-center gap-2 active:scale-95 transition"
          >
            <Plus className="h-5 w-5" aria-hidden />
            ＋ 新規出荷を追加
          </Button>
        </div>
      </div>

      {/* 新規追加モーダルダイアログ */}
      <Modal
        open={isOpen}
        onClose={() => setIsOpen(false)}
        title="新規出荷の追加"
        className="max-w-lg max-h-[92vh] overflow-y-auto"
        footer={
          <div className="flex w-full items-center justify-end gap-2.5">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setIsOpen(false)}
              disabled={submitting}
            >
              キャンセル
            </Button>
            <Button
              type="button"
              onClick={submit}
              isLoading={submitting}
              className="bg-forest-600 hover:bg-forest-700 text-white font-bold px-6"
            >
              <Check className="h-4 w-4" aria-hidden />
              この内容で出荷を追加
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          {/* モード切り替えタブ */}
          <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-bg-soft border border-line">
            <button
              type="button"
              onClick={() => setMode('photo')}
              className={cn(
                'py-2 text-xs font-bold rounded-lg transition-all',
                mode === 'photo' ? 'bg-white shadow-xs text-ink' : 'text-ink-soft hover:text-ink',
              )}
            >
              📷 写真/メモから自動読込
            </button>
            <button
              type="button"
              onClick={() => setMode('manual')}
              className={cn(
                'py-2 text-xs font-bold rounded-lg transition-all',
                mode === 'manual' ? 'bg-white shadow-xs text-ink' : 'text-ink-soft hover:text-ink',
              )}
            >
              ✏️ 手動で選択・入力
            </button>
          </div>

          {mode === 'photo' && (
            <div className="space-y-3">
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
                id="shipment-camera-input"
              />

              {!photoPreview ? (
                <label
                  htmlFor="shipment-camera-input"
                  className="flex flex-col items-center justify-center p-6 border-2 border-dashed border-emerald-300 bg-emerald-50/50 rounded-2xl cursor-pointer hover:bg-emerald-50 transition-all text-center"
                >
                  <Camera className="h-10 w-10 text-emerald-600 mb-2" />
                  <span className="text-sm font-bold text-ink">スマホで写真を撮る / 画像を選ぶ</span>
                  <span className="text-xs text-ink-soft mt-1">
                    手書きメモ、急なFAX、注文伝票を撮影するとAIが自動入力します
                  </span>
                </label>
              ) : (
                <div className="space-y-3">
                  <div className="relative rounded-xl border border-line overflow-hidden bg-black/5 p-2 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <img src={photoPreview} alt="アップロード画像" className="h-14 w-14 object-cover rounded-lg border border-line" />
                      <div>
                        <p className="text-xs font-bold text-ink">画像を読み込みました</p>
                        <p className="text-[11px] text-ink-soft">内容を確認・補完してください</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setPhotoPreview(null)
                        setMissingDatePrompt(false)
                      }}
                      className="text-xs text-alert hover:underline font-bold px-2 py-1"
                    >
                      撮り直す
                    </button>
                  </div>

                  {analyzingPhoto && (
                    <div className="flex items-center justify-center gap-2 rounded-xl bg-forest-50 p-4 text-sm font-bold text-forest-800 border border-forest-200">
                      <Loader2 className="h-5 w-5 animate-spin text-forest-600" />
                      <span>AIが注文内容を解析中...</span>
                    </div>
                  )}

                  {/* AI聞き返しカード（日付が抜けている場合） */}
                  {missingDatePrompt && (
                    <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-3.5 space-y-2">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-amber-900">
                        <AlertCircle className="h-4 w-4 text-amber-600" />
                        <span>⚠️ 納品日が記載されていませんでした。納品日はいつにしますか？</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => {
                            setTargetDate(deliveryDate)
                            setMissingDatePrompt(false)
                          }}
                          className={cn(
                            'h-10 rounded-lg border text-xs font-bold shadow-xs',
                            targetDate === deliveryDate
                              ? 'border-emerald-500 bg-emerald-600 text-white'
                              : 'border-line bg-white text-ink hover:bg-bg-soft',
                          )}
                        >
                          今日 ({deliveryDate})
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setTargetDate(tomorrowStr)
                            setMissingDatePrompt(false)
                          }}
                          className={cn(
                            'h-10 rounded-lg border text-xs font-bold shadow-xs',
                            targetDate === tomorrowStr
                              ? 'border-emerald-500 bg-emerald-600 text-white'
                              : 'border-line bg-white text-ink hover:bg-bg-soft',
                          )}
                        >
                          明日 ({tomorrowStr})
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* 共通の確認・手動入力フォーム */}
          <div className="space-y-3 pt-1 border-t border-line/60">
            {/* 納品日 */}
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-ink-muted">納品日</span>
              <div className="flex items-center gap-1.5">
                <Input
                  type="date"
                  value={targetDate}
                  onChange={(e) => setTargetDate(e.target.value)}
                  className="h-8 text-xs"
                />
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
              {rawAiCustomerName && !customerId && (
                <p className="text-xs text-amber-700 bg-amber-50 p-1.5 rounded">
                  💡 画像の発信元: 「{rawAiCustomerName}」。上の取引先から選択してください。
                </p>
              )}
              {!showNewCustomer && (
                <div className="text-right">
                  <button
                    type="button"
                    onClick={() => setShowNewCustomer(true)}
                    className="inline-flex items-center gap-1 text-xs text-ink-faint hover:text-trust-600"
                  >
                    <UserPlus className="h-3 w-3" aria-hidden />
                    新しい取引先を登録
                  </button>
                </div>
              )}
            </div>

            {/* インライン取引先新規登録 */}
            {showNewCustomer && (
              <div className="flex flex-wrap items-end gap-2 rounded-lg border border-earth-200 bg-earth-50/60 p-3">
                <Input
                  label="新しい取引先の名前"
                  placeholder="例：株式会社○○"
                  value={newCustomerName}
                  onChange={(e) => setNewCustomerName(e.target.value)}
                  className="min-w-[12rem] flex-1"
                  autoFocus
                />
                <Button onClick={createCustomer} isLoading={creatingCustomer} className="h-10">
                  作成して使う
                </Button>
                <Button
                  variant="tertiary"
                  onClick={() => {
                    setShowNewCustomer(false)
                    setNewCustomerName('')
                  }}
                  className="h-10"
                >
                  やめる
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

            {/* 品目選択 */}
            <div className="space-y-2">
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
                        ? 'border-forest-600 bg-forest-50 text-forest-900 ring-2 ring-forest-600'
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

            {/* ライブプレビュー */}
            {previewText && (
              <div
                className={cn(
                  'rounded-xl p-3 text-sm font-medium',
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
          </div>
        </div>
      </Modal>
    </>
  )
}
