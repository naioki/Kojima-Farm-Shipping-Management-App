import { NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { getAuthedUser } from '@/lib/supabase/server'
import { registerPdfFonts } from '@/lib/pdf/fonts'
import { ShippingSheetPdf } from '@/lib/pdf/ShippingSheetPdf'
import { loadShippingDocEntries } from '@/lib/shipping-docs/load'
import { getSetting } from '@/lib/settings'

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f-]{36}$/i
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * 出荷表カード PDF（コンテナ貼付用・1明細=1ページ）。
 * GET /api/shipping-docs/sheet?date=YYYY-MM-DD[&customer=uuid][&product=uuid]
 * 供給先は「取引先＞納入先」の帳票表記（例: ヨーク 東道野辺／寺崎）。
 */
export async function GET(req: Request) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const date = searchParams.get('date') ?? ''
  const customerId = searchParams.get('customer')
  const productId = searchParams.get('product')
  if (!DATE_RE.test(date)) return NextResponse.json({ error: 'invalid_date' }, { status: 400 })
  if (customerId && !UUID_RE.test(customerId)) return NextResponse.json({ error: 'invalid_customer' }, { status: 400 })
  if (productId && !UUID_RE.test(productId)) return NextResponse.json({ error: 'invalid_product' }, { status: 400 })

  const { entries, dateDisplayWide, error } = await loadShippingDocEntries({ date, customerId, productId })
  if (error) return NextResponse.json({ error }, { status: 500 })
  if (!entries.length) {
    return NextResponse.json({ error: 'この日の出荷対象はありません' }, { status: 404 })
  }

  registerPdfFonts(await getSetting('PDF_FONT_URL'))
  const buffer = await renderToBuffer(<ShippingSheetPdf entries={entries} dateDisplay={dateDisplayWide} />)

  return new Response(new Uint8Array(buffer), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="shipping_sheet_${date}.pdf"`,
    },
  })
}
