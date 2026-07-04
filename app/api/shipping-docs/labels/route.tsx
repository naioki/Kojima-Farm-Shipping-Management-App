import { NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { getAuthedUser } from '@/lib/supabase/server'
import { registerPdfFonts } from '@/lib/pdf/fonts'
import { ShippingLabelsPdf } from '@/lib/pdf/ShippingLabelsPdf'
import { buildLabels } from '@/lib/calculations/shipping-docs'
import { loadShippingDocEntries } from '@/lib/shipping-docs/load'
import { getSetting } from '@/lib/settings'

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f-]{36}$/i
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * 出荷ラベル PDF（8分割・Cut and Stack・1ページ目に出荷一覧表）。
 * GET /api/shipping-docs/labels?date=YYYY-MM-DD[&customer=uuid][&product=uuid][&reverse=1]
 * reverse=1 で供給先順を逆にする（積み込み順の都合。v4 の PDF逆順と同じ）。
 */
export async function GET(req: Request) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const date = searchParams.get('date') ?? ''
  const customerId = searchParams.get('customer')
  const productId = searchParams.get('product')
  const reverse = searchParams.get('reverse') === '1'
  if (!DATE_RE.test(date)) return NextResponse.json({ error: 'invalid_date' }, { status: 400 })
  if (customerId && !UUID_RE.test(customerId)) return NextResponse.json({ error: 'invalid_customer' }, { status: 400 })
  if (productId && !UUID_RE.test(productId)) return NextResponse.json({ error: 'invalid_product' }, { status: 400 })

  const { entries, dateDisplay, error } = await loadShippingDocEntries({ date, customerId, productId })
  if (error) return NextResponse.json({ error }, { status: 500 })
  if (!entries.length) {
    return NextResponse.json({ error: 'この日の出荷対象はありません' }, { status: 404 })
  }

  const ordered = reverse ? [...entries].reverse() : entries
  const labels = buildLabels(ordered)

  registerPdfFonts(await getSetting('PDF_FONT_URL'))
  const buffer = await renderToBuffer(
    <ShippingLabelsPdf entries={ordered} labels={labels} dateDisplay={dateDisplay} />,
  )

  return new Response(new Uint8Array(buffer), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="shipping_labels_${date}.pdf"`,
    },
  })
}
