import { NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { requireAdminApi } from '@/lib/auth/api-guard'
import { createAdminClient } from '@/lib/supabase/admin'
import { InvoicePdf } from '@/lib/pdf/InvoicePdf'
import { registerPdfFonts } from '@/lib/pdf/fonts'
import { getSetting } from '@/lib/settings'
import { dueDateOf } from '@/lib/invoices/receivables'
import { paymentScheduleOf } from '@/lib/customers/settings'

export const runtime = 'nodejs'

/** 請求書PDF（@react-pdf）。発行者情報は設定（FARM_*）から差し込む。inline 表示＋ファイル名付与。 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  // 請求は管理者のみ（画面・CSV と同じガード）
  const guard = await requireAdminApi()
  if (!guard.ok) return guard.response

  const supabase = createAdminClient()
  const { data: invoice, error } = await supabase.from('invoices').select('*').eq('id', params.id).maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!invoice) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const [itemsRes, { data: customer }, name, reg, address, tel, payment, fontUrl] = await Promise.all([
    supabase
      .from('invoice_items')
      .select('product_name, quantity, unit, unit_price, tax_rate, subtotal')
      .eq('invoice_id', params.id),
    supabase.from('customers').select('name, channel_identifiers').eq('id', invoice.customer_id).maybeSingle(),
    getSetting('FARM_NAME'),
    getSetting('FARM_INVOICE_REG_NUM'),
    getSetting('FARM_ADDRESS'),
    getSetting('FARM_TEL'),
    getSetting('FARM_PAYMENT_INFO'),
    getSetting('PDF_FONT_URL'),
  ])

  // 明細は請求書本体。取得失敗を「明細なし」の帳票に化けさせない
  if (itemsRes.error) {
    return NextResponse.json({ error: `請求明細の取得に失敗しました: ${itemsRes.error.message}` }, { status: 500 })
  }

  registerPdfFonts(fontUrl)
  const buffer = await renderToBuffer(
    <InvoicePdf
      invoice={invoice}
      customerName={customer?.name ?? '—'}
      dueDate={dueDateOf(invoice, paymentScheduleOf(customer?.channel_identifiers))}
      status={invoice.status}
      issuer={{ name: name ?? '小島農園', reg, address, tel, payment }}
      items={itemsRes.data ?? []}
    />,
  )

  return new Response(new Uint8Array(buffer), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="${invoice.invoice_number}.pdf"`,
    },
  })
}
