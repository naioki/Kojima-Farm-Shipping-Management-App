import { NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { DeliveryNotePdf } from '@/lib/pdf/DeliveryNotePdf'
import { registerPdfFonts } from '@/lib/pdf/fonts'
import { getSetting } from '@/lib/settings'
import { sumInvoiceTotals, type TaxRate } from '@/lib/calculations/tax'
import { parseAmountMode } from '@/lib/delivery-notes/amount-mode'
import { parseDocType } from '@/lib/delivery-notes/doc-type'

export const runtime = 'nodejs'

/** 納品書 / ご注文確認書 PDF（@react-pdf）。取引先×納品日の明細から生成。 */
export async function GET(req: Request) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const customerId = searchParams.get('customer') ?? ''
  const date = searchParams.get('date') ?? ''
  const destinationId = searchParams.get('destination') ?? ''
  if (!/^[0-9a-f-]{36}$/i.test(customerId) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'invalid_params' }, { status: 400 })
  }

  const supabase = createClient()
  const { data: customer, error: customerErr } = await supabase.from('customers').select('name').eq('id', customerId).maybeSingle()
  // 取引先名は見出しの補助。取得失敗しても '—' で続行。無言にはしない。
  if (customerErr) console.error('[api/delivery-notes/pdf] 取引先名の取得に失敗:', customerErr.message)

  // 納入先で絞り込み中は、画面プレビューと同じ「取引先＞納入先」をPDF見出しにも使う。
  let customerName = customer?.name ?? '—'
  if (destinationId) {
    const { data: dest, error: destErr } = await supabase
      .from('delivery_destinations')
      .select('code, full_name')
      .eq('id', destinationId)
      .maybeSingle()
    if (destErr) console.error('[api/delivery-notes/pdf] 納入先名の取得に失敗:', destErr.message)
    if (dest) customerName = `${customerName}＞${dest.code || dest.full_name}`
  }

  let ordersQuery = supabase.from('orders').select('id').eq('customer_id', customerId).eq('delivery_date', date)
  if (destinationId) ordersQuery = ordersQuery.eq('destination_id', destinationId)
  const { data: orders, error: ordersErr } = await ordersQuery
  // 対象注文・明細は帳票本体。取得失敗を「空の納品書PDF」に化けさせない。
  if (ordersErr) return NextResponse.json({ error: `対象注文の取得に失敗しました: ${ordersErr.message}` }, { status: 500 })
  const orderIds = (orders ?? []).map((o) => o.id)
  const itemsRes = orderIds.length
    ? await supabase
        .from('order_items')
        .select('product_name, quantity, unit, unit_price, tax_rate, subtotal')
        .in('order_id', orderIds)
        .order('product_name')
    : { data: [] as { product_name: string; quantity: number; unit: string; unit_price: number | null; tax_rate: number; subtotal: number | null }[], error: null }
  if (itemsRes.error) return NextResponse.json({ error: `明細の取得に失敗しました: ${itemsRes.error.message}` }, { status: 500 })
  const items = itemsRes.data ?? []

  const [name, address, tel, fontUrl, amountDefault] = await Promise.all([
    getSetting('FARM_NAME'),
    getSetting('FARM_ADDRESS'),
    getSetting('FARM_TEL'),
    getSetting('PDF_FONT_URL'),
    getSetting('DELIVERY_NOTE_AMOUNT_MODE'),
  ])

  const mode = parseAmountMode(searchParams.get('amount'), parseAmountMode(amountDefault))
  const docType = parseDocType(searchParams.get('type'))

  const t = sumInvoiceTotals(
    items.map((it) => ({ quantity: it.quantity, unitPrice: it.unit_price, taxRate: it.tax_rate as TaxRate })),
  )

  registerPdfFonts(fontUrl)
  const buffer = await renderToBuffer(
    <DeliveryNotePdf
      customerName={customerName}
      date={date}
      mode={mode}
      docType={docType}
      issuer={{ name: name ?? '小島農園', address, tel }}
      items={items}
      totals={{ subtotal8: t.reduced.subtotal.toNumber(), subtotal10: t.standard.subtotal.toNumber(), total: t.total.toNumber() }}
    />,
  )

  const fileBase = docType === 'delivery' ? 'delivery' : 'order_confirmation'
  return new Response(new Uint8Array(buffer), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="${fileBase}_${date}.pdf"`,
    },
  })
}
