'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  Sparkles,
  Send,
  Mic,
  MicOff,
  Check,
  Loader2,
  ArrowRight,
  HelpCircle,
  Settings,
  PlusCircle,
  Carrot,
  Users,
  MapPin,
  RotateCcw,
  ExternalLink,
  History,
  FileCheck2,
  ThumbsUp,
  ThumbsDown,
  Database,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { cn } from '@/lib/cn'
import { findBestMatchingCustomer, findBestMatchingDestination } from '@/lib/orders/natural-parser'
import type { ConciergeAction, ConciergeResponse } from '@/lib/concierge/schema'

interface ConciergeChatProps {
  defaultDate: string
  isAdmin: boolean
  customers: Array<{ id: string; name: string; aliases?: string[] }>
  destinations: Array<{ id: string; customer_id: string; code: string | null; full_name: string }>
  products: Array<{ id: string; name: string; unit: string }>
}

export interface ExecutionDiffItem {
  label: string
  before: string
  after: string
}

export interface ExecutionDetailItem {
  label: string
  value: string
}

export interface ExecutionReceipt {
  id: string
  executedAt: string
  title: string
  locationBreadcrumb: string
  targetHref: string
  targetButtonLabel: string
  details: ExecutionDetailItem[]
  diffs: ExecutionDiffItem[]
  undone?: boolean
  undoPayload?:
    | {
        kind: 'delete_order_item'
        itemId: string
      }
    | {
        kind: 'restore_order_item_qty'
        itemId: string
        previousQty: number
        version: number
      }
    | {
        kind: 'delete_product'
        productId: string
      }
    | {
        kind: 'delete_customer'
        customerId: string
      }
    | {
        kind: 'restore_customer_rule'
        customerId: string
        productId: string
        oldRule: Record<string, unknown> | null
      }
    | {
        kind: 'restore_settings'
        previousEntries: Array<{ key: string; value: string }>
      }
}

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  proposals?: ConciergeAction[]
  executedIndices?: number[]
  /** この返答のために AI が調べたデータ（根拠の見える化） */
  usedTools?: string[]
  /** 直前の質問（評価の記録用） */
  question?: string
  rating?: 'up' | 'down'
}

const TOOL_LABELS: Record<string, string> = {
  get_orders: '注文',
  get_today_work: '今日の作業状況',
  get_sales_summary: '売上',
  get_metrics: '評価指標',
}

/**
 * 使われ方の記録（評価・実行・取り消し）。AI窓口の品質を数字で改善するため（ops_events）。
 * 送信失敗は業務に影響させない。質問文は200字までに切る。
 */
function logConciergeEvent(name: string, meta: Record<string, unknown>) {
  try {
    const body = JSON.stringify({ events: [{ path: '/field/concierge', event: 'action', name, meta }] })
    fetch('/api/ops-events', { method: 'POST', body, keepalive: true, headers: { 'content-type': 'application/json' } }).catch(
      () => {},
    )
  } catch {
    /* 記録できなくても業務は続ける */
  }
}

const RECEIPT_STORAGE_KEY = 'kojima_concierge_receipts_v1'

const SETTING_JA_LABELS: Record<string, string> = {
  STAFF_CAN_OCR: 'スタッフの写真・FAX自動読取（OCR）',
  STAFF_CAN_CREATE_ORDER: 'スタッフの注文追加・数量変更',
  STAFF_CAN_APPROVE: 'スタッフの未確認注文の承認',
  STAFF_CAN_PRINT_DOCS: 'スタッフの帳票・ラベル印刷',
  STAFF_CAN_REPORT_SPEC: 'スタッフの規格変更・報告',
  AUTO_APPROVE_ENABLED: 'AI読取の自動確定（自動承認）',
  NOTIFY_LINEWORKS_ENABLED: 'LINE WORKS への通知',
}

const QUICK_PRESETS = [
  {
    category: '📦 注文の確認・追加',
    icon: PlusCircle,
    items: [
      '明日の注文状況を教えて',
      '明日 和郷園に青梗菜 20箱追加して',
      '明日 勘兵衛に青梗菜 5ケース追加して',
    ],
  },
  {
    category: '🥬 品目・取引先の追加',
    icon: Carrot,
    items: [
      '新しい品目で「春菊」を追加して',
      '新しい品目で「ほうれん草」を追加して',
      'オレンジファームを25入り・青コンで登録して',
    ],
  },
  {
    category: '⚙️ 面倒な設定・ルール変更',
    icon: Settings,
    items: [
      'スタッフの設定を全部オンにして',
      'AIの自動確定をオンにして',
      'オレンジファームの入数を20入りに変えて',
    ],
  },
  {
    category: '🏢 画面の案内・使い方',
    icon: Users,
    items: [
      '積込・配送リストを開きたい',
      '週間表（マトリックス）を開きたい',
      'このアプリの使い方をわかりやすく教えて',
    ],
  },
]

