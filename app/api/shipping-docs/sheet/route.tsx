import { NextResponse } from 'next/server'
import { getAuthedUser } from '@/lib/supabase/server'
import { renderShippingDocPdf } from '@/lib/shipping-docs/render'

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
  const customerIdsRaw = searchParams.get('customer_ids')
  if (!DATE_RE.test(date)) return NextResponse.json({ error: 'invalid_date' }, { status: 400 })
  if (customerId && !UUID_RE.test(customerId)) return NextResponse.json({ error: 'invalid_customer' }, { status: 400 })
  if (productId && !UUID_RE.test(productId)) return NextResponse.json({ error: 'invalid_product' }, { status: 400 })
  const customerIds = customerIdsRaw ? customerIdsRaw.split(',').filter(Boolean) : null
  if (customerIds && !customerIds.every((id) => UUID_RE.test(id)))
    return NextResponse.json({ error: 'invalid_customer' }, { status: 400 })

  const result = await renderShippingDocPdf({ docType: 'sheet', date, customerId, customerIds, productId })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

  return new Response(new Uint8Array(result.buffer), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="${result.filename}"`,
    },
  })
}
