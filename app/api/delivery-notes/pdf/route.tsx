import { NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { DeliveryNotePdf } from '@/lib/pdf/DeliveryNotePdf'
import { registerPdfFonts } from '@/lib/pdf/fonts'
import { getSetting } from '@/lib/settings'
import { sumInvoiceTotals, type TaxRate } from '@/lib/calculations/tax'

export const runtime = 'nodejs'

/** 納品書PDF（@react-pdf）。取引先×納品日の明細から生成。 */
export async function GET(req: Request) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const customerId = searchParams.get('customer') ?? ''
  const date = searchParams.get('date') ?? ''
  if (!/^[0-9a-f-]{36}$/i.test(customerId) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'invalid_params' }, { status: 400 })
  }

  const supabase = createClient()
  const { data: customer } = await supabase.from('customers').select('name').eq('id', customerId).maybeSingle()

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

  const [name, address, tel, fontUrl] = await Promise.all([
    getSetting('FARM_NAME'),
    getSetting('FARM_ADDRESS'),
    getSetting('FARM_TEL'),
    getSetting('PDF_FONT_URL'),
  ])

  const t = sumInvoiceTotals(
    items.map((it) => ({ quantity: it.quantity, unitPrice: it.unit_price, taxRate: it.tax_rate as TaxRate })),
  )

  registerPdfFonts(fontUrl)
  const buffer = await renderToBuffer(
    <DeliveryNotePdf
      customerName={customer?.name ?? '—'}
      date={date}
      issuer={{ name: name ?? '小島農園', address, tel }}
      items={items}
      totals={{ subtotal8: t.reduced.subtotal.toNumber(), subtotal10: t.standard.subtotal.toNumber(), total: t.total.toNumber() }}
    />,
  )

  return new Response(new Uint8Array(buffer), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="delivery_${date}.pdf"`,
    },
  })
}
