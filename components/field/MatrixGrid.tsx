'use client'

import { useState } from 'react'
import { Download } from 'lucide-react'
import toast from 'react-hot-toast'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/Button'
import { parseQuantity } from '@/lib/calculations/parse-quantity'
import { formatJpDateShort } from '@/lib/dates'

export interface MatrixGridProps {
  productId: string
  productName: string
  productUnit: string
  customers: { id: string; name: string }[]
  /** 列の日付（YYYY-MM-DD、7日想定） */
  dates: string[]
  /** `${customer_id}|${date}` → 既存総数 */
  initial: Record<string, number>
  /** customer_id → packs_per_case（c記法プレビュー/誤入力検知用） */
  packsByCustomer: Record<string, number | null>
}

const key = (c: string, d: string) => `${c}|${d}`
const mmdd = formatJpDateShort

type CellState = 'idle' | 'saving' | 'saved' | 'error'

/**
 * 週間マトリックス入力（Laravel版 画面3）。
 * 行=取引先 / 列=日付。セルに "15c2" 等を打って離脱(blur)で保存（features.md §5 スマートパース）。
 * 空欄保存でその日のレコードを削除。CSVエクスポート対応。タップターゲット/数値は font-mono。
 */
export function MatrixGrid({
  productId,
  productName,
  productUnit,
  customers,
  dates,
  initial,
  packsByCustomer,
}: MatrixGridProps) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const v: Record<string, string> = {}
    for (const c of customers) for (const d of dates) {
      const n = initial[key(c.id, d)]
      v[key(c.id, d)] = n != null ? String(n) : ''
    }
    return v
  })
  // 直近に保存済みの値（変更検知用）
  const [saved, setSaved] = useState<Record<string, string>>(() => ({ ...values }))
  const [states, setStates] = useState<Record<string, CellState>>({})
  // 今フォーカス中のセル（c記法の展開プレビュー用）。表内は狭いので、表の下に1箇所だけ出す
  // 「数式バー」方式にする（初見でも「10c2」の意味がすぐ分かるように）。
  const [focused, setFocused] = useState<{ customerId: string; date: string } | null>(null)

  function setCell(k: string, val: string) {
    setValues((prev) => ({ ...prev, [k]: val }))
  }
  function setState(k: string, s: CellState) {
    setStates((prev) => ({ ...prev, [k]: s }))
  }

  async function saveCell(customerId: string, date: string) {
    const k = key(customerId, date)
    const raw = values[k] ?? ''
    if (raw === (saved[k] ?? '')) return // 変更なし

    // クライアント側で軽く検証（P/C不足のc記法などは保存前に弾く）
    if (raw.trim() !== '') {
      const pre = parseQuantity(raw, { packsPerCase: packsByCustomer[customerId] ?? null })
      if (pre.type === 'error') {
        setState(k, 'error')
        toast.error(
          pre.reason === 'packs_per_case_required'
            ? 'P/C未設定のためケース記法を換算できません（取引先設定で登録）'
            : '数量を解釈できません（例: 10 / 15c2 / x58）',
        )
        return
      }
    }

    setState(k, 'saving')
    try {
      const res = await fetch('/api/shipments/cell', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          customer_id: customerId,
          product_id: productId,
          delivery_date: date,
          quantity_raw: raw,
        }),
      })
      const json = (await res.json().catch(() => ({}))) as {
        item?: { quantity: number }
        deleted?: boolean
        error?: string
      }
      if (!res.ok) throw new Error(json.error ?? `保存に失敗 (${res.status})`)
      // サーバ確定値で表示を正規化
      const normalized = json.deleted ? '' : json.item != null ? String(json.item.quantity) : raw
      setValues((prev) => ({ ...prev, [k]: normalized }))
      setSaved((prev) => ({ ...prev, [k]: normalized }))
      setState(k, 'saved')
    } catch (e) {
      setState(k, 'error')
      toast.error(e instanceof Error ? e.message : '保存に失敗しました')
    }
  }

  function exportCsv() {
    const header = ['取引先', ...dates.map(mmdd)]
    const rows = customers.map((c) => [c.name, ...dates.map((d) => values[key(c.id, d)] ?? '')])
    const csv = [header, ...rows]
      .map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\r\n')
    // Excel が UTF-8 を正しく開けるよう BOM を付ける
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `出荷_${productName}_${dates[0]}_${dates[dates.length - 1]}.csv`
    document.body.appendChild(a)
    a.click()
    setTimeout(() => {
      URL.revokeObjectURL(url)
      a.remove()
    }, 1000)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-ink-soft">
          単位: <span className="font-medium text-ink">{productUnit}</span>　セルに <span className="num">15c2</span>（c=ケース、端数2）等を入力 → 離れると保存（空欄で削除）
        </p>
        <Button variant="secondary" size="sm" onClick={exportCsv}>
          <Download className="h-4 w-4" aria-hidden />
          CSV
        </Button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 border border-line bg-bg-soft px-3 py-2 text-left font-medium text-ink-soft">
                取引先
              </th>
              {dates.map((d) => (
                <th key={d} className="num min-w-[64px] border border-line bg-bg-soft px-2 py-2 text-center font-medium text-ink-soft">
                  {mmdd(d)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {customers.map((c) => (
              <tr key={c.id}>
                <th className="sticky left-0 z-10 border border-line bg-bg-card px-3 py-1.5 text-left font-medium text-ink">
                  {c.name}
                </th>
                {dates.map((d) => {
                  const k = key(c.id, d)
                  const st = states[k] ?? 'idle'
                  return (
                    <td key={d} className="border border-line p-0">
                      <input
                        type="text"
                        inputMode="text"
                        value={values[k] ?? ''}
                        onChange={(e) => setCell(k, e.target.value)}
                        onFocus={() => setFocused({ customerId: c.id, date: d })}
                        onBlur={() => {
                          saveCell(c.id, d)
                          setFocused((prev) => (prev && prev.customerId === c.id && prev.date === d ? null : prev))
                        }}
                        aria-label={`${c.name} ${mmdd(d)}`}
                        className={cn(
                          'num h-11 w-full min-w-[60px] bg-transparent px-2 text-center tabular-nums text-ink',
                          'focus:outline-none focus:ring-2 focus:ring-inset focus:ring-trust-100',
                          st === 'saving' && 'bg-trust-50',
                          st === 'saved' && 'bg-harvest-50',
                          st === 'error' && 'bg-alert/10 ring-1 ring-inset ring-alert',
                        )}
                      />
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* c記法の即時展開（数式バー）。「10c2」が初見でも分かるよう、入力中のセルだけその場で展開して見せる。 */}
      {focused && (
        <QuantityPreviewBar
          raw={values[key(focused.customerId, focused.date)] ?? ''}
          packsPerCase={packsByCustomer[focused.customerId] ?? null}
          unit={productUnit}
        />
      )}
    </div>
  )
}

/** フォーカス中セルの生入力を、その場で「15ケース×12入+端数2=182個」等に展開して見せる。 */
function QuantityPreviewBar({
  raw,
  packsPerCase,
  unit,
}: {
  raw: string
  packsPerCase: number | null
  unit: string
}) {
  if (raw.trim() === '') return null
  const result = parseQuantity(raw, { packsPerCase })

  if (result.type === 'error') {
    if (result.reason === 'packs_per_case_required') {
      return (
        <p className="rounded border border-alert/40 bg-alert-bg/40 px-3 py-2 text-xs text-alert">
          「{raw}」はケース記法ですが、この取引先はP/C（1ケースの入数）が未設定のため換算できません。取引先設定で登録してください。
        </p>
      )
    }
    return null // 入力途中は解釈不能でも静かに待つ（毎キー入力でエラーを出さない）
  }
  if (result.type === 'delete') return null

  // プレーン数値（そのままの総数）は展開の必要が薄いので、確認だけ軽く示す
  if (result.interpretation === 'plain') {
    return (
      <p className="num text-xs text-ink-faint">
        {result.total.toString()} {unit} として保存されます
      </p>
    )
  }

  const detail =
    result.interpretation === 'cases'
      ? `${result.cases}ケース × ${packsPerCase}入${result.loose ? ` + 端数${result.loose}` : ''}`
      : 'x記法（合計個数）'

  return (
    <p className="num flex items-center gap-1.5 rounded border border-trust-200 bg-trust-50 px-3 py-2 text-xs text-trust-700">
      <span>{detail}</span>
      <span aria-hidden>=</span>
      <span className="text-sm font-bold">{result.total.toString()} {unit}</span>
    </p>
  )
}
