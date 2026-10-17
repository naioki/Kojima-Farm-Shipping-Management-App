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
import { DELIVERY_DOC_TYPES, parseDocType, docTypeMeta } from '@/lib/delivery-notes/doc-type'
import { requireAdmin } from '@/lib/auth/require-admin'

export const dynamic = 'force-dynamic'

/**
 * 納品書 / ご注文確認書 の印刷ビュー（取引先×納品日）。その日の明細から1枚にまとめる。
 * 金額の正は請求書（invoices）。金額表示（あり／後から手書き／なし）と書面の種類を切替可能。
 * 履歴保存（発行）は納品書のみ。ご注文確認書はオンデマンド印刷／PDF（運用の手間なし）。
 */
export default async function DeliveryNoteView({
  searchParams,
}: {
  searchParams: { customer?: string; date?: string; amount?: string; type?: string; destination?: string }
}) {
  const guard = await requireAdmin('納品書は管理者のみです。')
  if (guard) return guard

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
  if (custErr) return <ErrorState message="取引先を読み込めませんでした。時間をおいて再度お試しください。" detail={custErr.message} />

  // その日・その取引先の全注文（納入先ごとに混在していないか確認するため destination_id も取得）。
  // 納品書に載る対象なので、取得失敗を「明細なし」に化けさせない（誤った空伝票を防ぐ）。
  const { data: allOrders, error: ordersErr } = await supabase
    .from('orders')
    .select('id, destination_id')
    .eq('customer_id', customerId)
    .eq('delivery_date', date)
  if (ordersErr) return <ErrorState message="納品書の対象注文を読み込めませんでした。時間をおいて再度お試しください。" detail={ordersErr.message} />
  const distinctDestIds = [...new Set((allOrders ?? []).map((o) => o.destination_id).filter(Boolean))] as string[]
  const { data: destRows, error: destErr } = distinctDestIds.length
    ? await supabase.from('delivery_destinations').select('id, code, full_name').in('id', distinctDestIds)
    : { data: [] as { id: string; code: string | null; full_name: string }[], error: null }
  // 納入先の表示名（補助）。失敗しても本体は殺さない。
  if (destErr) console.error('[delivery-notes/view] 納入先名の解決に失敗:', destErr.message)
  const destLabel = new Map((destRows ?? []).map((d) => [d.id, d.code || d.full_name]))

  // 納入先を1つに絞り込み中なら、その納入先の注文だけを対象にする（表示は常に「取引先＞納入先」）。
  const destinationId = searchParams.destination ?? ''
  const orders = destinationId ? (allOrders ?? []).filter((o) => o.destination_id === destinationId) : allOrders
  const orderIds = (orders ?? []).map((o) => o.id)
  const documentCustomerName = destinationId && destLabel.has(destinationId)
    ? `${customer?.name ?? '—'}＞${destLabel.get(destinationId)}`
    : customer?.name ?? '—'

  const itemsRes = orderIds.length
    ? await supabase
        .from('order_items')
        .select('product_name, quantity, unit, unit_price, tax_rate, subtotal')
        .in('order_id', orderIds)
        .order('product_name')
    : { data: [] as { product_name: string; quantity: number; unit: string; unit_price: number; tax_rate: number; subtotal: number }[], error: null }
  // 明細は納品書本体。取得失敗を「明細なし」に化けさせない。
  if (itemsRes.error) return <ErrorState message="納品書の明細を読み込めませんでした。時間をおいて再度お試しください。" detail={itemsRes.error.message} />
  const items = itemsRes.data ?? []

  const [farmName, farmAddr, farmTel, amountDefault] = await Promise.all([
    getSetting('FARM_NAME'),
    getSetting('FARM_ADDRESS'),
    getSetting('FARM_TEL'),
    getSetting('DELIVERY_NOTE_AMOUNT_MODE'),
  ])

  // 金額表示モード（クエリ優先・無ければ設定の既定）
  const mode = parseAmountMode(searchParams.amount, parseAmountMode(amountDefault))
  // 書面の種類（納品書 / ご注文確認書）
  const docType = parseDocType(searchParams.type)

  const t = sumInvoiceTotals(
    items.map((it) => ({ quantity: it.quantity, unitPrice: it.unit_price, taxRate: it.tax_rate as TaxRate })),
  )
  const totals = {
    subtotal8: t.reduced.subtotal.toNumber(),
    subtotal10: t.standard.subtotal.toNumber(),
    total: t.total.toNumber(),
  }

  const baseQs = `customer=${customerId}&date=${date}${destinationId ? `&destination=${destinationId}` : ''}`

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href="/admin/delivery-notes" className="inline-flex items-center gap-1 text-sm text-trust-600 hover:underline">
          <ChevronLeft className="h-4 w-4" aria-hidden />
          納品書
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          {/* 書面の種類の切替（納品書 / ご注文確認書）。金額モードは維持。 */}
          <div className="inline-flex rounded-lg border border-line-strong p-0.5">
            {DELIVERY_DOC_TYPES.map((d) => (
              <Link
                key={d.value}
                href={`/admin/delivery-notes/view?${baseQs}&amount=${mode}&type=${d.value}`}
                className={
                  d.value === docType
                    ? 'rounded-md bg-trust-600 px-3 py-1 text-xs font-medium text-white'
                    : 'rounded-md px-3 py-1 text-xs font-medium text-ink-soft hover:bg-bg-soft'
                }
              >
                {d.label}
              </Link>
            ))}
          </div>
          {/* 金額表示の切替（その場で再表示。PDFリンクも追従）。書面の種類は維持。 */}
          <div className="inline-flex rounded-lg border border-line-strong p-0.5">
            {DELIVERY_AMOUNT_MODES.map((m) => (
              <Link
                key={m.value}
                href={`/admin/delivery-notes/view?${baseQs}&amount=${m.value}&type=${docType}`}
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
              href={`/api/delivery-notes/pdf?${baseQs}&amount=${mode}&type=${docType}`}
              target="_blank"
              rel="noopener"
              className="inline-flex h-8 items-center gap-1.5 rounded border border-line-strong bg-bg-card px-3 text-sm font-medium text-earth-700 hover:bg-earth-50"
            >
              <FileDown className="h-4 w-4" aria-hidden />
              PDF
            </a>
          )}
          <PrintButton />
          {/* 履歴保存（発行）は納品書のみ。ご注文確認書はオンデマンド印刷／PDF。 */}
          {items.length > 0 && docType === 'delivery' && (
            <DeliveryNoteIssueButton customerId={customerId} date={date} mode={mode} destinationId={destinationId || undefined} />
          )}
        </div>
      </div>

      {/* 複数の納入先が同日混在。絞り込まずに発行すると納入先が区別できない伝票になるため、選ばせる。 */}
      {!destinationId && distinctDestIds.length > 1 && (
        <div className="rounded-lg border border-warning/40 bg-warning-bg px-4 py-3 text-sm text-ink-soft print:hidden">
          <p className="font-medium text-warning">
            この日は納入先が複数あります。絞り込まずに発行すると納入先が区別できない伝票になります。
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {distinctDestIds.map((id) => (
              <Link
                key={id}
                href={`/admin/delivery-notes/view?customer=${customerId}&date=${date}&amount=${mode}&type=${docType}&destination=${id}`}
                className="rounded-full border border-line-strong bg-bg-card px-3 py-1 text-xs font-medium text-ink hover:bg-bg-soft"
              >
                ＞{destLabel.get(id)} のみ表示
              </Link>
            ))}
          </div>
        </div>
      )}

      {items.length === 0 ? (
        <EmptyState
          title="この日の明細がありません"
          description="出荷一覧やマトリックスで明細を追加すると、ここに納品書が表示されます。"
        />
      ) : (
        <>
          <p className="text-sm text-ink-soft print:hidden">
            {docType === 'delivery'
              ? 'プレビューです。「発行して保存」を押すと、この内容で履歴に残り、後から再印刷・確認できます。'
              : `${docTypeMeta(docType).title}のプレビューです。印刷／PDFで相手方にお渡しできます（履歴保存はありません）。`}
          </p>
          <DeliveryNoteDocument
            customerName={documentCustomerName}
            date={date}
            issuer={{ name: farmName, address: farmAddr, tel: farmTel }}
            items={items}
            totals={totals}
            mode={mode}
            docType={docType}
          />
        </>
      )}
    </div>
  )
}
