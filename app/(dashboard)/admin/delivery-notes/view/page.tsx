import Link from 'next/link'
import { ChevronLeft, FileDown, Building2, Columns2 } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { PrintButton } from '@/components/admin/PrintButton'
import { DeliveryNoteDocument } from '@/components/admin/DeliveryNoteDocument'
import { DeliveryNoteIssueButton } from '@/components/admin/DeliveryNoteIssueButton'
import { getSetting } from '@/lib/settings'
import { sumInvoiceTotals, type TaxRate } from '@/lib/calculations/tax'
import { DELIVERY_AMOUNT_MODES, parseAmountMode } from '@/lib/delivery-notes/amount-mode'
import { DELIVERY_DOC_TYPES, parseDocType } from '@/lib/delivery-notes/doc-type'
import {
  resolveDefaultIssuerPreset,
  resolveIssuerCompanyName,
  resolvePrintedDeliveryDate,
  isDriverDeliveryNoteCustomer,
  type DeliveryNoteIssuerPreset,
} from '@/lib/delivery-notes/driver-note'
import { shiftDateStr } from '@/lib/dates'
import { requireAdmin } from '@/lib/auth/require-admin'

export const dynamic = 'force-dynamic'

/**
 * 納品書 / ご注文確認書 の印刷ビュー（取引先×納品日）。その日の明細から1枚にまとめる。
 * 金額の正は請求書（invoices）。金額表示（あり／後から手書き／なし）と書面の種類を切替可能。
 * さらに運転手渡し用（勘兵衛・オレンジファーム等）に「発行元名義（小島農園 / 株式会社アイプラス）」
 * および「用紙レイアウト（A4上下2連(納品書＋控) / A4全面1枚）」の1タップ切替に対応。
 */
