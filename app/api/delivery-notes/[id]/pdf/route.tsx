import { NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { DeliveryNotePdf } from '@/lib/pdf/DeliveryNotePdf'
import { registerPdfFonts } from '@/lib/pdf/fonts'
import { getSetting } from '@/lib/settings'
import { parseAmountMode } from '@/lib/delivery-notes/amount-mode'

export const runtime = 'nodejs'

/** 保存済み納品書PDF（スナップショットから再印刷）。元注文を編集しても当時の内容のまま。 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const supabase = createClient()
  const { data: note, error } = await supabase
    .from('delivery_notes')
    .select('*')
    .eq('id', params.id)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!note) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const [{ data: items }, fontUrl] = await Promise.all([
    supabase
      .from('delivery_note_items')
      .select('product_name, quantity, unit, unit_price, tax_rate, subtotal')
      .eq('delivery_note_id', params.id)
      .order('sort_order'),
    getSetting('PDF_FONT_URL'),
  ])

  registerPdfFonts(fontUrl)
  const buffer = await renderToBuffer(
    <DeliveryNotePdf
      customerName={note.customer_name}
      date={note.delivery_date}
      mode={parseAmountMode(note.amount_mode)}
      issuer={{ name: note.issuer_name, address: note.issuer_address, tel: note.issuer_tel }}
      items={items ?? []}
      totals={{ subtotal8: note.subtotal_8, subtotal10: note.subtotal_10, total: note.total_amount }}
    />,
  )

  return new Response(new Uint8Array(buffer), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="${note.note_number}.pdf"`,
    },
  })
}
