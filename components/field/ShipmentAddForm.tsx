'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Plus, ArrowRight, UserPlus, PackagePlus, Check, Sparkles } from 'lucide-react'
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
 * 品目（大分類）→ 規格（荷姿・バラ/平箱等）の2段階選択で、現場の誤タップ・縦長スクロールを根絶。
 */
export function ShipmentAddForm({
  deliveryDate,
  customers: initialCustomers,
  products: initialProducts,
  destinations = [],
  packsByPair,
}: ShipmentAddFormProps) {
  const router = useRouter()
  // モーダルの開閉状態
  const [isOpen, setIsOpen] = useState(false)

  // 現場がその場で作った取引先・品目を即リストへ反映する（楽観追加）ためローカル state で保持。
  const [customers, setCustomers] = useState<LocalCustomer[]>(initialCustomers)
  const [products, setProducts] = useState<LocalProduct[]>(initialProducts)
  const [customerId, setCustomerId] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string>('')
  const [productId, setProductId] = useState('')
  const [destinationId, setDestinationId] = useState('')
  const [qtyRaw, setQtyRaw] = useState('')
  const [submitting, setSubmitting] = useState(false)

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

    return sortedCategories.map((cat) => ({
      category: cat,
      products: map.get(cat)!,
    }))
  }, [products])

  // 初期カテゴリ・品目の自動補完
  useEffect(() => {
    if (categoryGroups.length > 0 && (!selectedCategory || !categoryGroups.some((g) => g.category === selectedCategory))) {
      const firstCat = categoryGroups[0]!.category
      setSelectedCategory(firstCat)
      const catProds = categoryGroups[0]!.products
      if (catProds.length > 0 && !productId) {
        setProductId(catProds[0]!.id)
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
        body: JSON.stringify({ name, base_unit: newProductUnit.trim() || '個' }),
      })
      const json = (await res.json().catch(() => ({}))) as {
        id?: string; name?: string; unit?: string; existed?: boolean; error?: string
      }
      if (!res.ok || !json.id) throw new Error(json.error ?? `作成に失敗 (${res.status})`)
      const unit = json.unit ?? newProductUnit.trim() ?? '個'
      const newProd: LocalProduct = { id: json.id!, name: json.name!, unit }
      setProducts((prev) => (prev.some((p) => p.id === json.id) ? prev : [...prev, newProd]))
      const newCat = resolveProductCategory(newProd)
      setSelectedCategory(newCat)
      setProductId(json.id!)
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
          delivery_date: deliveryDate,
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
              <span>当日出荷の手動追加</span>
            </h2>
            <p className="text-xs text-forest-700">
              電話注文や追加出荷を、品目・規格を選んで当日の出荷明細に即座に追加できます。
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

      {/* モバイル用フローティング追加ボタン（下部固定ナビバーと重ならないよう十分な高さを確保・背景と境界を明確化） */}
      <div
        className="fixed right-4 z-40 sm:hidden"
        style={{ bottom: 'calc(5rem + env(safe-area-inset-bottom, 0px))' }}
      >
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="flex h-14 w-14 items-center justify-center rounded-full bg-forest-600 text-white shadow-xl border-2 border-white ring-2 ring-forest-700/20 hover:bg-forest-700 active:scale-90 transition-all focus:outline-none focus:ring-4 focus:ring-forest-300/50"
          aria-label="出荷を新規追加"
        >
          <Plus className="h-7 w-7" aria-hidden />
        </button>
      </div>

      {/* 新規追加モーダルダイアログ */}
      <Modal
        open={isOpen}
        onClose={() => setIsOpen(false)}
        title={`新規出荷の追加（${deliveryDate}）`}
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
              <Plus className="h-4 w-4" aria-hidden />
              出荷を追加
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
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
                placeholder="例：マルショク青果"
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

          {/* 納入先セレクト（複数ある取引先のみ） */}
          {customerDestinations.length >= 2 && (
            <Select
              label="納入先"
              required
              placeholder="納入先を選択..."
              value={destinationId}
              onChange={(e) => setDestinationId(e.target.value)}
              options={customerDestinations.map((d) => ({ value: d.id, label: d.label }))}
            />
          )}

          {/* ① 品目グループ（大分類：きゅうり、チンゲン菜、トマト、ネギ等） */}
          <div className="space-y-1.5">
            <label className="block text-sm font-bold text-ink">
              ① 品目（野菜） <span className="text-alert">*</span>
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {categoryGroups.map((g) => {
                const isSelected = selectedCategory === g.category
                return (
                  <button
                    key={g.category}
                    type="button"
                    onClick={() => handleSelectCategory(g.category)}
                    className={cn(
                      'py-2.5 px-3 rounded-xl text-sm font-bold border transition-all text-center flex items-center justify-center gap-1 active:scale-95',
                      isSelected
                        ? 'bg-forest-600 border-forest-600 text-white shadow-sm ring-2 ring-forest-200'
                        : 'bg-white border-line text-ink hover:bg-forest-50 hover:border-forest-300'
                    )}
                  >
                    {isSelected && <Check className="h-3.5 w-3.5" aria-hidden />}
                    <span>{g.category}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* ② 規格・荷姿（バラ、平箱、標準等） */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="block text-sm font-bold text-ink">
                ② 規格・荷姿 <span className="text-alert">*</span>
              </label>
              {!showNewProduct && (
                <button
                  type="button"
                  onClick={() => setShowNewProduct(true)}
                  className="inline-flex items-center gap-1 text-xs text-ink-faint hover:text-trust-600"
                >
                  <PackagePlus className="h-3 w-3" aria-hidden />
                  新しい品目を追加
                </button>
              )}
            </div>

            {categoryProducts.length === 1 ? (
              <div className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50/70 px-3.5 py-2.5 text-xs">
                <div className="flex items-center gap-2">
                  <Check className="h-4 w-4 text-emerald-600 shrink-0" aria-hidden />
                  <span className="font-bold text-emerald-950">
                    規格: {categoryProducts[0]!.name} ({categoryProducts[0]!.unit})
                  </span>
                </div>
                <span className="rounded bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-800">
                  自動選択済
                </span>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {categoryProducts.map((p) => {
                  const isSelected = productId === p.id
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setProductId(p.id)}
                      className={cn(
                        'flex-1 min-w-[95px] py-2.5 px-3 rounded-xl text-xs sm:text-sm font-bold border transition-all text-center flex items-center justify-center gap-1 active:scale-95',
                        isSelected
                          ? 'bg-emerald-600 border-emerald-600 text-white shadow-sm ring-2 ring-emerald-200'
                          : 'bg-white border-line text-ink hover:bg-emerald-50 hover:border-emerald-300'
                      )}
                    >
                      {isSelected && <Check className="h-3.5 w-3.5" aria-hidden />}
                      <span>{p.name}</span>
                      <span className="text-[11px] opacity-80">({p.unit})</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* インライン品目新規登録 */}
          {showNewProduct && (
            <div className="flex flex-wrap items-end gap-2 rounded-lg border border-earth-200 bg-earth-50/60 p-3">
              <Input
                label="新しい品目の名前"
                placeholder="例：ミニトマト"
                value={newProductName}
                onChange={(e) => setNewProductName(e.target.value)}
                className="min-w-[12rem] flex-1"
                autoFocus
              />
              <Input
                label="基準単位"
                placeholder="個 / 本 / 束 / kg"
                value={newProductUnit}
                onChange={(e) => setNewProductUnit(e.target.value)}
                className="w-28"
              />
              <Button onClick={createProduct} isLoading={creatingProduct} className="h-10">
                作成して使う
              </Button>
              <Button
                variant="tertiary"
                onClick={() => {
                  setShowNewProduct(false)
                  setNewProductName('')
                  setNewProductUnit('')
                }}
                className="h-10"
              >
                やめる
              </Button>
            </div>
          )}

          {/* 数量入力 */}
          <div className="space-y-1.5">
            <Input
              label={`数量（単位: ${unit}）`}
              placeholder="例: 10 / 15c2 / x58"
              inputMode="text"
              value={qtyRaw}
              onChange={(e) => setQtyRaw(e.target.value)}
              hint="バラ数（10）、ケース記法（15c2 = 15ケース+2袋）、x記法（x58）が入力できます"
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
      </Modal>
    </>
  )
}
