'use client'

import { useState, useMemo, Fragment } from 'react'
import Link from 'next/link'
import { Download, Filter, ChevronRight, ChevronDown, Box, Layers, ExternalLink } from 'lucide-react'
import toast from 'react-hot-toast'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/Button'
import { parseQuantity } from '@/lib/calculations/parse-quantity'
import { formatJpDateShort, jstTodayStr, shiftDateStr } from '@/lib/dates'
import { fieldErrorMessage } from '@/lib/field/net-error'

export interface MatrixDestinationItem {
  id: string
  customerId: string
  label: string
}

export interface MatrixGridProps {
  productId: string
  productName: string
  productUnit: string
  customers: { id: string; name: string }[]
  destinationsByCustomer?: Record<string, MatrixDestinationItem[]>
  dates: string[]
  initial: Record<string, number>
  initialByDest?: Record<string, number>
  packsByCustomer: Record<string, number | null>
}

const key = (c: string, d: string) => `${c}|${d}`
const destKey = (c: string, destId: string, d: string) => `${c}|${destId}|${d}`
const mmdd = formatJpDateShort

type CellState = 'idle' | 'saving' | 'saved' | 'error'

/**
 * 週の管理（週間マトリックス）。
 * - #24: 普段は取引先ごとの合計1行で全体のイメージを掴め、『▶ 内訳』1タップで納入先ごとのサブ行がアコーディオン展開されて個別に確認・編集可能。
 * - #25: 納入先サブ行ごとに destination_id を指定して PUT /api/shipments/cell で正確に保存。
 * - #26: 『📦 箱数表示 ⇄ 🥬 パック数表示』を1タップで切り替え可能（箱数表示時はメインに「60箱」等をわかりやすく表示）。
 * - #27: 日付列ヘッダー（11/3(火) 等）をタップすると、その日の「収穫・パックボード」へ1タップでジャンプ。
 */
