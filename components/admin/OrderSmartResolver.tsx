'use client'

import { useState, useRef, useEffect } from 'react'
import {
  Upload,
  Camera,
  FileText,
  Sparkles,
  CheckCircle2,
  RotateCcw,
  HelpCircle,
  X,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { cn } from '@/lib/cn'
import { jstTodayStr, shiftDateStr } from '@/lib/dates'
import {
  findBestMatchingCustomer,
  findBestMatchingDestination,
} from '@/lib/orders/natural-parser'
import type { ClarificationQuestion, ClarificationOption } from '@/lib/orders/clarifications'
import type { ParsedOrder } from '@/lib/gemini/analyze'

export interface ResolvedOrderData {
  customerId?: string
  customerNameHint?: string
  destinationId?: string
  destinationNameHint?: string
  deliveryDate?: string
  shippingTime?: 'am' | 'pm'
  note?: string
  items: Array<{
    product_id: string
    product_name: string
    quantity: string
    unit: string
    unit_price: string
    tax_rate: 8 | 10
    photo_url: string | null
    pack_config_id: string | null
    base_per_selling: number | null
    packs_per_case?: number | null
    cases?: number | null
    remainder_packs?: number | null
    spec?: string | null
    container_type?: string | null
    has_card?: boolean | null
  }>
  originalFile?: {
    base64: string
    mimeType: string
    fileName: string
  }
  allParsedOrders?: ParsedOrder[]
  activeOrderIndex?: number
}

interface OrderSmartResolverProps {
  customers: { id: string; name: string }[]
  destinations: { id: string; customer_id?: string; code?: string | null; full_name: string }[]
  products: {
    id: string
    name: string
    unit: string
    category?: string | null
    photo_url?: string | null
    default_unit_price: number | null
    default_tax_rate: 8 | 10
  }[]
  selectedCustomerId?: string
  onOrderResolved: (data: ResolvedOrderData) => void
  onCustomerCreated?: (newCust: { id: string; name: string }) => void
  onDestinationCreated?: (newDest: { id: string; customer_id: string; full_name: string; code?: string | null }) => void
}

export function OrderSmartResolver({
  customers: initialCustomers,
  destinations: initialDestinations,
  products,
  selectedCustomerId,
  onOrderResolved,
  onCustomerCreated,
  onDestinationCreated,
}: OrderSmartResolverProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const [customers, setCustomers] = useState(initialCustomers)
  const [destinations, setDestinations] = useState(initialDestinations)
  const [isDragging, setIsDragging] = useState(false)
  const [mode, setMode] = useState<'file' | 'text'>('file')
  const [textInput, setTextInput] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [parsedOrders, setParsedOrders] = useState<ParsedOrder[]>([])
  const [activeOrderIdx, setActiveOrderIdx] = useState(0)
  const [questions, setQuestions] = useState<ClarificationQuestion[]>([])
  const [resolvedMap, setResolvedMap] = useState<Record<string, string>>({})
  const [customInputs, setCustomInputs] = useState<Record<string, string>>({})
  const [originalFile, setOriginalFile] = useState<{
    base64: string
    mimeType: string
    fileName: string
  } | null>(null)
  const [creatingMaster, setCreatingMaster] = useState(false)

  useEffect(() => {
    setCustomers(initialCustomers)
  }, [initialCustomers])

  useEffect(() => {
    setDestinations(initialDestinations)
  }, [initialDestinations])

  // ファイルをBase64として読み込む
  const processFile = async (file: File) => {
    const reader = new FileReader()
    reader.onload = async () => {
      const resultStr = reader.result as string
      const base64 = resultStr.includes(',') ? resultStr.split(',')[1]! : resultStr
      const fileInfo = {
        base64,
        mimeType: file.type || 'application/octet-stream',
        fileName: file.name,
      }
      setOriginalFile(fileInfo)
      await runAnalyze(
        {
          imageBase64: base64,
          mimeType: file.type,
          fileName: file.name,
        },
        fileInfo,
      )
    }
    reader.readAsDataURL(file)
  }

  // 解析実行
  const runAnalyze = async (
    payload: {
      imageBase64?: string
      mimeType?: string
      fileName?: string
      text?: string
    },
    fileInfoOverride?: { base64: string; mimeType: string; fileName: string } | null,
  ) => {
    setAnalyzing(true)
    setParsedOrders([])
    setQuestions([])
    setResolvedMap({})
    try {
      const res = await fetch('/api/ocr/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}))
        throw new Error(errJson.error || `解析に失敗しました (${res.status})`)
      }
      const data = await res.json()
      const orders: ParsedOrder[] = data.orders ?? []
      const clarifs: ClarificationQuestion[] = data.clarifications ?? []

      setParsedOrders(orders)
      setQuestions(clarifs)
      setActiveOrderIdx(0)

      if (orders.length === 0) {
        toast('注文内容が読み取れませんでした。テキストまたは別ファイルをお試しください。', {
          icon: '⚠️',
        })
        return
      }

      toast.success(`${orders.length}件の注文・${data.applied_rules_count ?? 0}ルールを解析しました`)

      // 疑問点の有無にかかわらず、抽出できた内容は即座に下部フォームへ反映する（直接編集もワンタップ解決も両方可能にする）
      if (orders[0]) {
        applyOrderToForm(orders[0], {}, 0, orders, fileInfoOverride ?? originalFile)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '解析に失敗しました')
    } finally {
      setAnalyzing(false)
    }
  }

  // 注文データを親フォームの形式にマッピングして反映
  const applyOrderToForm = (
    order: ParsedOrder,
    currentResolved: Record<string, string>,
    orderIdx = activeOrderIdx,
    allOrders = parsedOrders,
    currentFile = originalFile,
    custPool = customers,
    destPool = destinations,
  ) => {
    // ① 取引先の解決（法人格・空白・カナ差を吸収した名寄せ）
    let matchedCustId = ''
    if (order.customer_name) {
      const hit = findBestMatchingCustomer(order.customer_name, custPool)
      if (hit) matchedCustId = hit.id
    }
    const custResolved = currentResolved[`q-cust-${orderIdx}`]
    if (custResolved) matchedCustId = custResolved

    // ② 納入先の解決（取引先が確定していればその取引先配下を優先）
    let matchedDestId = ''
    if (order.destination_name) {
      const hit = findBestMatchingDestination(
        order.destination_name,
        destPool,
        matchedCustId || selectedCustomerId || null,
      )
      if (hit) matchedDestId = hit.id
    }
    const destResolved = currentResolved[`q-dest-${orderIdx}`]
    if (destResolved) matchedDestId = destResolved

    // ③ 出荷日の解決（未定または過去日の場合は初期値として明日をセットしつつ質問カードで選択可能にする）
    const today = jstTodayStr()
    const tomorrow = shiftDateStr(today, 1)
    let finalDate = order.delivery_date && order.delivery_date >= today ? order.delivery_date : tomorrow
    const dateResolved = currentResolved[`q-date-${orderIdx}`]
    if (dateResolved) finalDate = dateResolved

    // ④ 備考の解決
    let finalNote = order.note || ''
    for (let i = 0; i < order.items.length; i++) {
      const replyResolved = currentResolved[`q-reply-${orderIdx}-${i}`]
      if (replyResolved !== undefined) {
        finalNote = replyResolved
      }
    }

    // ⑤ 明細の解決
    const formItems = order.items.map((it, iIdx) => {
      const rawName = (it.product_name || it.raw_name || '').trim().toLowerCase()
      const hitProd =
        products.find((p) => p.name.toLowerCase() === rawName) ||
        products.find(
          (p) =>
            (rawName.includes('チンゲン') && p.name.includes('青梗菜')) ||
            (rawName.includes('青梗菜') && p.name.includes('チンゲン')),
        ) ||
        products.find((p) => rawName.includes(p.name.toLowerCase()) || p.name.toLowerCase().includes(rawName)) ||
        products.find((p) => p.name.includes('青梗菜') || p.name.includes('チンゲン菜')) ||
        products[0]

      let qtyStr = String(it.quantity ?? '').trim()
      // "15c2" 等がそのまま入っている場合は数値化
      const cMatch = qtyStr.match(/^(\d+)\s*c\s*(\d*)$/i)
      if (cMatch) {
        const cNum = Number(cMatch[1])
        const rNum = cMatch[2] ? Number(cMatch[2]) : 0
        const ppc = it.packs_per_case || 20
        qtyStr = String(cNum * ppc + rNum)
      } else {
        const numMatch = qtyStr.match(/(\d+(?:\.\d+)?)/)
        qtyStr = numMatch ? numMatch[1]! : '0'
      }

      const qtyResolved = currentResolved[`q-qty-${orderIdx}-${iIdx}`]
      if (qtyResolved) qtyStr = qtyResolved

      return {
        product_id: hitProd?.id || '',
        product_name: hitProd?.name || it.product_name || '青梗菜',
        quantity: qtyStr,
        unit: hitProd?.unit || it.unit || '袋',
        unit_price: String(hitProd?.default_unit_price || 0),
        tax_rate: (hitProd?.default_tax_rate as 8 | 10) || 8,
        photo_url: hitProd?.photo_url ?? null,
        pack_config_id: null,
        base_per_selling: null,
        packs_per_case: it.packs_per_case ?? null,
        cases: it.cases ?? null,
        remainder_packs: it.remainder_packs ?? null,
        spec: it.spec ?? null,
        container_type: it.container_type ?? null,
        has_card: it.has_card ?? null,
      }
    })

    onOrderResolved({
      customerId: matchedCustId || undefined,
      customerNameHint: order.customer_name || undefined,
      destinationId: matchedDestId || undefined,
      destinationNameHint: order.destination_name || undefined,
      deliveryDate: finalDate,
      shippingTime: 'am',
      note: finalNote,
      items: formItems,
      originalFile: currentFile ?? undefined,
      allParsedOrders: allOrders,
      activeOrderIndex: orderIdx,
    })
  }

  // 質問カードの選択肢を適用
  const handleSelectOption = async (q: ClarificationQuestion, opt: ClarificationOption) => {
    let resolvedValue = opt.value
    let nextCustomers = customers
    let nextDestinations = destinations

    // 新規マスタ（取引先または納入先）登録オプションの場合
    if (opt.isNewMaster && opt.newMasterPayload) {
      const payload = opt.newMasterPayload
      if (payload.type === 'customer') {
        setCreatingMaster(true)
        try {
          const res = await fetch('/api/customers/quick', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: payload.name }),
          })
          const resJson = await res.json().catch(() => ({}))
          if (!res.ok || !resJson.id) {
            throw new Error(resJson.error || '取引先の登録に失敗しました')
          }
          const createdCust = { id: resJson.id as string, name: (resJson.name as string) || payload.name }
          nextCustomers = customers.some((c) => c.id === createdCust.id)
            ? customers
            : [...customers, createdCust]
          setCustomers(nextCustomers)
          resolvedValue = createdCust.id
          onCustomerCreated?.(createdCust)
          toast.success(`取引先「${createdCust.name}」を登録しました`)
        } catch (err) {
          toast.error(err instanceof Error ? err.message : '取引先の登録に失敗しました')
          return
        } finally {
          setCreatingMaster(false)
        }
      } else if (payload.type === 'destination') {
        const targetCustomerId =
          payload.customerId ||
          resolvedMap[`q-cust-${q.orderIndex}`] ||
          selectedCustomerId
        if (!targetCustomerId) {
          toast.error('先に取引先を選択または登録してください')
          return
        }
        setCreatingMaster(true)
        try {
          const res = await fetch('/api/destinations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              customer_id: targetCustomerId,
              full_name: payload.name,
              code: payload.name,
            }),
          })
          const resJson = await res.json().catch(() => ({}))
          const destObj = res.status === 409 ? resJson.existing : resJson.destination
          if (!destObj?.id) {
            throw new Error(resJson.error || '納入先の登録に失敗しました')
          }
          const newDest = {
            id: destObj.id as string,
            customer_id: targetCustomerId,
            full_name: (destObj.full_name as string) || payload.name,
            code: (destObj.code as string | null) ?? payload.name,
          }
          nextDestinations = destinations.some((d) => d.id === newDest.id)
            ? destinations
            : [...destinations, newDest]
          setDestinations(nextDestinations)
          resolvedValue = newDest.id
          onDestinationCreated?.(newDest)
          toast.success(`納入先「${newDest.full_name}」を登録しました`)
        } catch (err) {
          toast.error(err instanceof Error ? err.message : '納入先の登録に失敗しました')
          return
        } finally {
          setCreatingMaster(false)
        }
      }
    }

    const nextResolved = { ...resolvedMap, [q.id]: resolvedValue }
    setResolvedMap(nextResolved)

    if (parsedOrders[activeOrderIdx]) {
      applyOrderToForm(
        parsedOrders[activeOrderIdx]!,
        nextResolved,
        activeOrderIdx,
        parsedOrders,
        originalFile,
        nextCustomers,
        nextDestinations,
      )
    }
  }

  // 質問カードの自由入力を適用
  const handleApplyCustomInput = async (q: ClarificationQuestion) => {
    const val = (customInputs[q.id] || '').trim()
    if (!val) return

    // 取引先や納入先の自由入力の場合は、既存検索→無ければ新規マスタ登録を実行
    if (q.targetField === 'customer_id') {
      const hit = findBestMatchingCustomer(val, customers)
      if (hit) {
        await handleSelectOption(q, {
          id: `custom-cust-${q.id}`,
          label: hit.name,
          value: hit.id,
          field: 'customer_id',
          orderIndex: q.orderIndex,
        })
      } else {
        await handleSelectOption(q, {
          id: `custom-cust-new-${q.id}`,
          label: val,
          value: val,
          field: 'customer_id',
          orderIndex: q.orderIndex,
          isNewMaster: true,
          newMasterPayload: { type: 'customer', name: val },
        })
      }
      return
    }

    if (q.targetField === 'destination_id') {
      const targetCustId = resolvedMap[`q-cust-${q.orderIndex}`] || selectedCustomerId
      const hit = findBestMatchingDestination(val, destinations, targetCustId)
      if (hit) {
        await handleSelectOption(q, {
          id: `custom-dest-${q.id}`,
          label: hit.full_name,
          value: hit.id,
          field: 'destination_id',
          orderIndex: q.orderIndex,
        })
      } else {
        await handleSelectOption(q, {
          id: `custom-dest-new-${q.id}`,
          label: val,
          value: val,
          field: 'destination_id',
          orderIndex: q.orderIndex,
          isNewMaster: true,
          newMasterPayload: { type: 'destination', name: val, customerId: targetCustId },
        })
      }
      return
    }

    const nextResolved = { ...resolvedMap, [q.id]: val }
    setResolvedMap(nextResolved)

    if (parsedOrders[activeOrderIdx]) {
      applyOrderToForm(parsedOrders[activeOrderIdx]!, nextResolved, activeOrderIdx)
    }
  }

  // 解決状態を取り消して再選択できるようにする
  const handleReopenQuestion = (qId: string) => {
    const next = { ...resolvedMap }
    delete next[qId]
    setResolvedMap(next)
    if (parsedOrders[activeOrderIdx]) {
      applyOrderToForm(parsedOrders[activeOrderIdx]!, next, activeOrderIdx)
    }
  }

  const currentQuestions = questions.filter((q) => q.orderIndex === activeOrderIdx)

  return (
    <div className="rounded-2xl border-2 border-dashed border-emerald-300 bg-emerald-50/40 p-4 shadow-xs space-y-3">
      {/* ヘッダー案内 ＆ モード切替 */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-emerald-200/60 pb-2">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-600 text-white shadow-xs">
            <Sparkles className="h-4 w-4" />
          </span>
          <div>
            <h3 className="text-sm font-black text-emerald-950">AIスマート注文読取</h3>
            <p className="text-[11px] text-emerald-800">
              FAX画像・PDF・写真・Excel・テキストから取引先・納入先・日付・数量を自動抽出します
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1 bg-white/80 p-0.5 rounded-lg border border-emerald-200 text-xs font-bold">
          <button
            type="button"
            onClick={() => setMode('file')}
            className={cn(
              'px-2.5 py-1 rounded transition flex items-center gap-1',
              mode === 'file' ? 'bg-emerald-600 text-white shadow-xs' : 'text-emerald-900 hover:bg-emerald-100',
            )}
          >
            <Upload className="h-3 w-3" />
            <span>ファイル</span>
          </button>
          <button
            type="button"
            onClick={() => setMode('text')}
            className={cn(
              'px-2.5 py-1 rounded transition flex items-center gap-1',
              mode === 'text' ? 'bg-emerald-600 text-white shadow-xs' : 'text-emerald-900 hover:bg-emerald-100',
            )}
          >
            <FileText className="h-3 w-3" />
            <span>テキスト貼付</span>
          </button>
        </div>
      </div>

      {/* ① ドロップゾーン / 入力エリア */}
      {mode === 'file' ? (
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setIsDragging(true)
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setIsDragging(false)
            const file = e.dataTransfer.files[0]
            if (file) void processFile(file)
          }}
          onClick={() => fileInputRef.current?.click()}
          className={cn(
            'flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-4 text-center cursor-pointer transition-all',
            isDragging
              ? 'border-emerald-600 bg-emerald-100/70 scale-[0.99]'
              : 'border-emerald-300 bg-white/70 hover:bg-white hover:border-emerald-400',
          )}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,application/pdf,.xlsx,.xls,.csv"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void processFile(file)
            }}
            className="hidden"
          />
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void processFile(file)
            }}
            className="hidden"
          />
          {originalFile ? (
            <div className="flex items-center gap-2 text-xs font-bold text-emerald-900 bg-emerald-100/90 px-3 py-1.5 rounded-lg border border-emerald-300">
              <span>📄 {originalFile.fileName}</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  setOriginalFile(null)
                  setParsedOrders([])
                  setQuestions([])
                }}
                className="text-emerald-700 hover:text-alert p-0.5"
                title="クリア"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="space-y-0.5">
                <div className="flex items-center justify-center gap-1.5 text-xs font-black text-emerald-900">
                  <Upload className="h-4 w-4 text-emerald-600" />
                  <span>ここにFAX・PDF・写真・Excelファイルをドロップ</span>
                </div>
                <p className="text-[11px] text-emerald-700">
                  または下のボタンから選択（JPG, PNG, PDF, Excel .xlsx, CSV 対応）
                </p>
              </div>

              {/* モバイル・現場用クイックボタン */}
              <div className="flex items-center justify-center gap-2 pt-1" onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  onClick={() => cameraInputRef.current?.click()}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-2xs active:scale-95 transition"
                >
                  <Camera className="h-3.5 w-3.5" />
                  <span>📷 カメラ撮影</span>
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-white border border-emerald-300 hover:bg-emerald-50 text-emerald-900 font-bold text-xs shadow-2xs active:scale-95 transition"
                >
                  <Upload className="h-3.5 w-3.5 text-emerald-600" />
                  <span>📁 ファイル・写真選択</span>
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <textarea
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && textInput.trim()) {
                e.preventDefault()
                void runAnalyze({ text: textInput })
              }
            }}
            placeholder="例: 明日 勘兵衛 イオンタウン向け チンゲン菜 5ケース"
            rows={2}
            className="w-full rounded-xl border border-emerald-300 bg-white p-2.5 text-xs text-ink placeholder:text-ink-muted focus:outline-none focus:ring-2 focus:ring-emerald-500 shadow-inner"
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] text-emerald-800">
              Ctrl+Enter または右のボタンで解析して下のフォームへ自動反映します
            </span>
            <button
              type="button"
              disabled={analyzing || !textInput.trim()}
              onClick={() => void runAnalyze({ text: textInput })}
              className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-black text-white hover:bg-emerald-700 disabled:opacity-50 shadow-xs"
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span>テキストを解析</span>
            </button>
          </div>
        </div>
      )}

      {/* 解析中ローディングインジケーター */}
      {analyzing && (
        <div className="flex items-center justify-center gap-2 rounded-xl bg-white/90 p-3.5 text-xs font-black text-emerald-900 shadow-xs border border-emerald-200 animate-pulse">
          <Sparkles className="h-4 w-4 text-emerald-600 animate-spin" />
          <span>注文内容を解析中...（日付・取引先・数量・納入先を照合しています）</span>
        </div>
      )}

      {/* 複数注文が検出された場合のタブ */}
      {parsedOrders.length > 1 && (
        <div className="space-y-1 pt-1">
          <span className="text-[11px] font-bold text-emerald-950">
            📑 複数注文を検出（全 {parsedOrders.length} 件 — タブ切替または下部で一括登録可能）:
          </span>
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
            {parsedOrders.map((o, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => {
                  setActiveOrderIdx(idx)
                  applyOrderToForm(o, resolvedMap, idx, parsedOrders)
                }}
                className={cn(
                  'px-2.5 py-1 rounded-lg text-xs font-bold shrink-0 transition border',
                  activeOrderIdx === idx
                    ? 'bg-emerald-600 text-white border-emerald-700 shadow-xs'
                    : 'bg-white text-emerald-950 border-emerald-200 hover:bg-emerald-100',
                )}
              >
                <span>{o.destination_name || o.customer_name || `注文 ${idx + 1}`}</span>
                {o.delivery_date && <span className="ml-1 text-[10px] opacity-80">({o.delivery_date})</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ② AI質問カード（AIスマート・リゾルバー: 疑問点がある時のみ展開） */}
      {currentQuestions.length > 0 && (
        <div className="space-y-2.5 pt-1">
          <div className="flex items-center justify-between text-xs font-black text-emerald-950">
            <span className="flex items-center gap-1.5">
              <HelpCircle className="h-4 w-4 text-amber-600" />
              <span>確認事項（タップで即時反映・下のフォームで直接変更も可能）:</span>
            </span>
            <span className="text-[11px] text-emerald-800">
              解決済: {currentQuestions.filter((q) => Boolean(resolvedMap[q.id])).length} / {currentQuestions.length}
            </span>
          </div>

          <div className="space-y-2">
            {currentQuestions.map((q) => {
              const isResolved = Boolean(resolvedMap[q.id])
              const resolvedVal = resolvedMap[q.id]

              if (isResolved) {
                const resolvedOptionLabel =
                  q.options.find((o) => o.value === resolvedVal)?.label || resolvedVal
                return (
                  <div
                    key={q.id}
                    className="flex items-center justify-between rounded-xl bg-emerald-100/80 border border-emerald-300 px-3 py-2 text-xs font-bold text-emerald-950"
                  >
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                      <div>
                        <span className="text-[10px] bg-emerald-600 text-white px-1.5 py-0.2 rounded font-black mr-1.5">
                          {q.categoryLabel}
                        </span>
                        <span className="text-emerald-900 font-bold">{q.title}: </span>
                        <span className="text-emerald-950 font-black underline">{resolvedOptionLabel}</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleReopenQuestion(q.id)}
                      className="text-[11px] text-emerald-700 hover:underline flex items-center gap-0.5 shrink-0"
                    >
                      <RotateCcw className="h-3 w-3" />
                      <span>変更</span>
                    </button>
                  </div>
                )
              }

              return (
                <div
                  key={q.id}
                  className="rounded-xl border border-amber-300 bg-amber-50/90 p-3 shadow-xs space-y-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-black rounded bg-amber-600 text-white px-1.5 py-0.2">
                          {q.categoryLabel}
                        </span>
                        <span className="text-xs font-black text-amber-950">{q.title}</span>
                      </div>
                      <p className="text-[11px] font-bold text-amber-900/90">※ {q.reason}</p>
                    </div>
                  </div>

                  {/* 選択肢ボタン群 */}
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    {q.options.map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        disabled={creatingMaster}
                        onClick={() => void handleSelectOption(q, opt)}
                        className={cn(
                          'px-2.5 py-1 rounded-lg text-xs font-bold transition shadow-xs active:scale-95',
                          opt.isNewMaster
                            ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                            : 'bg-white hover:bg-amber-100 text-amber-950 border border-amber-300',
                        )}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>

                  {/* 自由入力 / 新規追加欄 */}
                  {q.allowCustomInput && (
                    <div className="flex items-center gap-1.5 pt-1 border-t border-amber-200/60">
                      <input
                        type="text"
                        value={customInputs[q.id] || ''}
                        onChange={(e) => setCustomInputs({ ...customInputs, [q.id]: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            void handleApplyCustomInput(q)
                          }
                        }}
                        placeholder={q.customInputPlaceholder || '手動で入力して指定'}
                        className="h-8 flex-1 rounded-lg border border-amber-300 bg-white px-2.5 text-xs text-ink placeholder:text-ink-muted focus:outline-none focus:ring-1 focus:ring-amber-500"
                      />
                      <button
                        type="button"
                        disabled={creatingMaster}
                        onClick={() => void handleApplyCustomInput(q)}
                        className="h-8 px-2.5 rounded-lg bg-amber-700 hover:bg-amber-800 text-white text-xs font-bold shadow-xs active:scale-95"
                      >
                        適用
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 解析成功時の自動入力完了バナー */}
      {parsedOrders.length > 0 && (
        <div className="flex items-center justify-between rounded-xl bg-emerald-600 text-white px-3.5 py-2 text-xs font-bold shadow-xs animate-in fade-in duration-200">
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>抽出内容を下部フォームに反映しました。数量や取引先を確認して保存してください。</span>
          </div>
        </div>
      )}
    </div>
  )
}
