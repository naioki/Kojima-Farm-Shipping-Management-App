'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Plus, ArrowRight, UserPlus, PackagePlus } from 'lucide-react'
import toast from 'react-hot-toast'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { Input } from '@/components/ui/Input'
import { Card } from '@/components/ui/Card'
import { parseQuantity } from '@/lib/calculations/parse-quantity'

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

const ADD_ERRORS: Record<string, string> = {
  packs_per_case_required: 'ケース記法ですが P/C（1ケースの入数）が未設定です。取引先設定で登録してください。',
  unparseable: '数量を解釈できませんでした（例: 10 / 15c2 / x58）。',
  negative: '数量が負の値です。',
  empty_quantity: '数量を入力してください。',
  unknown_product: '商品が見つかりません。',
}

/**
 * 出荷一覧の「スマート追加」フォーム（Laravel版 画面2）。
 * 取引先・品目・数量（"15c2" 等の混在記号可）を入れて1件追加。
 * 入力中はスマートパース結果をライブプレビュー（誤解釈を投入前に気づける・features.md §5）。
 */
// destinations は既定 [] で防御（HMR/古いチャンク混在で prop が欠けても画面全体を落とさない）
export function ShipmentAddForm({
  deliveryDate,
  customers: initialCustomers,
  products: initialProducts,
  destinations = [],
  packsByPair,
}: ShipmentAddFormProps) {
  const router = useRouter()
  // 現場がその場で作った取引先・品目を即リストへ反映する（楽観追加）ためローカル state で保持。
  const [customers, setCustomers] = useState<LocalCustomer[]>(initialCustomers)
  const [products, setProducts] = useState<LocalProduct[]>(initialProducts)
  const [customerId, setCustomerId] = useState('')
  const [productId, setProductId] = useState('')
  const [destinationId, setDestinationId] = useState('')
  const [qtyRaw, setQtyRaw] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // インライン新規作成パネルの開閉と入力値。ドロップダウンの選択肢には混ぜず、
  // 「たまにしか使わない」操作として控えめなリンクの開閉だけで出す（日常操作の邪魔をしない）。
  const [showNewCustomer, setShowNewCustomer] = useState(false)
  const [newCustomerName, setNewCustomerName] = useState('')
  const [creatingCustomer, setCreatingCustomer] = useState(false)
  const [showNewProduct, setShowNewProduct] = useState(false)
  const [newProductName, setNewProductName] = useState('')
  const [newProductUnit, setNewProductUnit] = useState('')
  const [creatingProduct, setCreatingProduct] = useState(false)

  // 親からの再取得で初期リストが更新されたら追従（router.refresh 後など）。
  useEffect(() => setCustomers(initialCustomers), [initialCustomers])
  useEffect(() => setProducts(initialProducts), [initialProducts])

  /** 取引先をその場で作成（既存があれば既存に紐付け）。成功で選択状態にする。 */
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
      toast.error(e instanceof Error ? e.message : '取引先の作成に失敗しました')
    } finally {
      setCreatingCustomer(false)
    }
  }

  /** 品目をその場で作成（同名があれば既存に紐付け）。成功で選択状態にする。 */
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
      setProducts((prev) => (prev.some((p) => p.id === json.id) ? prev : [...prev, { id: json.id!, name: json.name!, unit }]))
      setProductId(json.id)
      setNewProductName('')
      setNewProductUnit('')
      setShowNewProduct(false)
      toast.success(json.existed ? `既存の「${json.name}」に紐付けました` : `「${json.name}」を作成しました`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '品目の作成に失敗しました')
    } finally {
      setCreatingProduct(false)
    }
  }

  // 選択中の取引先に紐づく納入先だけを候補にする（表示は常に「取引先＞納入先」）。
  const customerDestinations = useMemo(
    () => destinations.filter((d) => d.customerId === customerId),
    [destinations, customerId],
  )

  // 取引先が変わったら納入先を初期化：1件なら自動確定・複数なら未選択・0件なら空。
  useEffect(() => {
    if (customerDestinations.length === 1) setDestinationId(customerDestinations[0]!.id)
    else setDestinationId('')
  }, [customerId, customerDestinations])

  const unit = products.find((p) => p.id === productId)?.unit ?? '個'
  const packsPerCase = customerId && productId ? packsByPair[`${customerId}:${productId}`] ?? null : null

  // ライブプレビュー（サーバ側でも同じ lib で再計算して確定する）
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

  // 複数納入先を持つ取引先は届け先未選択だと出荷先が定まらないため必須にする。
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
      toast.success('追加しました')
      setQtyRaw('')
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '追加に失敗しました')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card className="space-y-3" data-guide="smart-add">
      <h2 className="font-display text-base font-bold text-ink">スマート追加</h2>
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
        <Select
          label="取引先"
          placeholder="選択"
          value={customerId}
          onChange={(e) => setCustomerId(e.target.value)}
          options={customers.map((c) => ({ value: c.id, label: c.name }))}
        />
        <Select
          label="品目"
          placeholder="選択"
          value={productId}
          onChange={(e) => setProductId(e.target.value)}
          options={products.map((p) => ({ value: p.id, label: p.name, group: p.category ?? undefined }))}
        />
        <Input
          label="数量"
          placeholder="10 / 15c2 / x58"
          inputMode="text"
          value={qtyRaw}
          onChange={(e) => setQtyRaw(e.target.value)}
          className="sm:w-32"
        />
        <Button onClick={submit} isLoading={submitting} size="lg" className="sm:w-auto">
          <Plus className="h-4 w-4" aria-hidden />
          追加
        </Button>
      </div>
      {/* たまにしか使わない操作なので、普段の入力行とは別の行にして控えめなリンクだけにする
          （メイン行のsm:items-endを崩さないよう、列テンプレートを揃えた別グリッドにする）。 */}
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto]">
        <div>
          {!showNewCustomer && (
            <button
              type="button"
              onClick={() => setShowNewCustomer(true)}
              className="inline-flex items-center gap-1 text-xs text-ink-faint hover:text-trust-600"
            >
              <UserPlus className="h-3 w-3" aria-hidden />
              新しい取引先を追加
            </button>
          )}
        </div>
        <div>
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
      </div>
      {/* インライン新規作成（Issue#20）：admin が登録し忘れても現場が止まらないよう、
          その場で取引先・品目を最小登録できる。同名は自動で既存に紐付く（重複防止）。 */}
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
          <Button onClick={createCustomer} isLoading={creatingCustomer} className="h-11">
            作成して使う
          </Button>
          <Button
            variant="tertiary"
            onClick={() => {
              setShowNewCustomer(false)
              setNewCustomerName('')
            }}
            className="h-11"
          >
            やめる
          </Button>
          <p className="w-full text-xs text-ink-soft">
            名前だけで登録します。色・締め日・規格などは後で管理者が設定できます。
          </p>
        </div>
      )}
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
          <Button onClick={createProduct} isLoading={creatingProduct} className="h-11">
            作成して使う
          </Button>
          <Button
            variant="tertiary"
            onClick={() => {
              setShowNewProduct(false)
              setNewProductName('')
              setNewProductUnit('')
            }}
            className="h-11"
          >
            やめる
          </Button>
          <p className="w-full text-xs text-ink-soft">
            名前と基準単位だけで登録します。荷姿・単価・品目グループは後で管理者が設定できます。
          </p>
        </div>
      )}

      {/* 納入先セレクト：複数納入先を持つ取引先のときだけ表示（1件は自動確定・0件は非表示）。
          「取引先 ＞ 納入先」の表示ルールに従い、取引先選択後に出す。 */}
      {customerDestinations.length >= 2 && (
        <Select
          label="納入先"
          required
          placeholder="選択"
          value={destinationId}
          onChange={(e) => setDestinationId(e.target.value)}
          options={customerDestinations.map((d) => ({ value: d.id, label: d.label }))}
          className="sm:max-w-xs"
        />
      )}
      {previewText && (
        <p className={`text-sm ${previewText.kind === 'error' ? 'text-alert' : 'text-ink-soft'}`}>
          {previewText.text}
          {previewText.kind === 'error' && previewText.reason === 'packs_per_case_required' && customerId && (
            <Link
              href={`/admin/customers/${customerId}`}
              className="ml-1 inline-flex items-center gap-0.5 font-medium text-trust-600 underline underline-offset-2 hover:text-trust-700"
            >
              取引先設定を開く
              <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          )}
        </p>
      )}
    </Card>
  )
}
