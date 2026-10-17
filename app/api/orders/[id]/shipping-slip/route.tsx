import { NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { getAuthedUser } from '@/lib/supabase/server'
import { ShippingSlipPdf, type ShippingSlip, type SlipPaperSize } from '@/lib/pdf/ShippingSlipPdf'
import { registerPdfFonts } from '@/lib/pdf/fonts'
import { getSetting } from '@/lib/settings'

export const runtime = 'nodejs'

/**
 * 品目別出荷票PDF（写真の和郷園フォーマット）。受注詳細から発行。
 * 値は発行フォームで確定した内容を body で受け取り、そのまま描画する（1品目＝1ページ）。
 * ヘッダー会社名は取引先ごとに選択／記入で切替できる。
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  let body: { slips?: unknown; size?: unknown }
  try {
    body = (await req.json()) as { slips?: unknown; size?: unknown }
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const raw = Array.isArray(body.slips) ? body.slips : []
  if (raw.length === 0) return NextResponse.json({ error: 'no_slips' }, { status: 400 })

  const size: SlipPaperSize = body.size === 'A5' ? 'A5' : 'A4'

  const str = (v: unknown) => (v == null ? '' : String(v))
  const slips: ShippingSlip[] = raw.map((r) => {
    const o = (r ?? {}) as Record<string, unknown>
    return {
      headerCompany: str(o.headerCompany),
      destination: str(o.destination),
      productName: str(o.productName),
      shipDate: str(o.shipDate),
      spec: str(o.spec),
      iri: str(o.iri),
      caseCount: str(o.caseCount),
      hasu: str(o.hasu),
      hasuCaseCount: str(o.hasuCaseCount),
      total: str(o.total),
      mateHan: str(o.mateHan),
    }
  })

  const fontUrl = await getSetting('PDF_FONT_URL')
  registerPdfFonts(fontUrl)

  const buffer = await renderToBuffer(<ShippingSlipPdf slips={slips} size={size} />)

  return new Response(new Uint8Array(buffer), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="shipping-slip-${params.id}.pdf"`,
    },
  })
}