export function MatrixGrid({
  productId,
  productName,
  productUnit,
  customers,
  destinationsByCustomer = {},
  dates,
  initial,
  initialByDest = {},
  packsByCustomer,
}: MatrixGridProps) {
  // #26 表示単位モード（デフォルトは直感的な「boxes（箱数メイン）」、1タップで「packs（パック数）」に切替可能）
  const [unitMode, setUnitMode] = useState<'boxes' | 'packs'>('boxes')
  // #24 納入先内訳を展開中の取引先IDセット
  const [expandedCustomers, setExpandedCustomers] = useState<Set<string>>(new Set())

  const [values, setValues] = useState<Record<string, string>>(() => {
    const v: Record<string, string> = {}
    for (const c of customers) {
      for (const d of dates) {
        const n = initial[key(c.id, d)]
        v[key(c.id, d)] = n != null ? String(n) : ''
      }
    }
    return v
  })
  const [saved, setSaved] = useState<Record<string, string>>(() => ({ ...values }))

  // 納入先サブ行の値（key: `${customerId}|${destId}|${date}`）
  const [destValues, setDestValues] = useState<Record<string, string>>(() => {
    const dv: Record<string, string> = {}
    for (const c of customers) {
      const dests = destinationsByCustomer[c.id] ?? []
      for (const dest of dests) {
        for (const d of dates) {
          const dk = destKey(c.id, dest.id, d)
          const n = initialByDest[dk]
          dv[dk] = n != null ? String(n) : ''
        }
      }
    }
    return dv
  })
  const [destSaved, setDestSaved] = useState<Record<string, string>>(() => ({ ...destValues }))

  const [states, setStates] = useState<Record<string, CellState>>({})
  const [focused, setFocused] = useState<{ customerId: string; destId?: string; date: string } | null>(null)
  const [onlyWithOrders, setOnlyWithOrders] = useState(true)
  const [addedCustomerIds, setAddedCustomerIds] = useState<Set<string>>(new Set())

  const toggleExpandCustomer = (customerId: string) => {
    setExpandedCustomers((prev) => {
      const next = new Set(prev)
      if (next.has(customerId)) next.delete(customerId)
      else next.add(customerId)
      return next
    })
  }

  const getCustomerPpc = (customerId: string, customerName?: string): number => {
    const ppc = packsByCustomer[customerId]
    if (ppc && ppc > 0) return ppc
    if (customerName && (customerName.includes('農業総合研究所') || customerName.toUpperCase().includes('NSK'))) {
      return 24
    }
    return 20
  }

  // 取引先ごとの週間合計数量（パック数）
  const customerTotals = useMemo(() => {
    const totals: Record<string, number> = {}
    for (const c of customers) {
      let sum = 0
      for (const d of dates) {
        const val = values[key(c.id, d)]
        if (val) {
          const num = Number(val)
          if (!isNaN(num)) sum += num
        }
      }
      totals[c.id] = sum
    }
    return totals
  }, [customers, dates, values])

  // 各日付の出荷合計数量（パック数＆箱数）
  const dateTotals = useMemo(() => {
    const packs: Record<string, number> = {}
    const boxes: Record<string, number> = {}
    for (const d of dates) {
      let pSum = 0
      let bSum = 0
      for (const c of customers) {
        const val = values[key(c.id, d)]
        if (val) {
          const num = Number(val)
          if (!isNaN(num) && num > 0) {
            pSum += num
            const ppc = getCustomerPpc(c.id, c.name)
            bSum += Math.ceil(num / ppc)
          }
        }
      }
      packs[d] = pSum
      boxes[d] = bSum
    }
    return { packs, boxes }
  }, [customers, dates, values, packsByCustomer])

  const grandTotalPacks = useMemo(() => {
    return Object.values(dateTotals.packs).reduce((a, b) => a + b, 0)
  }, [dateTotals])

  const grandTotalBoxes = useMemo(() => {
    return Object.values(dateTotals.boxes).reduce((a, b) => a + b, 0)
  }, [dateTotals])

  const visibleCustomers = useMemo(() => {
    if (!onlyWithOrders) return customers
    return customers.filter((c) => (customerTotals[c.id] ?? 0) > 0 || addedCustomerIds.has(c.id))
  }, [customers, onlyWithOrders, customerTotals, addedCustomerIds])

  const availableCustomers = useMemo(() => {
    const visibleSet = new Set(visibleCustomers.map((c) => c.id))
    return customers.filter((c) => !visibleSet.has(c.id))
  }, [customers, visibleCustomers])

  function setCell(k: string, val: string) {
    setValues((prev) => ({ ...prev, [k]: val }))
  }
  function setDestCell(dk: string, val: string) {
    setDestValues((prev) => ({ ...prev, [dk]: val }))
  }
  function setState(k: string, s: CellState) {
    setStates((prev) => ({ ...prev, [k]: s }))
  }

  /**
   * 親行または納入先サブ行のセル保存（#25 destination_id 対応）
   */
  async function saveCell(customerId: string, date: string, destinationId?: string | null) {
    const isDestRow = Boolean(destinationId)
    const k = isDestRow ? destKey(customerId, destinationId!, date) : key(customerId, date)
    const raw = isDestRow ? (destValues[k] ?? '') : (values[k] ?? '')
    const prevSaved = isDestRow ? (destSaved[k] ?? '') : (saved[k] ?? '')
    if (raw === prevSaved) return

    const ppc = getCustomerPpc(customerId)
    // 箱数モードで純粋な数字（例: "60"）が入力され、その数値がパック入数より小さいまたは箱数として自然な場合のスマート変換ではなく、
    // 入力欄では常にパック数または "60c"（ケース記法）を受け付ける安全設計
    if (raw.trim() !== '') {
      const pre = parseQuantity(raw, { packsPerCase: ppc })
      if (pre.type === 'error') {
        setState(k, 'error')
        toast.error('数量を解釈できません（例: 60c または 1440）')
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
          destination_id: destinationId ?? null,
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
      const normalized = json.deleted ? '' : json.item != null ? String(json.item.quantity) : raw

      if (isDestRow) {
        const nextDestVals = { ...destValues, [k]: normalized }
        setDestValues(nextDestVals)
        setDestSaved((prev) => ({ ...prev, [k]: normalized }))
        // 親行（取引先合計）も全納入先の合算値で即時更新
        const dests = destinationsByCustomer[customerId] ?? []
        const newParentSum = dests.reduce((acc, dItem) => {
          const v = Number(nextDestVals[destKey(customerId, dItem.id, date)] || 0)
          return acc + (isNaN(v) ? 0 : v)
        }, 0)
        const parentStr = newParentSum > 0 ? String(newParentSum) : ''
        setValues((prev) => ({ ...prev, [key(customerId, date)]: parentStr }))
        setSaved((prev) => ({ ...prev, [key(customerId, date)]: parentStr }))
      } else {
        setValues((prev) => ({ ...prev, [k]: normalized }))
        setSaved((prev) => ({ ...prev, [k]: normalized }))
      }
      setState(k, 'saved')
      toast.success('保存しました', { id: 'matrix-cell-save', duration: 1500 })
    } catch (e) {
      setState(k, 'error')
      toast.error(fieldErrorMessage(e, '保存に失敗しました'))
    }
  }

  function exportCsv() {
    const header = ['取引先・納入先', ...dates.map(mmdd)]
    const rows: string[][] = []
    for (const c of customers) {
      rows.push([c.name, ...dates.map((d) => values[key(c.id, d)] ?? '')])
      const dests = destinationsByCustomer[c.id] ?? []
      if (dests.length > 1) {
        for (const dest of dests) {
          rows.push([
            `  ↳ ${dest.label}`,
            ...dates.map((d) => destValues[destKey(c.id, dest.id, d)] ?? ''),
          ])
        }
      }
    }
    const csv = [header, ...rows]
      .map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\r\n')
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `週間出荷_${productName}_${dates[0]}_${dates[dates.length - 1]}.csv`
    document.body.appendChild(a)
    a.click()
    setTimeout(() => {
      URL.revokeObjectURL(url)
      a.remove()
    }, 1000)
  }

  return (
    <div className="space-y-3">
      {/* 上部コントロールバー（#26 箱数 ⇄ パック数 ワンタップ切替 ＋ フィルタ ＋ CSV） */}
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex flex-wrap items-center gap-2">
          {/* #26 ワンタップ 箱数 ⇄ パック数 切替スイッチ */}
          <div className="inline-flex items-center rounded-xl border border-forest-300 bg-forest-50/70 p-1 shadow-2xs">
            <button
              type="button"
              onClick={() => setUnitMode('boxes')}
              className={cn(
                'inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-black transition-all',
                unitMode === 'boxes'
                  ? 'bg-forest-700 text-white shadow-xs'
                  : 'text-forest-900 hover:bg-white/70',
              )}
            >
              <Box className="h-3.5 w-3.5" />
              <span>📦 箱数メイン表示</span>
            </button>
            <button
              type="button"
              onClick={() => setUnitMode('packs')}
              className={cn(
                'inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-black transition-all',
                unitMode === 'packs'
                  ? 'bg-forest-700 text-white shadow-xs'
                  : 'text-forest-900 hover:bg-white/70',
              )}
            >
              <Layers className="h-3.5 w-3.5" />
              <span>🥬 パック数表示</span>
            </button>
          </div>

          {/* 発注ありのみトグル */}
          <button
            type="button"
            onClick={() => setOnlyWithOrders(!onlyWithOrders)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-bold transition-colors',
              onlyWithOrders
                ? 'border-trust-600 bg-trust-50 text-trust-800'
                : 'border-line bg-bg-card text-ink-soft hover:bg-bg-soft',
            )}
          >
            <Filter className="h-3.5 w-3.5" aria-hidden />
            <span>
              {onlyWithOrders ? '予定ありのみ' : '全取引先を表示'} ({visibleCustomers.length}/{customers.length}社)
            </span>
          </button>

          {onlyWithOrders && availableCustomers.length > 0 && (
            <div className="relative inline-flex items-center">
              <select
                aria-label="取引先を追加して入力"
                onChange={(e) => {
                  const id = e.target.value
                  if (id) {
                    setAddedCustomerIds((prev) => new Set([...prev, id]))
                    e.target.value = ''
                  }
                }}
                defaultValue=""
                className="h-8 rounded-xl border border-dashed border-earth-300 bg-earth-50/60 px-2.5 text-xs font-bold text-earth-800 hover:bg-earth-100 focus:outline-none"
              >
                <option value="" disabled>
                  ＋ 取引先を追加して入力 ({availableCustomers.length}社)
                </option>
                {availableCustomers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <span className="hidden text-xs text-ink-soft sm:inline">
            💡 日付タップでその日のパックボードへ移動 ／ 「▶ 内訳」で納入先別に展開
          </span>
          <Button variant="secondary" size="sm" onClick={exportCsv}>
            <Download className="h-4 w-4" aria-hidden />
            CSV
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-line bg-bg-card shadow-sm">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 border border-line bg-bg-soft px-3 py-2 text-left font-bold text-ink min-w-[165px]">
                取引先（タップで内訳展開）
              </th>
              {dates.map((d) => {
                const isTodayCol = d === jstTodayStr()
                const isTomorrowCol = d === shiftDateStr(jstTodayStr(), 1)
                return (
                  <th
                    key={d}
                    className={cn(
                      'num min-w-[78px] border border-line p-0 text-center font-bold transition-colors',
                      isTomorrowCol
                        ? 'bg-emerald-100/90 text-forest-900 hover:bg-emerald-200/80'
                        : isTodayCol
                        ? 'bg-sky-100/90 text-sky-900 hover:bg-sky-200/80'
                        : 'bg-bg-soft text-ink-soft hover:bg-slate-200/70',
                    )}
                  >
                    {/* #27 日付ヘッダー1タップでその日の収穫・パックボードへ移動 */}
                    <Link
                      href={`/field/shipments?date=${d}&product=${productId}`}
                      className="block px-2 py-2 w-full h-full group"
                      title={`${mmdd(d)} の収穫・パックボードを開く`}
                    >
                      <span className="inline-flex items-center justify-center gap-0.5 text-xs sm:text-sm font-black group-hover:underline">
                        <span>{mmdd(d)}</span>
                        <ExternalLink className="h-3 w-3 opacity-50 group-hover:opacity-100" />
                      </span>
                      {isTomorrowCol && (
                        <span className="block text-[10px] font-black text-emerald-800">
                          明日納品(今日作業)
                        </span>
                      )}
                      {isTodayCol && (
                        <span className="block text-[10px] font-black text-sky-800">
                          今日納品
                        </span>
                      )}
                    </Link>
                  </th>
                )
              })}
              <th className="num min-w-[78px] border border-line bg-bg-soft px-2 py-2 text-center font-black text-trust-800">
                週合計
              </th>
            </tr>
          </thead>
          <tbody>
            {visibleCustomers.length === 0 ? (
              <tr>
                <td colSpan={dates.length + 2} className="py-8 text-center text-sm text-ink-muted">
                  今週はこの品目の予定がある取引先はありません。「全取引先を表示」または「＋取引先を追加」から入力できます。
                </td>
              </tr>
            ) : (
              visibleCustomers.map((c) => {
                const totalPacks = customerTotals[c.id] ?? 0
                const ppc = getCustomerPpc(c.id, c.name)
                const totalBoxes = totalPacks > 0 ? Math.ceil(totalPacks / ppc) : 0
                const custDests = destinationsByCustomer[c.id] ?? []
                const hasMultipleDests = custDests.length > 1
                const isExpanded = expandedCustomers.has(c.id)

                return (
                  <Fragment key={c.id}>
                    {/* 親行：取引先トータル（全体のイメージを1行で把握） */}
                    <tr
                      className={cn(
                        'transition-colors',
                        isExpanded ? 'bg-forest-50/40' : 'hover:bg-bg-soft/50',
                      )}
                    >
                      <th className="sticky left-0 z-10 border border-line bg-bg-card px-2.5 py-2 text-left font-bold text-ink">
                        <div className="flex items-center justify-between gap-1.5">
                          <span className="truncate text-xs sm:text-sm font-black text-ink">
                            {c.name.replace(/^株式会社|^（株）|^㈱|^農事組合法人\s*/, '')}
                          </span>
                          {hasMultipleDests && (
                            <button
                              type="button"
                              onClick={() => toggleExpandCustomer(c.id)}
                              className={cn(
                                'inline-flex items-center gap-0.5 rounded-md border px-1.5 py-0.5 text-[10px] font-black shrink-0 transition active:scale-95',
                                isExpanded
                                  ? 'border-forest-600 bg-forest-600 text-white'
                                  : 'border-emerald-300 bg-emerald-50 text-emerald-900 hover:bg-emerald-100',
                              )}
                              title="納入先別の内訳を開閉"
                            >
                              {isExpanded ? (
                                <>
                                  <ChevronDown className="h-3 w-3" />
                                  <span>閉じる</span>
                                </>
                              ) : (
                                <>
                                  <ChevronRight className="h-3 w-3" />
                                  <span>内訳({custDests.length})</span>
                                </>
                              )}
                            </button>
                          )}
                        </div>
                        <span className="block text-[10px] font-bold text-ink-muted">
                          1箱＝{ppc}P
                        </span>
                      </th>

                      {dates.map((d) => {
                        const k = key(c.id, d)
                        const st = states[k] ?? 'idle'
                        const rawVal = values[k] ?? ''
                        const numPacks = Number(rawVal) || 0
                        const numBoxes = numPacks > 0 ? Math.ceil(numPacks / ppc) : 0
                        const isCellFocused =
                          focused?.customerId === c.id && !focused?.destId && focused?.date === d

                        // 複数納入先がある親行は、タップしたら安全のため内訳サブ行を展開して編集させる（#24, #25）
                        if (hasMultipleDests) {
                          return (
                            <td
                              key={d}
                              onClick={() => {
                                if (!isExpanded) toggleExpandCustomer(c.id)
                              }}
                              className="border border-line p-1 text-center cursor-pointer hover:bg-emerald-50/50 transition"
                              title="タップして納入先別の内訳を展開・編集"
                            >
                              {numPacks > 0 ? (
                                unitMode === 'boxes' ? (
                                  <div>
                                    <span className="num block text-sm sm:text-base font-black text-forest-900">
                                      {numBoxes}
                                      <small className="text-[10px] font-bold ml-0.5">箱</small>
                                    </span>
                                    <span className="num block text-[10px] font-bold text-ink-soft">
                                      ({numPacks.toLocaleString()}P)
                                    </span>
                                  </div>
                                ) : (
                                  <div>
                                    <span className="num block text-sm sm:text-base font-black text-ink">
                                      {numPacks.toLocaleString()}
                                    </span>
                                    <span className="num block text-[10px] font-bold text-ink-soft">
                                      ({numBoxes}箱)
                                    </span>
                                  </div>
                                )
                              ) : (
                                <span className="text-xs text-ink-faint">—</span>
                              )}
                            </td>
                          )
                        }

                        // 単一納入先の取引先はそのままセルで直接入力・編集可能
                        return (
                          <td key={d} className="border border-line p-0 relative">
                            {!isCellFocused && numPacks > 0 && unitMode === 'boxes' ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setFocused({ customerId: c.id, date: d })
                                  setTimeout(() => {
                                    const el = document.querySelector<HTMLInputElement>(
                                      `input[data-matrix-cell="${c.id}|${d}"]`,
                                    )
                                    el?.focus()
                                    el?.select()
                                  }, 10)
                                }}
                                className={cn(
                                  'w-full h-12 px-1 flex flex-col items-center justify-center hover:bg-forest-50/50 transition',
                                  st === 'saving' && 'bg-trust-50',
                                  st === 'saved' && 'bg-harvest-50',
                                )}
                              >
                                <span className="num text-sm sm:text-base font-black text-forest-900 leading-tight">
                                  {numBoxes}
                                  <small className="text-[10px] font-bold ml-0.5">箱</small>
                                </span>
                                <span className="num text-[10px] font-bold text-ink-soft leading-tight">
                                  ({numPacks.toLocaleString()}P)
                                </span>
                              </button>
                            ) : (
                              <input
                                type="text"
                                inputMode="text"
                                data-matrix-cell={`${c.id}|${d}`}
                                value={rawVal}
                                onChange={(e) => setCell(k, e.target.value)}
                                onFocus={() => setFocused({ customerId: c.id, date: d })}
                                onKeyDown={(e) => {
                                  if (e.nativeEvent.isComposing) return
                                  if (e.key === 'Enter') {
                                    e.preventDefault()
                                    e.currentTarget.blur()
                                  }
                                }}
                                onBlur={() => {
                                  saveCell(c.id, d, custDests[0]?.id ?? null)
                                  setFocused((prev) =>
                                    prev && prev.customerId === c.id && !prev.destId && prev.date === d ? null : prev,
                                  )
                                }}
                                placeholder={unitMode === 'boxes' ? '例:30c' : ''}
                                aria-label={`${c.name} ${mmdd(d)}`}
                                className={cn(
                                  'num h-12 w-full min-w-[68px] bg-transparent px-1.5 text-center font-bold tabular-nums text-ink placeholder:text-[10px] placeholder:font-normal placeholder:text-ink-faint',
                                  'focus:outline-none focus:ring-2 focus:ring-inset focus:ring-forest-500 focus:bg-white',
                                  st === 'saving' && 'bg-trust-50',
                                  st === 'saved' && 'bg-harvest-50',
                                  st === 'error' && 'bg-alert/10 ring-1 ring-inset ring-alert',
                                )}
                              />
                            )}
                          </td>
                        )
                      })}

                      <td className="num border border-line bg-bg-soft/40 px-2 py-1.5 text-center font-bold tabular-nums text-ink">
                        {totalPacks > 0 ? (
                          unitMode === 'boxes' ? (
                            <div>
                              <span className="block text-sm font-black text-forest-900">{totalBoxes}箱</span>
                              <span className="block text-[10px] font-bold text-ink-soft">
                                ({totalPacks.toLocaleString()}P)
                              </span>
                            </div>
                          ) : (
                            <div>
                              <span className="block text-sm font-black">{totalPacks.toLocaleString()}P</span>
                              <span className="block text-[10px] font-bold text-ink-soft">({totalBoxes}箱)</span>
                            </div>
                          )
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>

                    {/* #24 子行：折りたたみ展開された納入先別サブ行（個別確認・個別セル編集対応） */}
                    {hasMultipleDests &&
                      isExpanded &&
                      custDests.map((dest) => {
                        const destRowTotalPacks = dates.reduce((acc, d) => {
                          const v = Number(destValues[destKey(c.id, dest.id, d)] || 0)
                          return acc + (isNaN(v) ? 0 : v)
                        }, 0)
                        const destRowTotalBoxes =
                          destRowTotalPacks > 0 ? Math.ceil(destRowTotalPacks / ppc) : 0

                        return (
                          <tr
                            key={`${c.id}:${dest.id}`}
                            className="bg-emerald-50/30 hover:bg-emerald-50/60 text-xs"
                          >
                            <th className="sticky left-0 z-10 border border-line bg-emerald-50/90 pl-5 pr-2.5 py-1.5 text-left font-bold text-emerald-950">
                              <div className="flex items-center gap-1">
                                <span className="text-emerald-600">↳</span>
                                <span className="truncate">{dest.label}</span>
                              </div>
                            </th>
                            {dates.map((d) => {
                              const dk = destKey(c.id, dest.id, d)
                              const st = states[dk] ?? 'idle'
                              const dRawVal = destValues[dk] ?? ''
                              const dPacks = Number(dRawVal) || 0
                              const dBoxes = dPacks > 0 ? Math.ceil(dPacks / ppc) : 0
                              const isSubFocused =
                                focused?.customerId === c.id &&
                                focused?.destId === dest.id &&
                                focused?.date === d

                              return (
                                <td key={d} className="border border-line p-0">
                                  {!isSubFocused && dPacks > 0 && unitMode === 'boxes' ? (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setFocused({ customerId: c.id, destId: dest.id, date: d })
                                        setTimeout(() => {
                                          const el = document.querySelector<HTMLInputElement>(
                                            `input[data-matrix-cell="${c.id}|${dest.id}|${d}"]`,
                                          )
                                          el?.focus()
                                          el?.select()
                                        }, 10)
                                      }}
                                      className={cn(
                                        'w-full h-10 px-1 flex flex-col items-center justify-center hover:bg-white/80 transition',
                                        st === 'saving' && 'bg-trust-50',
                                        st === 'saved' && 'bg-harvest-50',
                                      )}
                                    >
                                      <span className="num text-xs sm:text-sm font-black text-emerald-900 leading-tight">
                                        {dBoxes}箱
                                      </span>
                                      <span className="num text-[10px] font-bold text-ink-soft leading-tight">
                                        ({dPacks}P)
                                      </span>
                                    </button>
                                  ) : (
                                    <input
                                      type="text"
                                      inputMode="text"
                                      data-matrix-cell={`${c.id}|${dest.id}|${d}`}
                                      value={dRawVal}
                                      onChange={(e) => setDestCell(dk, e.target.value)}
                                      onFocus={() =>
                                        setFocused({ customerId: c.id, destId: dest.id, date: d })
                                      }
                                      onKeyDown={(e) => {
                                        if (e.nativeEvent.isComposing) return
                                        if (e.key === 'Enter') {
                                          e.preventDefault()
                                          e.currentTarget.blur()
                                        }
                                      }}
                                      onBlur={() => {
                                        saveCell(c.id, d, dest.id)
                                        setFocused((prev) =>
                                          prev &&
                                          prev.customerId === c.id &&
                                          prev.destId === dest.id &&
                                          prev.date === d
                                            ? null
                                            : prev,
                                        )
                                      }}
                                      placeholder="例:20c"
                                      aria-label={`${c.name} ${dest.label} ${mmdd(d)}`}
                                      className={cn(
                                        'num h-10 w-full min-w-[68px] bg-white/60 px-1.5 text-center font-bold tabular-nums text-ink placeholder:text-[10px] placeholder:font-normal placeholder:text-ink-faint',
                                        'focus:outline-none focus:ring-2 focus:ring-inset focus:ring-emerald-600 focus:bg-white',
                                        st === 'saving' && 'bg-trust-50',
                                        st === 'saved' && 'bg-harvest-50',
                                        st === 'error' && 'bg-alert/10 ring-1 ring-inset ring-alert',
                                      )}
                                    />
                                  )}
                                </td>
                              )
                            })}
                            <td className="num border border-line bg-emerald-100/40 px-2 py-1 text-center font-bold tabular-nums text-emerald-950">
                              {destRowTotalPacks > 0 ? (
                                unitMode === 'boxes' ? (
                                  <span>
                                    {destRowTotalBoxes}箱 <small>({destRowTotalPacks}P)</small>
                                  </span>
                                ) : (
                                  <span>
                                    {destRowTotalPacks}P <small>({destRowTotalBoxes}箱)</small>
                                  </span>
                                )
                              ) : (
                                '—'
                              )}
                            </td>
                          </tr>
                        )
                      })}
                  </Fragment>
                )
              })
            )}
          </tbody>
          {/* 日別合計行（フッター） */}
          <tfoot>
            <tr className="border-t-2 border-line bg-bg-soft/80 font-semibold">
              <th className="sticky left-0 z-10 border border-line bg-bg-soft px-3 py-2 text-left font-black text-ink">
                日別合計
              </th>
              {dates.map((d) => {
                const dayPacks = dateTotals.packs[d] ?? 0
                const dayBoxes = dateTotals.boxes[d] ?? 0
                return (
                  <td key={d} className="num border border-line px-2 py-2 text-center font-bold tabular-nums text-trust-800">
                    {dayPacks > 0 ? (
                      unitMode === 'boxes' ? (
                        <div>
                          <span className="block text-sm sm:text-base font-black text-forest-900">
                            {dayBoxes}箱
                          </span>
                          <span className="block text-[10px] font-bold text-ink-soft">
                            ({dayPacks.toLocaleString()}P)
                          </span>
                        </div>
                      ) : (
                        <div>
                          <span className="block text-sm sm:text-base font-black">
                            {dayPacks.toLocaleString()}P
                          </span>
                          <span className="block text-[10px] font-bold text-ink-soft">
                            ({dayBoxes}箱)
                          </span>
                        </div>
                      )
                    ) : (
                      '—'
                    )}
                  </td>
                )
              })}
              <td className="num border border-line bg-trust-100/60 px-2 py-2 text-center font-black tabular-nums text-trust-900">
                {grandTotalPacks > 0 ? (
                  unitMode === 'boxes' ? (
                    <div>
                      <span className="block text-base font-black text-forest-950">{grandTotalBoxes}箱</span>
                      <span className="block text-[10px] font-bold text-ink-soft">
                        ({grandTotalPacks.toLocaleString()}P)
                      </span>
                    </div>
                  ) : (
                    <div>
                      <span className="block text-base font-black">{grandTotalPacks.toLocaleString()}P</span>
                      <span className="block text-[10px] font-bold text-ink-soft">
                        ({grandTotalBoxes}箱)
                      </span>
                    </div>
                  )
                ) : (
                  '—'
                )}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {focused && (
        <QuantityPreviewBar
          raw={
            focused.destId
              ? (destValues[destKey(focused.customerId, focused.destId, focused.date)] ?? '')
              : (values[key(focused.customerId, focused.date)] ?? '')
          }
          packsPerCase={getCustomerPpc(focused.customerId)}
          unit={productUnit}
        />
      )}
    </div>
  )
}

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
    return null
  }
  if (result.type === 'delete') return null

  const totalNum = result.total.toNumber()
  const ppc = packsPerCase && packsPerCase > 0 ? packsPerCase : 20
  const boxes = Math.floor(totalNum / ppc)
  const rem = totalNum % ppc

  return (
    <p className="num flex items-center gap-2 rounded-xl border border-forest-300 bg-forest-50 px-3.5 py-2 text-xs font-bold text-forest-900">
      <span>📦 入力プレビュー:</span>
      <span className="text-sm font-black">
        {boxes}箱{rem > 0 ? `＋端数${rem}${unit}` : ''}（計 {totalNum.toLocaleString()} {unit} ／ 1箱{ppc}入）
      </span>
      <span className="text-ink-muted ml-auto hidden sm:inline">
        ※「30c」で30箱分、またはパック数を直接入力できます
      </span>
    </p>
  )
}
