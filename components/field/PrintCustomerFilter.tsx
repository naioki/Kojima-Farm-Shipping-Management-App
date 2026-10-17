'use client'

import { useMemo, useState } from 'react'
import { FileText, Tags } from 'lucide-react'
import { QueuePrintButton } from '@/components/field/QueuePrintButton'
import { cn } from '@/lib/cn'

/**
 * 帳票印刷の「取引先しぼり込み」（Issue#7）。
 * その日付に出荷がある取引先だけをチェックボックスで列挙し、選んだ取引先の
 * 出荷表・ラベルだけを印刷する。既定は全選択＝全件で、現行挙動と後方互換。
 * タップターゲットは 48px（現場・手袋前提／design.md）。
 */
export function PrintCustomerFilter({
  date,
  customers,
}: {
  date: string
  /** その日付に出荷がある取引先（取引先＞納入先ルール上の「取引先」単位）。 */
  customers: { id: string; name: string }[]
}) {
  // 既定は全選択（現行挙動と互換）。Set で選択状態を保持。
  const [selected, setSelected] = useState<Set<string>>(() => new Set(customers.map((c) => c.id)))

  const allSelected = selected.size === customers.length
  const noneSelected = selected.size === 0
  // 全選択時は絞り込みなし（＝全件）。それ以外は選んだ取引先のみを渡す。
  const selectedIds = useMemo(
    () => (allSelected ? [] : customers.filter((c) => selected.has(c.id)).map((c) => c.id)),
    [allSelected, customers, selected],
  )

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const query = selectedIds.length ? `&customer_ids=${selectedIds.join(',')}` : ''
  const sheetHref = `/api/shipping-docs/sheet?date=${date}${query}`
  const labelsHref = `/api/shipping-docs/labels?date=${date}${query}`

  const bigBtn =
    'flex min-h-[96px] flex-1 flex-col items-center justify-center gap-2 rounded-xl border-2 border-earth-200 bg-bg-card p-4 text-center hover:bg-earth-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-trust-100'
  const bigBtnDisabled = 'pointer-events-none cursor-not-allowed opacity-50'

  return (
    <div className="space-y-4">
      {/* 取引先しぼり込み */}
      <div className="rounded-xl border border-line bg-bg-card p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-base font-bold text-ink">取引先を えらぶ</h2>
          <div className="flex items-center gap-2">
            <span className="text-xs text-ink-soft" aria-live="polite">
              {selected.size}/{customers.length}社
            </span>
            <button
              type="button"
              onClick={() => setSelected(new Set(customers.map((c) => c.id)))}
              className="min-h-[48px] rounded border border-line px-3 text-sm text-ink-soft hover:bg-bg-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-trust-100"
            >
              全部
            </button>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="min-h-[48px] rounded border border-line px-3 text-sm text-ink-soft hover:bg-bg-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-trust-100"
            >
              解除
            </button>
          </div>
        </div>
        <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
          {customers.map((c) => {
            const checked = selected.has(c.id)
            return (
              <li key={c.id}>
                <label
                  className={cn(
                    'flex min-h-[48px] cursor-pointer items-center gap-3 rounded-lg border px-3 py-2',
                    checked ? 'border-earth-300 bg-earth-50' : 'border-line bg-bg-card hover:bg-bg-soft',
                  )}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(c.id)}
                    className="h-5 w-5 accent-earth-500"
                  />
                  <span className="text-sm font-medium text-ink">{c.name}</span>
                </label>
              </li>
            )
          })}
        </ul>
      </div>

      {noneSelected && (
        <p className="rounded-lg border border-line bg-bg-soft px-3 py-2 text-sm text-ink-soft">
          取引先を 1社いじょう えらぶと 印刷できます。
        </p>
      )}

      {/* 主動線: 大ボタン2つ（選んだ取引先の全品目） */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <a
          href={noneSelected ? undefined : sheetHref}
          target="_blank"
          rel="noopener"
          aria-disabled={noneSelected}
          tabIndex={noneSelected ? -1 : undefined}
          className={cn(bigBtn, noneSelected && bigBtnDisabled)}
        >
          <FileText className="h-8 w-8 text-earth-500" aria-hidden />
          <span className="text-lg font-bold text-ink">出荷表を 印刷</span>
          <span className="text-xs text-ink-soft">コンテナに はる 紙（1枚ずつ）</span>
        </a>
        <a
          href={noneSelected ? undefined : labelsHref}
          target="_blank"
          rel="noopener"
          aria-disabled={noneSelected}
          tabIndex={noneSelected ? -1 : undefined}
          className={cn(bigBtn, noneSelected && bigBtnDisabled)}
        >
          <Tags className="h-8 w-8 text-earth-500" aria-hidden />
          <span className="text-lg font-bold text-ink">ラベルを 印刷</span>
          <span className="text-xs text-ink-soft">8分割ラベル ＋ 出荷一覧表</span>
        </a>
      </div>

      {/* 事務所の常駐プリンタへ自動印刷（print_jobs キュー・統合2D） */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-ink-soft">その場で開かずに印刷:</span>
        <QueuePrintButton
          date={date}
          docType="sheet"
          customerIds={selectedIds}
          disabled={noneSelected}
          label="出荷表を事務所で自動印刷"
        />
        <QueuePrintButton
          date={date}
          docType="labels"
          customerIds={selectedIds}
          disabled={noneSelected}
          label="ラベルを事務所で自動印刷"
        />
      </div>
    </div>
  )
}