export default async function DeliveryNoteView({
  searchParams,
}: {
  searchParams: {
    customer?: string
    date?: string
    amount?: string
    type?: string
    destination?: string
    issuer?: string
    layout?: string
  }
}) {
  const guard = await requireAdmin('納品書は管理者のみです。')
  if (guard) return guard

  const customerId = searchParams.customer ?? ''
  const date = searchParams.date ?? ''
  if (!/^[0-9a-f-]{36}$/i.test(customerId) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return <ErrorState title="パラメータが不正です" message="取引先と納品日を指定してください。" />
  }

  const supabase = createAdminClient()

  const { data: customer, error: custErr } = await supabase
    .from('customers')
    .select('name')
    .eq('id', customerId)
    .maybeSingle()
  if (custErr) return <ErrorState message="取引先を読み込めませんでした。時間をおいて再度お試しください。" detail={custErr.message} />

  // その日・その取引先の全注文（納入先ごとに混在していないか確認するため destination_id も取得）。
  const { data: rawOrders, error: ordersErr } = await supabase
    .from('orders')
    .select('id, destination_id, delivery_date')
    .eq('customer_id', customerId)
    .eq('delivery_date', date)
    .in('status', ['approved', 'shipped', 'invoiced'])
  if (ordersErr) return <ErrorState message="納品書の対象注文を読み込めませんでした。時間をおいて再度お試しください。" detail={ordersErr.message} />

  let allOrders = rawOrders ?? []
  let effectiveOrderDate = date
  // オレンジファームで FAX着日（木・土）が指定された場合、前日の水・金出荷分をフォールバック検索
  if (allOrders.length === 0 && (customer?.name ?? '').includes('オレンジファーム')) {
    const prevDate = shiftDateStr(date, -1)
    const { data: prevOrders } = await supabase
      .from('orders')
      .select('id, destination_id, delivery_date')
      .eq('customer_id', customerId)
      .eq('delivery_date', prevDate)
      .in('status', ['approved', 'shipped', 'invoiced'])
    if (prevOrders && prevOrders.length > 0) {
      allOrders = prevOrders
      effectiveOrderDate = prevDate
    }
  }

  const distinctDestIds = [...new Set(allOrders.map((o) => o.destination_id).filter(Boolean))] as string[]
  const { data: destRows, error: destErr } = distinctDestIds.length
    ? await supabase.from('delivery_destinations').select('id, code, full_name').in('id', distinctDestIds)
    : { data: [] as { id: string; code: string | null; full_name: string }[], error: null }
  if (destErr) console.error('[delivery-notes/view] 納入先名の解決に失敗:', destErr.message)
  const destLabel = new Map((destRows ?? []).map((d) => [d.id, d.code || d.full_name]))

  // 納入先を1つに絞り込み中なら、その納入先の注文だけを対象にする（表示は常に「取引先＞納入先」）。
  const destinationId = searchParams.destination ?? ''
  const orders = destinationId ? allOrders.filter((o) => o.destination_id === destinationId) : allOrders
  const orderIds = orders.map((o) => o.id)
  const documentCustomerName = destinationId && destLabel.has(destinationId)
    ? `${customer?.name ?? '—'}＞${destLabel.get(destinationId)}`
    : customer?.name ?? '—'

  const itemsRes = orderIds.length
    ? await supabase
        .from('order_items')
        .select('product_name, quantity, shipped_qty, billable_qty, unit, unit_price, tax_rate, subtotal, spec, line_note')
        .in('order_id', orderIds)
        .order('product_name')
    : {
        data: [] as {
          product_name: string
          quantity: number
          shipped_qty?: number | null
          billable_qty?: number | null
          unit: string
          unit_price: number
          tax_rate: number
          subtotal: number
          spec?: string | null
          line_note?: string | null
        }[],
        error: null,
      }
  if (itemsRes.error) return <ErrorState message="納品書の明細を読み込めませんでした。時間をおいて再度お試しください。" detail={itemsRes.error.message} />
  const items = (itemsRes.data ?? [])
    .map((it) => {
      const effQty = Number(it.billable_qty ?? it.shipped_qty ?? it.quantity) || 0
      return {
        ...it,
        quantity: effQty,
        subtotal: it.unit_price != null ? effQty * Number(it.unit_price) : it.subtotal,
      }
    })
    .filter((it) => it.quantity > 0)

  const [farmName, farmAddr, farmTel, amountDefault] = await Promise.all([
    getSetting('FARM_NAME'),
    getSetting('FARM_ADDRESS'),
    getSetting('FARM_TEL'),
    getSetting('DELIVERY_NOTE_AMOUNT_MODE'),
  ])

  const isDriverTarget = isDriverDeliveryNoteCustomer(customer?.name)
  // 金額表示モード（クエリ優先・無ければ運転手渡し対象は 'none'、それ以外は設定の既定）
  const fallbackMode = isDriverTarget ? 'none' : parseAmountMode(amountDefault)
  const mode = parseAmountMode(searchParams.amount, fallbackMode)
  // 書面の種類（納品書 / ご注文確認書）
  const docType = parseDocType(searchParams.type)
  // 発行元名義（クエリ優先・無ければ取引先別既定：勘兵衛＝株式会社アイプラス、オレンジファーム＝小島農園）
  const issuerPreset: DeliveryNoteIssuerPreset =
    searchParams.issuer === 'iplus' || searchParams.issuer === 'kojima'
      ? searchParams.issuer
      : resolveDefaultIssuerPreset(customer?.name)
  const issuerName = resolveIssuerCompanyName(issuerPreset, farmName)

  // 用紙レイアウト（既定は A4上下2連＝納品書＋納品書控）
  const layout: '2up' | 'full' = searchParams.layout === 'full' ? 'full' : '2up'

  // 印字納品日の解決（オレンジファームは単一のFAX着日を印字）
  const allLineNotes = items.map((it) => it.line_note)
  const printedDate = resolvePrintedDeliveryDate(customer?.name, effectiveOrderDate, allLineNotes)

  const t = sumInvoiceTotals(
    items.map((it) => ({ quantity: it.quantity, unitPrice: it.unit_price, taxRate: it.tax_rate as TaxRate })),
  )
  const totals = {
    subtotal8: t.reduced.subtotal.toNumber(),
    subtotal10: t.standard.subtotal.toNumber(),
    total: t.total.toNumber(),
  }

  const baseQs = `customer=${customerId}&date=${date}${destinationId ? `&destination=${destinationId}` : ''}`
  const buildViewUrl = (overrides: {
    amount?: string
    type?: string
    issuer?: DeliveryNoteIssuerPreset
    layout?: '2up' | 'full'
  }) => {
    const a = overrides.amount ?? mode
    const tp = overrides.type ?? docType
    const is = overrides.issuer ?? issuerPreset
    const ly = overrides.layout ?? layout
    return `/admin/delivery-notes/view?${baseQs}&amount=${a}&type=${tp}&issuer=${is}&layout=${ly}`
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href="/admin/delivery-notes" className="inline-flex items-center gap-1 text-sm text-trust-600 hover:underline">
          <ChevronLeft className="h-4 w-4" aria-hidden />
          納品書一覧へ
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          {/* 発行元名義の1タップ切替（小島農園 ⇔ 株式会社アイプラス） */}
          <div className="inline-flex items-center rounded-lg border border-line-strong bg-white p-0.5 shadow-2xs" title="発行元の会社名を切り替えます">
            <span className="px-2 text-[11px] font-bold text-ink-faint flex items-center gap-1">
              <Building2 className="h-3 w-3" />
              名義
            </span>
            {([
              { value: 'kojima' as const, label: '小島農園' },
              { value: 'iplus' as const, label: '株式会社アイプラス' },
            ]).map((opt) => (
              <Link
                key={opt.value}
                href={buildViewUrl({ issuer: opt.value })}
                className={
                  opt.value === issuerPreset
                    ? 'rounded-md bg-emerald-700 px-2.5 py-1 text-xs font-bold text-white'
                    : 'rounded-md px-2.5 py-1 text-xs font-medium text-ink-soft hover:bg-bg-soft'
                }
              >
                {opt.label}
              </Link>
            ))}
          </div>

          {/* 用紙レイアウトの切替（A4上下2連［納品書＋控］ ⇔ A4全面1枚） */}
          <div className="inline-flex items-center rounded-lg border border-line-strong bg-white p-0.5 shadow-2xs" title="用紙レイアウトを切り替えます">
            <span className="px-2 text-[11px] font-bold text-ink-faint flex items-center gap-1">
              <Columns2 className="h-3 w-3" />
              用紙
            </span>
            {([
              { value: '2up' as const, label: 'A4上下2連(納品書＋控)' },
              { value: 'full' as const, label: 'A4全面1枚' },
            ]).map((opt) => (
              <Link
                key={opt.value}
                href={buildViewUrl({ layout: opt.value })}
                className={
                  opt.value === layout
                    ? 'rounded-md bg-trust-600 px-2.5 py-1 text-xs font-bold text-white'
                    : 'rounded-md px-2.5 py-1 text-xs font-medium text-ink-soft hover:bg-bg-soft'
                }
              >
                {opt.label}
              </Link>
            ))}
          </div>

          {/* 書面の種類の切替（納品書 / ご注文確認書） */}
          <div className="inline-flex rounded-lg border border-line-strong bg-white p-0.5">
            {DELIVERY_DOC_TYPES.map((d) => (
              <Link
                key={d.value}
                href={buildViewUrl({ type: d.value })}
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

          {/* 金額表示の切替 */}
          <div className="inline-flex rounded-lg border border-line-strong bg-white p-0.5">
            {DELIVERY_AMOUNT_MODES.map((m) => (
              <Link
                key={m.value}
                href={buildViewUrl({ amount: m.value })}
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
              href={`/api/delivery-notes/pdf?${baseQs}&amount=${mode}&type=${docType}&issuer=${issuerPreset}&layout=${layout}`}
              target="_blank"
              rel="noopener"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-emerald-600 bg-emerald-700 px-3 text-xs font-bold text-white hover:bg-emerald-800 shadow-2xs"
            >
              <FileDown className="h-4 w-4" aria-hidden />
              A4 PDFを開く
            </a>
          )}
          <PrintButton />
          {/* 履歴保存（発行）は納品書のみ。ご注文確認書はオンデマンド印刷／PDF。 */}
          {items.length > 0 && docType === 'delivery' && (
            <DeliveryNoteIssueButton customerId={customerId} date={effectiveOrderDate} mode={mode} destinationId={destinationId || undefined} />
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
                href={`/admin/delivery-notes/view?customer=${customerId}&date=${date}&amount=${mode}&type=${docType}&issuer=${issuerPreset}&layout=${layout}&destination=${id}`}
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
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-200 bg-emerald-50/70 px-3.5 py-2 text-xs text-emerald-950 print:hidden">
            <span>
              📄 <strong>発行名義:</strong> {issuerName} ／ <strong>印字納品日:</strong> {printedDate}
              {printedDate !== effectiveOrderDate && (
                <span className="ml-1 text-emerald-800">（FAX記載の着日で自動印字）</span>
              )}
            </span>
            <span className="text-ink-soft">
              {layout === '2up' ? '✂ A4 1枚に「納品書（上）」と「納品書控（下）」を上下2連で印刷します' : 'A4 1枚で印刷します'}
            </span>
          </div>
          <DeliveryNoteDocument
            customerName={documentCustomerName}
            date={printedDate}
            issuer={{ name: issuerName, address: farmAddr, tel: farmTel }}
            items={items}
            totals={totals}
            mode={mode}
            docType={docType}
            layout={layout}
          />
        </>
      )}
    </div>
  )
}
