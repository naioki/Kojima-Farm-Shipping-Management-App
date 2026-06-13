import Link from 'next/link'
import { ChevronLeft, FileDown } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { PrintButton } from '@/components/admin/PrintButton'
import { getSetting } from '@/lib/settings'
import { sumInvoiceTotals, formatYen, type TaxRate } from '@/lib/calculations/tax'
import {
  DELIVERY_AMOUNT_MODES,
  parseAmountMode,
  amountVisibility,
} from '@/lib/delivery-notes/amount-mode'

export const dynamic = 'force-dynamic'

/**
 * 納品書 印刷ビュー（取引先×納品日）。その日の明細から1枚にまとめる。
 * 金額の正は請求書（invoices）。納品書は「金額あり／後から手書き／金額なし」を切替可能。
 */
export default async function DeliveryNoteView({
  searchParams,
}: {
  searchParams: { customer?: string; date?: string; amount?: string }
}) {
  const customerId = searchParams.customer ?? ''
  const date = searchParams.date ?? ''
  if (!/^[0-9a-f-]{36}$/i.test(customerId) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return <ErrorState title="パラメータが不正です" message="取引先と納品日を指定してください。" />
  }

  const supabase = createClient()

  const { data: customer, error: custErr } = await supabase
    .from('customers')
    .select('name')
    .eq('id', customerId)
    .maybeSingle()
  if (custErr) return <ErrorState message={custErr.message} />

  const { data: orders } = await supabase
    .from('orders')
    .select('id')
    .eq('customer_id', customerId)
    .eq('delivery_date', date)
  const orderIds = (orders ?? []).map((o) => o.id)

  const items = orderIds.length
    ? (
        await supabase
          .from('order_items')
          .select('product_name, quantity, unit, unit_price, tax_rate, subtotal')
          .in('order_id', orderIds)
          .order('product_name')
      ).data ?? []
    : []

  const [farmName, farmAddr, farmTel, amountDefault] = await Promise.all([
    getSetting('FARM_NAME'),
    getSetting('FARM_ADDRESS'),
    getSetting('FARM_TEL'),
    getSetting('DELIVERY_NOTE_AMOUNT_MODE'),
  ])

  // 金額表示モード（クエリ優先・無ければ設定の既定）
  const mode = parseAmountMode(searchParams.amount, parseAmountMode(amountDefault))
  const v = amountVisibility(mode)

  const totals = sumInvoiceTotals(
    items.map((it) => ({ quantity: it.quantity, unitPrice: it.unit_price, taxRate: it.tax_rate as TaxRate })),
  )

  const baseQs = `customer=${customerId}&date=${date}`

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href="/admin/delivery-notes" className="inline-flex items-center gap-1 text-sm text-trust-600 hover:underline">
          <ChevronLeft className="h-4 w-4" aria-hidden />
          納品書
        </Link>
        <div className="flex items-center gap-2">
          {/* 金額表示の切替（その場で再表示。PDFリンクも追従） */}
          <div className="inline-flex rounded-lg border border-line-strong p-0.5">
            {DELIVERY_AMOUNT_MODES.map((m) => (
              <Link
                key={m.value}
                href={`/admin/delivery-notes/view?${baseQs}&amount=${m.value}`}
                title={m.hint}
                className={
                  m.value === mode
                    ? 'rounded-md bg-earth-600 px-3 py-1 text-xs font-medium text-white'
                    : 'rounded-md px-3 py-1 text-xs font-medium text-ink-soft hover:bg-bg-soft'
                }
              >
                {m.label}
              </Link>
            ))}
          </div>
          {items.length > 0 && (
            <a
              href={`/api/delivery-notes/pdf?${baseQs}&amount=${mode}`}
              target="_blank"
              rel="noopener"
              className="inline-flex h-8 items-center gap-1.5 rounded border border-line-strong bg-bg-card px-3 text-sm font-medium text-earth-700 hover:bg-earth-50"
            >
              <FileDown className="h-4 w-4" aria-hidden />
              PDF
            </a>
          )}
          <PrintButton />
        </div>
      </div>

      {items.length === 0 ? (
        <EmptyState
          title="この日の明細がありません"
          description="出荷一覧やマトリックスで明細を追加すると、ここに納品書が表示されます。"
        />
      ) : (
        <article className="space-y-6 rounded-lg border border-line bg-bg-card p-8 print:border-0 print:p-0">
          <header className="flex items-start justify-between">
            <h1 className="font-display text-2xl font-bold text-ink">納品書</h1>
            <div className="text-right text-sm text-ink-soft">
              <p>納品日: <span className="num">{date}</span></p>
            </div>
          </header>

          <div className="flex items-end justify-between gap-6">
            <p className="border-b border-ink pb-1 text-lg font-bold text-ink">{customer?.name ?? '—'} 御中</p>
            <div className="text-right text-sm text-ink-soft">
              <p className="font-bold text-ink">{farmName ?? '小島農園'}</p>
              {farmAddr && <p>{farmAddr}</p>}
              {farmTel && <p>TEL: {farmTel}</p>}
            </div>
          </div>

          <p className="text-sm text-ink-soft">下記のとおり納品いたしました。</p>

          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-line-strong text-left text-ink-soft">
                <th className="py-2 font-medium">品目</th>
                <th className="num py-2 text-right font-medium">数量</th>
                {v.showAmountCols && <th className="num py-2 text-right font-medium">単価</th>}
                {v.showAmountCols && <th className="num py-2 text-right font-medium">金額(税抜)</th>}
                {v.showTaxCol && <th className="py-2 text-center font-medium">税率</th>}
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={i} className="border-b border-line">
                  <td className="py-1.5 text-ink">{it.product_name}</td>
                  <td className="num py-1.5 text-right tabular-nums text-ink">
                    {it.quantity}
                    <span className="ml-0.5 text-xs text-ink-faint">{it.unit}</span>
                  </td>
                  {v.showAmountCols && (
                    <td className="num py-1.5 text-right tabular-nums text-ink-soft">
                      {v.fillAmounts ? formatYen(it.unit_price) : ''}
                    </td>
                  )}
                  {v.showAmountCols && (
                    <td className="num py-1.5 text-right tabular-nums text-ink">
                      {v.fillAmounts ? formatYen(it.subtotal) : ''}
                    </td>
                  )}
                  {v.showTaxCol && (
                    <td className="py-1.5 text-center text-ink-soft">
                      {it.tax_rate}%{it.tax_rate === 8 ? ' ※' : ''}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>

          {v.showTotals && (
            <div className="ml-auto w-full max-w-xs space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-ink-soft">8%対象 税抜</span>
                <span className="num tabular-nums text-ink">{v.fillTotals ? formatYen(totals.reduced.subtotal) : ''}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-soft">10%対象 税抜</span>
                <span className="num tabular-nums text-ink">{v.fillTotals ? formatYen(totals.standard.subtotal) : ''}</span>
              </div>
              <div className="mt-1 flex justify-between border-t border-ink pt-1">
                <span className="font-bold text-ink">合計（税込）</span>
                <span className="num text-lg font-bold tabular-nums text-ink">
                  {v.fillTotals ? formatYen(totals.total) : ''}
                </span>
              </div>
            </div>
          )}

          {v.showTaxCol && <p className="text-xs text-ink-faint">※ は軽減税率（8%）対象品目です。</p>}
          {mode === 'none' && (
            <p className="text-xs text-ink-faint">※ 金額は別途、請求書にてご案内いたします。</p>
          )}
        </article>
      )}
    </div>
  )
}