function describeProposalTargetLocation(action: ConciergeAction, defaultDate: string): {
  breadcrumb: string
  previewItems: ExecutionDetailItem[]
} {
  if (action.type === 'add_shipment') {
    const p = action.payload
    const dateStr = p.delivery_date || defaultDate
    return {
      breadcrumb: `📦 収穫・パック作業ボード ➔ ${dateStr} 出荷分`,
      previewItems: [
        { label: '取引先', value: p.customer_name },
        ...(p.destination_name ? [{ label: '納入先', value: p.destination_name }] : []),
        { label: '品目・数量', value: `${p.product_name} / ${p.quantity_raw}（1箱${p.packs_per_case}入）` },
        ...(p.container_type ? [{ label: 'コンテナ', value: p.container_type }] : []),
      ],
    }
  }
  if (action.type === 'create_product') {
    const p = action.payload
    return {
      breadcrumb: '🥬 品目（野菜）マスタ ＆ 週間表・注文追加の品目一覧',
      previewItems: [
        { label: '品目名', value: p.name },
        { label: '区分・単位', value: `${p.category || '葉物'} / 1${p.base_unit || 'パック'}` },
        { label: '標準箱入数', value: `1箱 ${p.container_capacity || 20}入（軽減税率${p.default_tax_rate || 8}%）` },
      ],
    }
  }
  if (action.type === 'create_customer') {
    const p = action.payload
    return {
      breadcrumb: '🏢 取引先マスタ ＆ 納入先・出荷ルール台帳',
      previewItems: [
        { label: '取引先名', value: p.name },
        ...(p.destination_name ? [{ label: '納入先', value: p.destination_name }] : []),
        { label: '標準ルール', value: `1箱${p.packs_per_case || 20}入 / 容器: ${p.container_type || '青コン'}` },
      ],
    }
  }
  if (action.type === 'update_customer_rule') {
    const p = action.payload
    return {
      breadcrumb: `📐 取引先別ルール台帳（${p.customer_name}）`,
      previewItems: [
        { label: '対象取引先', value: p.customer_name },
        ...(p.packs_per_case != null ? [{ label: '箱入数', value: `1箱 ${p.packs_per_case}入` }] : []),
        ...(p.container_type != null ? [{ label: 'コンテナ', value: p.container_type }] : []),
        ...(p.spec != null ? [{ label: '規格表記', value: p.spec }] : []),
        ...(p.has_seal != null ? [{ label: 'シール', value: p.has_seal ? 'あり' : 'なし' }] : []),
        ...(p.has_card != null ? [{ label: '生産者カード', value: p.has_card ? '入れる' : 'なし' }] : []),
      ],
    }
  }
  if (action.type === 'update_departure_time') {
    const p = action.payload
    return {
      breadcrumb: `🚚 積込・配送リスト（${p.customer_name}）`,
      previewItems: [
        { label: '対象取引先', value: p.customer_name },
        { label: '新しい出発時刻', value: p.departure_time },
      ],
    }
  }
  if (action.type === 'toggle_setting') {
    return {
      breadcrumb: '⚙️ システム設定画面 ➔ 現場スタッフ権限・自動化スイッチ',
      previewItems: action.payload.entries.map((e) => ({
        label: SETTING_JA_LABELS[e.key] || e.label || e.key,
        value: e.value === 'on' ? 'ON（有効）' : 'OFF（無効）',
      })),
    }
  }
  return {
    breadcrumb: action.payload.href,
    previewItems: [],
  }
}

