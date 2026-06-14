import Link from 'next/link'
import { ChevronLeft, FileDown } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { PrintButton } from '@/components/admin/PrintButton'
import { DeliveryNoteDocument } from '@/components/admin/DeliveryNoteDocument'
import { DeliveryNoteIssueButton } from '@/components/admin/DeliveryNoteIssueButton'
import { getSetting } from '@/lib/settings'
import { sumInvoiceTotals, type TaxRate } from '@/lib/calculations/tax'
import { DELIVERY_AMOUNT_MODES, parseAmountMode } from '@/lib/delivery-notes/amount-mode'

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

  const t = sumInvoiceTotals(
    items.map((it) => ({ quantity: it.quantity, unitPrice: it.unit_price, taxRate: it.tax_rate as TaxRate })),
  )
  const totals = {
    subtotal8: t.reduced.subtotal.toNumber(),
    subtotal10: t.standard.subtotal.toNumber(),
    total: t.total.toNumber(),
  }

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
          {items.length > 0 && <DeliveryNoteIssueButton customerId={customerId} date={date} mode={mode} />}
        </div>
      </div>

      {items.length === 0 ? (
        <EmptyState
          title="この日の明細がありません"
          description="出荷一覧やマトリックスで明細を追加すると、ここに納品書が表示されます。"
        />
      ) : (
        <>
          <p className="text-sm text-ink-soft print:hidden">
            プレビューです。「発行して保存」を押すと、この内容で履歴に残り、後から再印刷・確認できます。
          </p>
          <DeliveryNoteDocument
            customerName={customer?.name ?? '—'}
            date={date}
            issuer={{ name: farmName, address: farmAddr, tel: farmTel }}
            items={items}
            totals={totals}
            mode={mode}
          />
        </>
      )}
    </div>
  )
}
