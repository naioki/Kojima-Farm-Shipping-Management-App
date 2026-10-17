'use client'

import { useState } from 'react'
import { Sparkles, MessageSquarePlus, RotateCcw } from 'lucide-react'
import toast from 'react-hot-toast'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { OcrSaveSection } from '@/components/admin/OcrSaveSection'

interface Destination {
  id: string
  customer_id: string
  code: string | null
  full_name: string
  aliases: string[]
}

interface ParsedItem {
  raw_name: string
  product_name: string | null
  quantity: string
  unit: string | null
  confidence: number
  spec?: string | null
  packs_per_case?: number | null
  cases?: number | null
  remainder_packs?: number | null
  box_count?: number | null
}

interface ParsedOrder {
  customer_name: string | null
  destination_name?: string | null
  delivery_date: string | null
  items: ParsedItem[]
}

interface OcrResult {
  is_order: boolean
  orders: ParsedOrder[]
}

export interface QuickOrderModalProps {
  customers: { id: string; name: string }[]
  products: { id: string; name: string; category?: string | null }[]
  destinations: Destination[]
}

const SAMPLE_PROMPTS = [
  '明日 勘兵衛 イオンタウン向け チンゲン菜 5ケース',
  '明日 和郷園 パルシステム岩槻 チンゲン菜 300+0 (15-0)',
  '明後日 房総食料センター BOX用 チンゲン菜 84パック',
  '明日 農業総合研究所 小島裕美 チンゲン菜 96パック シールあり',
]

/**
 * クイック注文入力モーダル（/admin/orders）。
 * Discord `/order` コマンドの代替として、自然言語テキスト（例:「明日 勘兵衛 イオンタウン向け チンゲン菜 5ケース」）から
 * AI解析（v2.3プロンプト + `ai_rules` 動的注入）を通して即座に注文化できる入力UI。
 */
export function QuickOrderModal({
  customers: initialCustomers,
  products,
  destinations: initialDestinations,
}: QuickOrderModalProps) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [result, setResult] = useState<OcrResult | null>(null)
  const [customerList, setCustomerList] = useState(initialCustomers)
  const [destinationList, setDestinationList] = useState(initialDestinations)

  async function handleAnalyze() {
    const trimmed = text.trim()
    if (!trimmed) {
      toast.error('注文テキストを入力してください')
      return
    }
    setAnalyzing(true)
    setResult(null)
    try {
      const res = await fetch('/api/ocr/analyze', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: trimmed }),
      })
      const json = (await res.json().catch(() => ({}))) as OcrResult & { error?: string }
      if (!res.ok) throw new Error(json.error ?? `AI解析失敗 (${res.status})`)
      setResult(json)
      if (!json.is_order || json.orders.length === 0) {
        toast('チンゲン菜の注文として認識されませんでした。表現を確認してください', { icon: '⚠️' })
      } else {
        toast.success(`${json.orders.length}件の注文内容を解析しました。内容を確認して保存してください`)
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'AI解析に失敗しました')
    } finally {
      setAnalyzing(false)
    }
  }

  function handleReset() {
    setText('')
    setResult(null)
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-10 items-center gap-2 rounded-lg border border-earth-500 bg-earth-50 px-3 text-sm font-bold text-earth-800 transition-colors hover:bg-earth-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-earth-400"
      >
        <Sparkles className="h-4 w-4 text-earth-700" aria-hidden />
        + テキストからクイック注文
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="クイック注文入力（AI自然言語解析 v2.3）"
        className="max-w-3xl"
      >
        <div className="max-h-[80vh] space-y-4 overflow-y-auto pr-1">
          <div className="space-y-2">
            <label htmlFor="quick-order-text" className="block text-xs font-medium text-ink-soft">
              自然言語で追加注文・電話注文・LINE転記を入力してください（入数20/24・ケース換算は自動適用されます）
            </label>
            <textarea
              id="quick-order-text"
              rows={3}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault()
                  void handleAnalyze()
                }
              }}
              placeholder="例: 明日 勘兵衛 イオンタウン向け チンゲン菜 5ケース"
              className="w-full rounded-lg border border-line-strong bg-bg-card p-3 text-sm text-ink focus:border-trust-500 focus:outline-none focus:ring-2 focus:ring-trust-100"
            />

            {/* ワンクリック入力サンプル */}
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <span className="text-[11px] text-ink-faint">入力例:</span>
              {SAMPLE_PROMPTS.map((sample) => (
                <button
                  key={sample}
                  type="button"
                  onClick={() => setText(sample)}
                  className="rounded-full border border-line bg-bg-soft px-2.5 py-0.5 text-[11px] text-ink-soft transition-colors hover:border-earth-400 hover:bg-earth-50 hover:text-ink"
                >
                  {sample}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-end gap-2">
            {result && (
              <Button variant="secondary" size="sm" onClick={handleReset} disabled={analyzing}>
                <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                クリア
              </Button>
            )}
            <Button
              variant="primary"
              size="md"
              onClick={handleAnalyze}
              isLoading={analyzing}
              disabled={!text.trim()}
            >
              <MessageSquarePlus className="h-4 w-4" aria-hidden />
              AIで解析して注文フォームを作成
            </Button>
          </div>

          {/* 解析結果プレビュー＆保存セクション */}
          {result && (
            <div className="space-y-4 border-t border-line pt-4">
              {!result.is_order || result.orders.length === 0 ? (
                <p className="rounded-lg border border-warning/40 bg-warning-bg px-4 py-3 text-xs font-medium text-warning">
                  チンゲン菜の注文明細が抽出されませんでした（小島農園の出荷対象はチンゲン菜のみです）。テキストを確認して再度お試しください。
                </p>
              ) : (
                result.orders.map((order, idx) => (
                  <OcrSaveSection
                    key={idx}
                    order={order}
                    index={idx}
                    customers={customerList}
                    products={products}
                    destinations={destinationList}
                    onCustomerAdded={(c) =>
                      setCustomerList((prev) =>
                        prev.some((x) => x.id === c.id) ? prev : [...prev, c],
                      )
                    }
                    onDestinationAdded={(d) =>
                      setDestinationList((prev) =>
                        prev.some((x) => x.id === d.id) ? prev : [...prev, d],
                      )
                    }
                  />
                ))
              )}
            </div>
          )}
        </div>
      </Modal>
    </>
  )
}
