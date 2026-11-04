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

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  proposals?: ConciergeAction[]
  executedIndices?: number[]
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
      '便別積込・配送リストを開きたい',
      '週間表（マトリックス）を開きたい',
      'このアプリの使い方をわかりやすく教えて',
    ],
  },
]

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
        'こんにちは！小島農園の「AI総合相談窓口」です🌱\n細かい画面操作や設定がわからなくても大丈夫です！「明日の注文を追加して」「新しい品目を入れて」「面倒な設定をオンにして」など、下のボタンを押すか、普通の言葉で話しかけてください。',
      proposals: [],
    },
  ])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [executingKey, setExecutingKey] = useState<string | null>(null)
  const [listening, setListening] = useState(false)
  const [suggestions, setSuggestions] = useState<string[]>([
    '明日の注文状況を教えて',
    'スタッフの設定を全部オンにして',
    '新しい品目で「春菊」を追加して',
  ])

  const bottomRef = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, sending])

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
          toast.success('音声を読み取りました！「送信」を押してください')
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
      const json = (await res.json().catch(() => ({}))) as Partial<ConciergeResponse> & { error?: string }
      if (!res.ok) {
        throw new Error(json.error ?? `通信エラー (${res.status})`)
      }

      const assistantMsg: ChatMessage = {
        id: `ai-${Date.now()}`,
        role: 'assistant',
        content: json.reply || '承知しました！以下の内容でよろしければ実行ボタンを押してください。',
        proposals: Array.isArray(json.proposals) ? json.proposals : [],
        executedIndices: [],
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

        const res = await fetch('/api/shipments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customer_id: matchedCust.id,
            destination_id: matchedDest?.id ?? null,
            product_id: matchedProd.id,
            delivery_date: p.delivery_date || defaultDate,
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

        const res = await fetch('/api/deliveries/departure-time', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            deliveryDate: p.delivery_date || defaultDate,
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

  return (
    <div className="space-y-4">
      {/* ① 文字入力が苦手な方のための「ワンタップ定型お願いボタン集」 */}
      <details className="group rounded-2xl border-2 border-emerald-300 bg-white shadow-xs" open>
        <summary className="flex cursor-pointer items-center justify-between px-4 py-3 text-sm font-black text-emerald-950 select-none">
          <span className="flex items-center gap-2">
            <HelpCircle className="h-4 w-4 text-emerald-600 shrink-0" />
            <span>👆 文字を打たずに頼める「よくあるお願いボタン」（タップするだけ）</span>
          </span>
          <span className="text-xs font-bold text-emerald-700 group-open:rotate-180 transition-transform">▼</span>
        </summary>
        <div className="border-t border-emerald-100 p-3.5 grid gap-3 sm:grid-cols-2 bg-emerald-50/40">
          {QUICK_PRESETS.map((group) => (
            <div key={group.category} className="rounded-xl bg-white p-3 border border-emerald-200/80 space-y-2">
              <div className="text-xs font-black text-forest-900">{group.category}</div>
              <div className="flex flex-wrap gap-1.5">
                {group.items.map((item) => (
                  <button
                    key={item}
                    type="button"
                    disabled={sending}
                    onClick={() => void sendMessage(item)}
                    className="rounded-xl border border-emerald-300 bg-emerald-50/80 hover:bg-emerald-100 px-3 py-1.5 text-xs font-black text-emerald-950 text-left transition active:scale-95 shadow-2xs"
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
      <div className="rounded-2xl border border-line bg-white p-3.5 sm:p-4 space-y-4 min-h-[320px] max-h-[560px] overflow-y-auto shadow-xs">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={cn('flex flex-col gap-2', msg.role === 'user' ? 'items-end' : 'items-start')}
          >
            <div
              className={cn(
                'max-w-[92%] sm:max-w-[82%] rounded-2xl px-4 py-3 text-sm sm:text-base font-bold leading-relaxed whitespace-pre-wrap shadow-2xs',
                msg.role === 'user'
                  ? 'bg-forest-700 text-white rounded-br-xs'
                  : 'bg-sand-100/90 border border-line text-ink rounded-bl-xs',
              )}
            >
              {msg.role === 'assistant' && (
                <div className="flex items-center gap-1.5 text-xs font-black text-emerald-800 mb-1">
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>AIコンシェルジュ</span>
                </div>
              )}
              {msg.content}
            </div>

            {/* アクション提案カード（「はい、実行する」ワンタップ確認ボタン） */}
            {msg.proposals && msg.proposals.length > 0 && (
              <div className="w-full max-w-[92%] sm:max-w-[82%] space-y-2">
                {msg.proposals.map((prop, pIdx) => {
                  const isExecuted = msg.executedIndices?.includes(pIdx)
                  const isBusy = executingKey === `${msg.id}-${pIdx}`

                  if (prop.type === 'navigate') {
                    return (
                      <button
                        key={pIdx}
                        type="button"
                        onClick={() => void executeProposal(msg.id, pIdx, prop)}
                        className="w-full rounded-xl border-2 border-forest-600 bg-forest-50 hover:bg-forest-100 p-3 flex items-center justify-between gap-2 text-left transition active:scale-[0.99] shadow-2xs"
                      >
                        <div>
                          <div className="text-sm font-black text-forest-950">{prop.title}</div>
                          <div className="text-xs font-bold text-forest-800">{prop.summary}</div>
                        </div>
                        <span className="inline-flex items-center gap-1 rounded-lg bg-forest-700 px-3 py-1.5 text-xs font-black text-white shrink-0">
                          <span>{prop.payload.button_label}</span>
                          <ArrowRight className="h-3.5 w-3.5" />
                        </span>
                      </button>
                    )
                  }

                  return (
                    <div
                      key={pIdx}
                      className={cn(
                        'rounded-2xl border-2 p-3.5 space-y-2.5 shadow-sm transition',
                        isExecuted
                          ? 'border-emerald-300 bg-emerald-50/70'
                          : 'border-emerald-500 bg-white',
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <span className="inline-block rounded-md bg-emerald-100 text-emerald-900 px-2 py-0.5 text-[11px] font-black mb-1">
                            ✨ AIおまかせ実行プラン
                          </span>
                          <h4 className="text-sm sm:text-base font-black text-ink">{prop.title}</h4>
                          <p className="text-xs font-bold text-ink-soft mt-0.5">{prop.summary}</p>
                        </div>
                      </div>

                      {isExecuted ? (
                        <div className="w-full rounded-xl bg-emerald-600 text-white py-2.5 px-4 text-xs sm:text-sm font-black flex items-center justify-center gap-1.5">
                          <Check className="h-4 w-4 stroke-[3]" />
                          <span>実行・反映しました！</span>
                        </div>
                      ) : (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => void executeProposal(msg.id, pIdx, prop)}
                          className="w-full rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white py-3 px-4 text-sm sm:text-base font-black flex items-center justify-center gap-2 shadow-md transition active:scale-[0.99]"
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
                      )}
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
              className="shrink-0 rounded-full border border-forest-300 bg-white hover:bg-forest-50 px-3 py-1 text-xs font-black text-forest-900 transition active:scale-95"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* ④ 音声マイク付き・大型入力バー */}
      <div className="rounded-2xl border-2 border-forest-500 bg-white p-2.5 shadow-md space-y-2">
        <div className="flex items-end gap-2">
          <button
            type="button"
            onClick={toggleVoiceInput}
            className={cn(
              'flex h-12 px-3.5 shrink-0 items-center justify-center gap-1.5 rounded-xl font-black text-xs sm:text-sm transition active:scale-95 shadow-xs',
              listening
                ? 'bg-red-600 text-white animate-pulse'
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
            className="flex-1 rounded-xl border border-line bg-bg-soft/40 p-2.5 text-sm sm:text-base font-bold text-ink placeholder:text-ink-soft/60 focus:border-forest-600 focus:bg-white focus:outline-none"
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