export function ConciergeChat({
  defaultDate,
  customers,
  destinations,
  products,
}: ConciergeChatProps) {
  const router = useRouter()
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content:
        'こんにちは！小島農園のAI相談窓口です🌱 注文の追加・品目の登録・数字の確認などを、ふつうの言葉で頼んでください。実行の前に必ず確認ボタンが出て、あとから元に戻すこともできます。',
      proposals: [],
    },
  ])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [executingKey, setExecutingKey] = useState<string | null>(null)
  const [undoingReceiptId, setUndoingReceiptId] = useState<string | null>(null)
  const [listening, setListening] = useState(false)
  const [receiptsByKey, setReceiptsByKey] = useState<Record<string, ExecutionReceipt>>({})
  const [historyReceipts, setHistoryReceipts] = useState<ExecutionReceipt[]>([])
  const [historyOpen, setHistoryOpen] = useState(false)
  const [suggestions, setSuggestions] = useState<string[]>([
    '明日の注文状況を教えて',
    'スタッフの設定を全部オンにして',
    '新しい品目で「春菊」を追加して',
  ])

  const bottomRef = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null)

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(RECEIPT_STORAGE_KEY)
      if (saved) {
        const parsed = JSON.parse(saved) as ExecutionReceipt[]
        if (Array.isArray(parsed)) setHistoryReceipts(parsed)
      }
    } catch {}
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, sending])

  // 開いた瞬間に「今日の要点」（承認待ち・読み取り失敗・残り作業）を実データから出す
  useEffect(() => {
    let cancelled = false
    fetch('/api/concierge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'briefing', referenceDate: defaultDate }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((json: Partial<ConciergeResponse> | null) => {
        if (cancelled || !json?.reply) return
        setMessages((prev) => [
          ...prev,
          { id: 'briefing', role: 'assistant', content: json.reply!, proposals: json.proposals ?? [], executedIndices: [] },
        ])
        if (Array.isArray(json.followUpSuggestions) && json.followUpSuggestions.length > 0) {
          setSuggestions(json.followUpSuggestions)
        }
      })
      .catch(() => {
        /* 要点が出せなくても相談はできる */
      })
    return () => {
      cancelled = true
    }
  }, [defaultDate])

  function rateMessage(msgId: string, rating: 'up' | 'down') {
    setMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, rating } : m)))
    const msg = messages.find((m) => m.id === msgId)
    logConciergeEvent('concierge_feedback', {
      rating,
      question: msg?.question?.slice(0, 200) ?? null,
      reply: msg?.content.slice(0, 200) ?? null,
      used_tools: msg?.usedTools ?? [],
      proposal_types: (msg?.proposals ?? []).map((p) => p.type),
    })
    if (rating === 'down') toast('ありがとうございます。改善に使わせていただきます', { icon: '📝' })
  }

  function saveNewReceipt(key: string, receipt: ExecutionReceipt) {
    logConciergeEvent('concierge_execute', { title: receipt.title })
    setReceiptsByKey((prev) => ({ ...prev, [key]: receipt }))
    setHistoryReceipts((prev) => {
      const next = [receipt, ...prev.filter((r) => r.id !== receipt.id)].slice(0, 25)
      try {
        window.localStorage.setItem(RECEIPT_STORAGE_KEY, JSON.stringify(next))
      } catch {}
      return next
    })
  }

  function markReceiptUndone(receiptId: string) {
    setReceiptsByKey((prev) => {
      const next = { ...prev }
      for (const k of Object.keys(next)) {
        if (next[k]?.id === receiptId) {
          next[k] = { ...next[k]!, undone: true }
        }
      }
      return next
    })
    setHistoryReceipts((prev) => {
      const next = prev.map((r) => (r.id === receiptId ? { ...r, undone: true } : r))
      try {
        window.localStorage.setItem(RECEIPT_STORAGE_KEY, JSON.stringify(next))
      } catch {}
      return next
    })
  }

  const toggleVoiceInput = () => {
    if (typeof window === 'undefined') return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) {
      toast.error('お使いのブラウザは音声入力に対応していません。キーボードのマイクボタンをお試しください。')
      return
    }
    if (listening && recognitionRef.current) {
      recognitionRef.current.stop()
      setListening(false)
      return
    }
    try {
      const rec = new SpeechRecognition()
      rec.lang = 'ja-JP'
      rec.interimResults = false
      rec.maxAlternatives = 1
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rec.onresult = (event: any) => {
        const transcript = event.results?.[0]?.[0]?.transcript
        if (transcript) {
          setInput((prev) => (prev ? `${prev} ${transcript}` : transcript))
          toast.success('音声を読み取りました！「相談する」を押してください')
        }
      }
      rec.onerror = () => {
        setListening(false)
      }
      rec.onend = () => {
        setListening(false)
      }
      recognitionRef.current = rec
      rec.start()
      setListening(true)
      toast('🎤 お話しください（例：「明日 和郷園に20箱追加して」）', { duration: 3000 })
    } catch {
      setListening(false)
    }
  }

  async function sendMessage(textToSend?: string) {
    const text = (textToSend ?? input).trim()
    if (!text || sending) return

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
    }
    setMessages((prev) => [...prev, userMsg])
    if (!textToSend) setInput('')
    setSending(true)

    try {
      const history = messages.slice(-6).map((m) => ({
        role: m.role,
        content: m.content,
      }))
      const res = await fetch('/api/concierge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          history,
          referenceDate: defaultDate,
        }),
      })
      const json = (await res.json().catch(() => ({}))) as Partial<ConciergeResponse> & {
        error?: string
        usedTools?: string[]
      }
      if (!res.ok) {
        throw new Error(json.error ?? `通信エラー (${res.status})`)
      }

      const assistantMsg: ChatMessage = {
        id: `ai-${Date.now()}`,
        role: 'assistant',
        content: json.reply || '承知しました！以下の内容でよろしければ実行ボタンを押してください。',
        proposals: Array.isArray(json.proposals) ? json.proposals : [],
        executedIndices: [],
        usedTools: Array.isArray(json.usedTools) ? [...new Set(json.usedTools)] : [],
        question: text,
      }
      setMessages((prev) => [...prev, assistantMsg])
      if (Array.isArray(json.followUpSuggestions) && json.followUpSuggestions.length > 0) {
        setSuggestions(json.followUpSuggestions)
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '相談の送信に失敗しました')
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: 'assistant',
          content: 'すみません、一時的に通信が混み合っています。もう一度ボタンを押してみてください。',
        },
      ])
    } finally {
      setSending(false)
    }
  }

  async function executeProposal(msgId: string, propIdx: number, action: ConciergeAction) {
    if (action.type === 'navigate') {
      router.push(action.payload.href)
      return
    }

    const key = `${msgId}-${propIdx}`
    setExecutingKey(key)
    const nowTimeStr = new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })

    try {
      if (action.type === 'add_shipment') {
        const p = action.payload
        const matchedCust =
          (p.customer_id ? customers.find((c) => c.id === p.customer_id) : null) ??
          findBestMatchingCustomer(p.customer_name, customers)
        if (!matchedCust) {
          throw new Error(
            `取引先「${p.customer_name}」がまだ未登録です。「${p.customer_name}を取引先に登録して」と伝えて先に作成してください。`,
          )
        }
        const matchedDest =
          (p.destination_id ? destinations.find((d) => d.id === p.destination_id) : null) ??
          (p.destination_name ? findBestMatchingDestination(p.destination_name, destinations, matchedCust.id) : null)
        const matchedProd =
          (p.product_id ? products.find((pr) => pr.id === p.product_id) : null) ??
          products.find((pr) => pr.name.includes(p.product_name) || p.product_name.includes(pr.name)) ??
          products[0]
        if (!matchedProd) {
          throw new Error('品目が見つかりません')
        }

        const targetDate = p.delivery_date || defaultDate
        const res = await fetch('/api/shipments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customer_id: matchedCust.id,
            destination_id: matchedDest?.id ?? null,
            product_id: matchedProd.id,
            delivery_date: targetDate,
            quantity_raw: p.quantity_raw,
            packs_per_case: p.packs_per_case,
            container_type: p.container_type ?? undefined,
            spec: p.spec ?? undefined,
            has_card: p.has_card ?? undefined,
            has_seal: p.has_seal ?? undefined,
            seal_text: p.seal_text ?? undefined,
            bag_type: p.bag_type ?? undefined,
            mode: p.mode || 'create',
            note: p.note ?? undefined,
          }),
        })
        const j = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(j.error ?? '注文の登録に失敗しました')

        const savedItem = (j.item ?? {}) as Record<string, unknown>
        const itemId = String(savedItem.id ?? '')
        const finalPacks = Number(savedItem.quantity) || 0
        const prevPacks = Number(j.previousQty) || 0
        const ppc = Number(j.effectivePacksPerCase) || p.packs_per_case || 20
        const finalBoxes = Math.ceil(finalPacks / ppc)
        const prevBoxes = Math.ceil(prevPacks / ppc)
        const wasNew = Boolean(j.wasNewItem)

        const receipt: ExecutionReceipt = {
          id: `rec-${Date.now()}`,
          executedAt: nowTimeStr,
          title: `${matchedCust.name}${matchedDest ? ` ▶ ${matchedDest.code || matchedDest.full_name}` : ''} の注文を登録`,
          locationBreadcrumb: `📦 収穫・パック作業ボード ➔ ${targetDate} 出荷分`,
          targetHref: `/field/shipments?date=${targetDate}${itemId ? `&highlightItem=${itemId}` : `&highlightCustomer=${matchedCust.id}`}`,
          targetButtonLabel: `👉 ${targetDate}の収穫・パックボードで実物を見る（点滅表示）`,
          details: [
            { label: '取引先', value: matchedCust.name },
            ...(matchedDest ? [{ label: '納入先', value: matchedDest.code || matchedDest.full_name }] : []),
            { label: '品目・規格', value: `${matchedProd.name} / ${String(savedItem.spec || `${ppc}入`)}` },
            { label: '確定数量', value: `${finalBoxes}箱（${finalPacks}パック / 1箱${ppc}入）` },
            { label: 'コンテナ', value: String(savedItem.container_type || p.container_type || '青コン') },
          ],
          diffs: [
            {
              label: '注文数量',
              before: wasNew ? '0箱（未登録）' : `${prevBoxes}箱（${prevPacks}P）`,
              after: `${finalBoxes}箱（${finalPacks}P）`,
            },
          ],
          undoPayload: itemId
            ? wasNew
              ? { kind: 'delete_order_item', itemId }
              : {
                  kind: 'restore_order_item_qty',
                  itemId,
                  previousQty: prevPacks,
                  version: Number(savedItem.version) || 1,
                }
            : undefined,
        }
        saveNewReceipt(key, receipt)
        toast.success(`✨ ${action.title} を反映しました！`)
      } else if (action.type === 'create_product') {
        const p = action.payload
        const res = await fetch('/api/products', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: p.name,
            category: p.category || '葉物',
            base_unit: p.base_unit || 'パック',
            unit: p.base_unit || 'パック',
            container_capacity: p.container_capacity || 20,
            default_tax_rate: p.default_tax_rate || 8,
          }),
        })
        const j = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(j.error ?? '品目の追加に失敗しました')

        const createdProd = (j.product ?? {}) as { id?: string; name?: string }
        const receipt: ExecutionReceipt = {
          id: `rec-${Date.now()}`,
          executedAt: nowTimeStr,
          title: `新しい品目「${p.name}」を追加`,
          locationBreadcrumb: '🥬 品目（野菜）マスタ ＆ 週間表・注文追加の品目一覧',
          targetHref: '/admin/products',
          targetButtonLabel: '👉 品目マスタ一覧を開いて確認する',
          details: [
            { label: '品目名', value: p.name },
            { label: 'カテゴリ・単位', value: `${p.category || '葉物'} / 1${p.base_unit || 'パック'}` },
            { label: '標準入数・税率', value: `1箱 ${p.container_capacity || 20}入 / 軽減税率 ${p.default_tax_rate || 8}%` },
          ],
          diffs: [
            {
              label: '品目マスタ',
              before: '未登録',
              after: `「${p.name}」を追加（注文・週間表で選択可能に）`,
            },
          ],
          undoPayload: createdProd.id ? { kind: 'delete_product', productId: createdProd.id } : undefined,
        }
        saveNewReceipt(key, receipt)
        toast.success(`🥬 新しい品目「${p.name}」を追加しました！`)
      } else if (action.type === 'create_customer') {
        const p = action.payload
        const res = await fetch('/api/customers/quick', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: p.name,
            destination_name: p.destination_name || undefined,
            packs_per_case: p.packs_per_case || 20,
            container_type: p.container_type || '青コン',
            aliases: p.aliases?.length ? p.aliases : [p.name],
            product_id: p.product_id || products[0]?.id,
          }),
        })
        const j = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(j.error ?? '取引先の登録に失敗しました')

        const custId = String(j.customer?.id ?? '')
        const existed = Boolean(j.existed)
        const receipt: ExecutionReceipt = {
          id: `rec-${Date.now()}`,
          executedAt: nowTimeStr,
          title: `取引先「${p.name}」を一括登録`,
          locationBreadcrumb: `🏢 取引先マスタ ➔ ${p.name}`,
          targetHref: custId ? `/admin/customers/${custId}` : '/admin/customers',
          targetButtonLabel: `👉 取引先「${p.name}」の詳細画面を開いて確認する`,
          details: [
            { label: '取引先名', value: p.name },
            ...(p.destination_name ? [{ label: '同時登録した納入先', value: p.destination_name }] : []),
            { label: '設定した箱入数', value: `1箱 ${p.packs_per_case || 20}入` },
            { label: '設定したコンテナ', value: p.container_type || '青コン' },
          ],
          diffs: [
            {
              label: '取引先マスタ',
              before: existed ? '既存取引先' : '未登録',
              after: `${p.name}（${p.packs_per_case || 20}入 / ${p.container_type || '青コン'}）`,
            },
          ],
          undoPayload: !existed && custId ? { kind: 'delete_customer', customerId: custId } : undefined,
        }
        saveNewReceipt(key, receipt)
        toast.success(`🏢 取引先「${p.name}」を一括登録しました！`)
      } else if (action.type === 'update_customer_rule') {
        const p = action.payload
        const matchedCust =
          (p.customer_id ? customers.find((c) => c.id === p.customer_id) : null) ??
          findBestMatchingCustomer(p.customer_name, customers)
        if (!matchedCust) throw new Error(`取引先「${p.customer_name}」が見つかりません`)
        const targetProd =
          (p.product_id ? products.find((pr) => pr.id === p.product_id) : null) ??
          (p.product_name ? products.find((pr) => pr.name.includes(p.product_name!)) : null) ??
          products[0]
        if (!targetProd) throw new Error('品目が見つかりません')

        const res = await fetch('/api/customer-product-rules', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customer_id: matchedCust.id,
            product_id: targetProd.id,
            ...(p.packs_per_case != null ? { packs_per_case: p.packs_per_case } : {}),
            ...(p.container_type != null ? { default_container_type: p.container_type } : {}),
            ...(p.spec != null ? { label_spec: p.spec } : {}),
            ...(p.has_card != null ? { has_card: p.has_card } : {}),
            ...(p.has_seal != null ? { has_seal: p.has_seal } : {}),
            ...(p.seal_text != null ? { seal_text: p.seal_text } : {}),
            ...(p.bag_type != null ? { bag_type: p.bag_type } : {}),
          }),
        })
        const j = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(j.message ?? j.error ?? 'ルールの変更に失敗しました')

        const oldRule = (j.oldRule ?? null) as Record<string, unknown> | null
        const diffs: ExecutionDiffItem[] = []
        if (p.packs_per_case != null) {
          diffs.push({
            label: '1箱の入数',
            before: oldRule?.packs_per_case ? `${oldRule.packs_per_case}入` : '標準（20入）',
            after: `${p.packs_per_case}入`,
          })
        }
        if (p.container_type != null) {
          diffs.push({
            label: '既定コンテナ',
            before: String(oldRule?.default_container_type || oldRule?.container_type || '未設定'),
            after: p.container_type,
          })
        }
        if (p.spec != null) {
          diffs.push({
            label: '規格表記',
            before: String(oldRule?.label_spec || oldRule?.spec || '未設定'),
            after: p.spec,
          })
        }
        if (p.has_seal != null) {
          diffs.push({
            label: 'シール有無',
            before: oldRule?.has_seal ? 'あり' : 'なし',
            after: p.has_seal ? 'あり' : 'なし',
          })
        }
        if (p.has_card != null) {
          diffs.push({
            label: '生産者カード',
            before: oldRule?.has_card ? '入れる' : 'なし',
            after: p.has_card ? '入れる' : 'なし',
          })
        }

        const receipt: ExecutionReceipt = {
          id: `rec-${Date.now()}`,
          executedAt: nowTimeStr,
          title: `${matchedCust.name} の出荷・箱詰めルールを更新`,
          locationBreadcrumb: `📐 取引先マスタ ➔ ${matchedCust.name} ➔ 品目別ルール（${targetProd.name}）`,
          targetHref: `/admin/customers/${matchedCust.id}`,
          targetButtonLabel: `👉 ${matchedCust.name} のルール設定画面を開いて確認する`,
          details: [
            { label: '対象取引先', value: matchedCust.name },
            { label: '対象品目', value: targetProd.name },
          ],
          diffs:
            diffs.length > 0
              ? diffs
              : [{ label: 'ルール設定', before: '変更前', after: '最新ルールに更新' }],
          undoPayload: oldRule
            ? {
                kind: 'restore_customer_rule',
                customerId: matchedCust.id,
                productId: targetProd.id,
                oldRule,
              }
            : undefined,
        }
        saveNewReceipt(key, receipt)
        toast.success(`✨ ${matchedCust.name} のルールを更新しました！`)
      } else if (action.type === 'update_departure_time') {
        const p = action.payload
        const matchedCust =
          (p.customer_id ? customers.find((c) => c.id === p.customer_id) : null) ??
          findBestMatchingCustomer(p.customer_name, customers)
        if (!matchedCust) throw new Error(`取引先「${p.customer_name}」が見つかりません`)
        const matchedDest =
          (p.destination_id ? destinations.find((d) => d.id === p.destination_id) : null) ??
          (p.destination_name ? findBestMatchingDestination(p.destination_name, destinations, matchedCust.id) : null)

        const targetDate = p.delivery_date || defaultDate
        const res = await fetch('/api/deliveries/departure-time', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            deliveryDate: targetDate,
            customerId: matchedCust.id,
            destinationId: matchedDest?.id ?? null,
            destinationName: p.destination_name ?? matchedDest?.full_name ?? null,
            departureTime: p.departure_time,
            shippingRouteName: p.shipping_route_name ?? null,
            scope: p.scope || 'master',
          }),
        })
        const j = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(j.error ?? '出発時間の更新に失敗しました')

        const receipt: ExecutionReceipt = {
          id: `rec-${Date.now()}`,
          executedAt: nowTimeStr,
          title: `${matchedCust.name} の出発時間を「${p.departure_time}」に設定`,
          locationBreadcrumb: `🚚 積込・配送リスト ➔ ${targetDate} 出荷便`,
          targetHref: `/field/deliveries?date=${targetDate}`,
          targetButtonLabel: `👉 ${targetDate}の積込・配送リストを開いて確認する`,
          details: [
            { label: '対象取引先', value: matchedCust.name },
            ...(matchedDest ? [{ label: '対象納入先', value: matchedDest.code || matchedDest.full_name }] : []),
            { label: '出発時刻', value: p.departure_time },
          ],
          diffs: [
            {
              label: '便の出発時刻',
              before: '変更前',
              after: `${p.departure_time} 出発`,
            },
          ],
        }
        saveNewReceipt(key, receipt)
        toast.success(`⏰ 出発時間を「${p.departure_time}」に設定しました！`)
      } else if (action.type === 'toggle_setting') {
        const res = await fetch('/api/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            entries: action.payload.entries.map((e) => ({ key: e.key, value: e.value })),
          }),
        })
        const j = await res.json().catch(() => ({}))
        if (!res.ok) {
          throw new Error(
            res.status === 403
              ? 'システム設定の変更は管理者（経営者）アカウントでログイン中のみ実行できます'
              : j.error ?? '設定の更新に失敗しました',
          )
        }

        const prevEntries = (Array.isArray(j.previousEntries) ? j.previousEntries : []) as Array<{
          key: string
          value: string
        }>
        const prevMap = new Map(prevEntries.map((e) => [e.key, e.value]))

        const diffs: ExecutionDiffItem[] = action.payload.entries.map((e) => {
          const oldVal = prevMap.get(e.key)
          return {
            label: SETTING_JA_LABELS[e.key] || e.label || e.key,
            before: oldVal === 'on' ? 'ON（有効）' : oldVal === 'off' ? 'OFF（無効）' : '変更前',
            after: e.value === 'on' ? 'ON（有効）' : 'OFF（無効）',
          }
        })

        const receipt: ExecutionReceipt = {
          id: `rec-${Date.now()}`,
          executedAt: nowTimeStr,
          title: action.title,
          locationBreadcrumb: '⚙️ システム設定画面 ➔ 現場スタッフ権限・自動化スイッチ',
          targetHref: '/admin/settings',
          targetButtonLabel: '👉 設定画面を開いてスイッチを確認する',
          details: action.payload.entries.map((e) => ({
            label: SETTING_JA_LABELS[e.key] || e.label || e.key,
            value: e.value === 'on' ? 'ON（有効）' : 'OFF（無効）',
          })),
          diffs,
          undoPayload:
            prevEntries.length > 0
              ? { kind: 'restore_settings', previousEntries: prevEntries }
              : undefined,
        }
        saveNewReceipt(key, receipt)
        toast.success(`⚙️ 設定を更新しました！`)
      }

      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId
            ? { ...m, executedIndices: [...(m.executedIndices ?? []), propIdx] }
            : m,
        ),
      )
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '実行に失敗しました')
    } finally {
      setExecutingKey(null)
    }
  }

  async function handleUndoReceipt(receipt: ExecutionReceipt) {
    if (!receipt.undoPayload || receipt.undone || undoingReceiptId) return
    setUndoingReceiptId(receipt.id)
    try {
      const up = receipt.undoPayload
      if (up.kind === 'delete_order_item') {
        const res = await fetch(`/api/order-items/${up.itemId}`, { method: 'DELETE' })
        if (!res.ok) throw new Error('注文の取り消しに失敗しました')
      } else if (up.kind === 'restore_order_item_qty') {
        const res = await fetch(`/api/order-items/${up.itemId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ quantity: up.previousQty, version: up.version }),
        })
        if (!res.ok) throw new Error('注文数量の復元に失敗しました')
      } else if (up.kind === 'delete_product') {
        const res = await fetch(`/api/products/${up.productId}`, { method: 'DELETE' })
        if (!res.ok) throw new Error('品目の取り消しに失敗しました')
      } else if (up.kind === 'delete_customer') {
        const res = await fetch(`/api/customers/${up.customerId}`, { method: 'DELETE' })
        if (!res.ok) throw new Error('取引先の取り消しに失敗しました')
      } else if (up.kind === 'restore_customer_rule') {
        const r = up.oldRule ?? {}
        const res = await fetch('/api/customer-product-rules', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customer_id: up.customerId,
            product_id: up.productId,
            packs_per_case: Number(r.packs_per_case) || 20,
            default_container_type: r.default_container_type ?? r.container_type ?? null,
            label_spec: r.label_spec ?? r.spec ?? null,
            has_card: Boolean(r.has_card),
            has_seal: r.has_seal ?? null,
            seal_text: r.seal_text ?? null,
            bag_type: r.bag_type ?? null,
          }),
        })
        if (!res.ok) throw new Error('ルールの復元に失敗しました')
      } else if (up.kind === 'restore_settings') {
        const res = await fetch('/api/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ entries: up.previousEntries }),
        })
        if (!res.ok) throw new Error('設定の復元に失敗しました')
      }

      markReceiptUndone(receipt.id)
      logConciergeEvent('concierge_undo', { title: receipt.title })
      toast.success('↩️ 取り消して元の状態に戻しました！')
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '取り消しに失敗しました')
    } finally {
      setUndoingReceiptId(null)
    }
  }

  function renderReceiptCard(receipt: ExecutionReceipt) {
    const isUndoing = undoingReceiptId === receipt.id
    return (
      <div
        key={receipt.id}
        className={cn(
          'rounded-2xl border-2 p-3.5 sm:p-4 space-y-3 shadow-sm transition',
          receipt.undone
            ? 'border-line-strong bg-bg-soft/80 text-ink-soft'
            : 'border-harvest-600 bg-harvest-50/70',
        )}
      >
        {/* レシートヘッダー */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-harvest-400/80 pb-2">
          <div className="flex items-center gap-1.5">
            <FileCheck2
              className={cn('h-5 w-5 shrink-0', receipt.undone ? 'text-ink-faint' : 'text-harvest-700')}
            />
            <span
              className={cn(
                'text-xs sm:text-sm font-black',
                receipt.undone ? 'text-ink-soft line-through' : 'text-forest-900',
              )}
            >
              {receipt.undone ? '↩️ 取り消し済み（元の状態に戻しました）' : '✅ おまかせ実行証明レシート（完了）'}
            </span>
          </div>
          <span className="whitespace-nowrap rounded-md bg-bg-card px-2 py-0.5 text-xs font-black text-ink-soft border border-line">
            🕒 {receipt.executedAt} 実行
          </span>
        </div>

        {/* 📍 どこに登録・反映されたか（パンくず） */}
        <div className="rounded-xl bg-bg-card border border-harvest-400 px-3 py-2 space-y-1">
          <div className="flex items-center gap-1 text-xs font-black text-forest-800">
            <MapPin className="h-3.5 w-3.5 shrink-0 text-harvest-600" />
            <span>どこに登録・反映されたか（保存場所）:</span>
          </div>
          <div className="text-xs sm:text-sm font-black text-ink pl-1">{receipt.locationBreadcrumb}</div>
        </div>

        {/* 🔀 Before → After（どう変わったか） */}
        {receipt.diffs.length > 0 && (
          <div className="rounded-xl bg-bg-card border border-harvest-400 px-3 py-2 space-y-1.5">
            <div className="text-xs font-black text-forest-800">🔀 変更内容（Before ➔ After）:</div>
            <div className="space-y-1">
              {receipt.diffs.map((d, idx) => (
                <div key={idx} className="flex flex-wrap items-center gap-1.5 text-xs sm:text-sm font-black">
                  <span className="text-ink-soft">{d.label}:</span>
                  <span className="rounded bg-bg-soft px-2 py-0.5 text-ink-soft line-through font-bold">
                    {d.before}
                  </span>
                  <ArrowRight className="h-3.5 w-3.5 text-harvest-700 shrink-0" />
                  <span className="rounded bg-harvest-100 border border-harvest-400 px-2 py-0.5 text-forest-900 font-black">
                    {d.after}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 📋 登録された明細一覧 */}
        {receipt.details.length > 0 && (
          <div className="rounded-xl bg-bg-card/90 border border-line px-3 py-2 grid gap-1 sm:grid-cols-2">
            {receipt.details.map((dt, idx) => (
              <div key={idx} className="text-xs font-bold flex items-baseline gap-1.5">
                <span className="text-ink-soft shrink-0">・{dt.label}:</span>
                <span className="font-black text-ink">{dt.value}</span>
              </div>
            ))}
          </div>
        )}

        {/* アクションボタン（実物を見に行く ＆ 1タップで元に戻す） */}
        {!receipt.undone && (
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-1">
            <button
              type="button"
              onClick={() => router.push(receipt.targetHref)}
              className="flex-1 rounded-xl bg-forest-700 hover:bg-forest-800 text-white py-2.5 px-3.5 text-xs sm:text-sm font-black flex items-center justify-center gap-1.5 shadow-xs transition active:scale-[0.99]"
            >
              <span>{receipt.targetButtonLabel}</span>
              <ExternalLink className="h-4 w-4 shrink-0" />
            </button>

            {receipt.undoPayload && (
              <button
                type="button"
                disabled={isUndoing}
                onClick={() => void handleUndoReceipt(receipt)}
                className="rounded-xl border-2 border-alert bg-bg-card hover:bg-alert-bg text-alert py-2.5 px-3.5 text-xs sm:text-sm font-black flex items-center justify-center gap-1.5 transition active:scale-95 shrink-0"
              >
                {isUndoing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>戻しています...</span>
                  </>
                ) : (
                  <>
                    <RotateCcw className="h-4 w-4 shrink-0" />
                    <span>↩️ 取り消す（元に戻す）</span>
                  </>
                )}
              </button>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* ⓪ いつでも見返せる「おまかせ実行履歴（タイムライン台帳）」 */}
      {historyReceipts.length > 0 && (
        <div className="rounded-2xl border-2 border-forest-400 bg-bg-card shadow-xs overflow-hidden">
          <button
            type="button"
            onClick={() => setHistoryOpen((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-3 text-left bg-forest-50/70 hover:bg-forest-100/70 transition"
          >
            <span className="flex items-center gap-2 text-xs sm:text-sm font-black text-forest-900">
              <History className="h-4 w-4 text-forest-700 shrink-0" />
              <span>🕒 最近のおまかせ実行履歴（どこに何が登録されたか一覧）</span>
              <span className="whitespace-nowrap rounded-full bg-forest-700 px-2 py-0.5 text-xs font-black text-white">
                {historyReceipts.length}件
              </span>
            </span>
            <span className="text-xs font-black text-forest-800">
              {historyOpen ? '▲ 閉じる' : '▼ 履歴を見る'}
            </span>
          </button>
          {historyOpen && (
            <div className="p-3.5 space-y-3 max-h-[420px] overflow-y-auto border-t border-forest-200 bg-sand-50/50">
              {historyReceipts.map((rec) => renderReceiptCard(rec))}
            </div>
          )}
        </div>
      )}

      {/* ① 文字入力が苦手な方のための「ワンタップ定型お願いボタン集」 */}
      <details className="group rounded-2xl border-2 border-harvest-400 bg-bg-card shadow-xs" open>
        <summary className="flex cursor-pointer items-center justify-between px-4 py-3 text-sm font-black text-forest-900 select-none">
          <span className="flex items-center gap-2">
            <HelpCircle className="h-4 w-4 text-harvest-600 shrink-0" />
            <span>👆 文字を打たずに頼める「よくあるお願いボタン」（タップするだけ）</span>
          </span>
          <span className="text-xs font-bold text-harvest-700 group-open:rotate-180 transition-transform">▼</span>
        </summary>
        <div className="border-t border-harvest-100 p-3.5 grid gap-3 sm:grid-cols-2 bg-harvest-50/40">
          {QUICK_PRESETS.map((group) => (
            <div key={group.category} className="rounded-xl bg-bg-card p-3 border border-harvest-400/80 space-y-2">
              <div className="text-xs font-black text-forest-900">{group.category}</div>
              <div className="flex flex-wrap gap-1.5">
                {group.items.map((item) => (
                  <button
                    key={item}
                    type="button"
                    disabled={sending}
                    onClick={() => void sendMessage(item)}
                    className="rounded-xl border border-harvest-400 bg-harvest-50/80 hover:bg-harvest-100 px-3 py-1.5 text-xs font-black text-forest-900 text-left transition active:scale-95 shadow-2xs"
                  >
                    👉 {item}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </details>

      {/* ② チャットタイムライン */}
      <div className="rounded-2xl border border-line bg-bg-card p-3.5 sm:p-4 space-y-4 min-h-[320px] max-h-[620px] overflow-y-auto shadow-xs">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={cn('flex flex-col gap-2.5', msg.role === 'user' ? 'items-end' : 'items-start')}
          >
            <div
              className={cn(
                'max-w-[94%] sm:max-w-[84%] rounded-2xl px-4 py-3 text-sm sm:text-base font-bold leading-relaxed whitespace-pre-wrap shadow-2xs',
                msg.role === 'user'
                  ? 'bg-forest-700 text-white rounded-br-xs'
                  : 'bg-sand-100/90 border border-line text-ink rounded-bl-xs',
              )}
            >
              {msg.role === 'assistant' && (
                <div className="flex items-center gap-1.5 text-xs font-black text-forest-800 mb-1">
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>AIコンシェルジュ</span>
                </div>
              )}
              {msg.content}
              {msg.role === 'assistant' && msg.usedTools && msg.usedTools.length > 0 && (
                <p className="mt-2 flex flex-wrap items-center gap-1 text-xs font-bold text-ink-soft">
                  <Database className="h-3.5 w-3.5" aria-hidden />
                  調べたデータ: {msg.usedTools.map((t) => TOOL_LABELS[t] ?? t).join('・')}
                </p>
              )}
            </div>
            {msg.role === 'assistant' && msg.question && (
              <div className="flex items-center gap-1 pl-1" aria-label="この回答の評価">
                {(['up', 'down'] as const).map((r) => {
                  const Icon = r === 'up' ? ThumbsUp : ThumbsDown
                  const active = msg.rating === r
                  return (
                    <button
                      key={r}
                      type="button"
                      onClick={() => rateMessage(msg.id, r)}
                      disabled={Boolean(msg.rating)}
                      aria-pressed={active}
                      aria-label={r === 'up' ? '役に立った' : '役に立たなかった'}
                      className={cn(
                        'inline-flex h-9 w-9 items-center justify-center rounded-lg border text-ink-soft transition-colors disabled:cursor-default',
                        active ? 'border-forest-600 bg-forest-50 text-forest-800' : 'border-line bg-bg-card hover:bg-sand-100',
                        msg.rating && !active && 'opacity-40',
                      )}
                    >
                      <Icon className="h-4 w-4" aria-hidden />
                    </button>
                  )
                })}
              </div>
            )}

            {/* アクション提案カード（「どこに・どう登録されるか」事前プレビュー ＋ 実行後の証明レシート） */}
            {msg.proposals && msg.proposals.length > 0 && (
              <div className="w-full max-w-[94%] sm:max-w-[84%] space-y-2.5">
                {msg.proposals.map((prop, pIdx) => {
                  const key = `${msg.id}-${pIdx}`
                  const isExecuted = msg.executedIndices?.includes(pIdx)
                  const isBusy = executingKey === key
                  const receipt = receiptsByKey[key]

                  if (prop.type === 'navigate') {
                    return (
                      <button
                        key={pIdx}
                        type="button"
                        onClick={() => void executeProposal(msg.id, pIdx, prop)}
                        className="w-full rounded-xl border-2 border-forest-600 bg-forest-50 hover:bg-forest-100 p-3 flex items-center justify-between gap-2 text-left transition active:scale-[0.99] shadow-2xs"
                      >
                        <div>
                          <div className="text-sm font-black text-forest-900">{prop.title}</div>
                          <div className="text-xs font-bold text-forest-800">{prop.summary}</div>
                        </div>
                        <span className="whitespace-nowrap inline-flex items-center gap-1 rounded-lg bg-forest-700 px-3 py-1.5 text-xs font-black text-white shrink-0">
                          <span>{prop.payload.button_label}</span>
                          <ArrowRight className="h-3.5 w-3.5" />
                        </span>
                      </button>
                    )
                  }

                  // 実行完了後は「おまかせ実行証明レシート」を表示
                  if (isExecuted && receipt) {
                    return renderReceiptCard(receipt)
                  }

                  const previewInfo = describeProposalTargetLocation(prop, defaultDate)

                  return (
                    <div
                      key={pIdx}
                      className="rounded-2xl border-2 border-harvest-500 bg-bg-card p-3.5 sm:p-4 space-y-3 shadow-sm transition"
                    >
                      <div>
                        <span className="whitespace-nowrap inline-block rounded-md bg-harvest-100 text-forest-900 px-2 py-0.5 text-xs font-black mb-1">
                          ✨ AIおまかせ実行プラン（確認）
                        </span>
                        <h4 className="text-sm sm:text-base font-black text-ink">{prop.title}</h4>
                        <p className="text-xs font-bold text-ink-soft mt-0.5">{prop.summary}</p>
                      </div>

                      {/* 実行前の「どこに・何が登録されるか」透明プレビュー */}
                      <div className="rounded-xl bg-harvest-50/70 border border-harvest-400 p-2.5 space-y-1.5">
                        <div className="flex items-center gap-1 text-xs font-black text-forest-900">
                          <MapPin className="h-3.5 w-3.5 text-harvest-700 shrink-0" />
                          <span>登録・反映される場所: {previewInfo.breadcrumb}</span>
                        </div>
                        {previewInfo.previewItems.length > 0 && (
                          <div className="grid gap-1 sm:grid-cols-2 pt-1 border-t border-harvest-400/60">
                            {previewInfo.previewItems.map((it, idx) => (
                              <div key={idx} className="text-xs font-bold text-ink">
                                <span className="text-ink-soft">・{it.label}: </span>
                                <span className="font-black">{it.value}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void executeProposal(msg.id, pIdx, prop)}
                        className="w-full rounded-xl bg-harvest-600 hover:bg-harvest-700 disabled:opacity-50 text-white py-3 px-4 text-sm sm:text-base font-black flex items-center justify-center gap-2 shadow-md transition active:scale-[0.99]"
                      >
                        {isBusy ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            <span>設定・登録を実行中...</span>
                          </>
                        ) : (
                          <>
                            <Check className="h-5 w-5 stroke-[3]" />
                            <span>はい、この内容でおまかせ実行する</span>
                          </>
                        )}
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        ))}

        {sending && (
          <div className="flex items-center gap-2 text-xs sm:text-sm font-black text-forest-800 bg-forest-50 border border-forest-200 rounded-2xl px-4 py-3 w-fit">
            <Loader2 className="h-4 w-4 animate-spin text-forest-600" />
            <span>AIコンシェルジュが準備しています...</span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* ③ おすすめの次の一言チップ */}
      {suggestions.length > 0 && (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
          <span className="text-xs font-black text-ink-muted shrink-0">💡 次のおすすめ:</span>
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              disabled={sending}
              onClick={() => void sendMessage(s)}
              className="shrink-0 rounded-full border border-forest-200 bg-bg-card hover:bg-forest-50 px-3 py-1 text-xs font-black text-ink transition active:scale-95"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* ④ 音声マイク付き・大型入力バー */}
      <div className="rounded-2xl border-2 border-forest-500 bg-bg-card p-2.5 shadow-md space-y-2">
        <div className="flex items-end gap-2">
          <button
            type="button"
            onClick={toggleVoiceInput}
            className={cn(
              'flex h-12 px-3.5 shrink-0 items-center justify-center gap-1.5 rounded-xl font-black text-xs sm:text-sm transition active:scale-95 shadow-xs',
              listening
                ? 'bg-alert text-white animate-pulse'
                : 'bg-sand-100 hover:bg-sand-200 text-ink border border-line-strong',
            )}
            title="声で話して入力する"
          >
            {listening ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5 text-forest-700" />}
            <span>{listening ? '停止' : '🎤 声で入力'}</span>
          </button>

          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void sendMessage()
              }
            }}
            rows={2}
            placeholder="ここにやりたいことを書くか、左の「🎤 声で入力」を押してお話しください（例：明日 和郷園に20箱追加して）"
            className="flex-1 rounded-xl border border-line bg-bg-soft/40 p-2.5 text-sm sm:text-base font-bold text-ink placeholder:text-ink-soft/60 focus:border-forest-600 focus:bg-bg-card focus:outline-none"
          />

          <button
            type="button"
            disabled={!input.trim() || sending}
            onClick={() => void sendMessage()}
            className="flex h-12 px-4 sm:px-5 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-forest-700 hover:bg-forest-800 disabled:opacity-40 text-white font-black text-sm sm:text-base shadow-sm transition active:scale-95"
          >
            <Send className="h-4 w-4" />
            <span>相談する</span>
          </button>
        </div>
      </div>
    </div>
  )
}
