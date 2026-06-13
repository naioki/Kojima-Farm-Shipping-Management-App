import { NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { InvoicePdf } from '@/lib/pdf/InvoicePdf'
import { registerPdfFonts } from '@/lib/pdf/fonts'
import { getSetting } from '@/lib/settings'

export const runtime = 'nodejs'

/** 請求書PDF（@react-pdf）。発行者情報は設定（FARM_*）から差し込む。inline 表示＋ファイル名付与。 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const supabase = createClient()
  const { data: invoice, error } = await supabase.from('invoices').select('*').eq('id', params.id).maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!invoice) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const [{ data: items }, { data: customer }, name, reg, address, tel, payment, fontUrl] = await Promise.all([
    supabase
      .from('invoice_items')
      .select('product_name, quantity, unit, unit_price, tax_rate, subtotal')
      .eq('invoice_id', params.id),
    supabase.from('customers').select('name').eq('id', invoice.customer_id).maybeSingle(),
    getSetting('FARM_NAME'),
    getSetting('FARM_INVOICE_REG_NUM'),
    getSetting('FARM_ADDRESS'),
    getSetting('FARM_TEL'),
    getSetting('FARM_PAYMENT_INFO'),
    getSetting('PDF_FONT_URL'),
  ])

  registerPdfFonts(fontUrl)
  const buffer = await renderToBuffer(
    <InvoicePdf
      invoice={invoice}
      customerName={customer?.name ?? '—'}
      issuer={{ name: name ?? '小島農園', reg, address, tel, payment }}
      items={items ?? []}
    />,
  )

  return new Response(new Uint8Array(buffer), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="${invoice.invoice_number}.pdf"`,
    },
  })
}
