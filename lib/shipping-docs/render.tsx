import 'server-only'
import { renderToBuffer } from '@react-pdf/renderer'
import { registerPdfFonts } from '@/lib/pdf/fonts'
import { ShippingSheetPdf } from '@/lib/pdf/ShippingSheetPdf'
import { ShippingLabelsPdf } from '@/lib/pdf/ShippingLabelsPdf'
import { buildLabels } from '@/lib/calculations/shipping-docs'
import { loadShippingDocEntries } from '@/lib/shipping-docs/load'
import { getSetting } from '@/lib/settings'

/**
 * 出荷帳票PDFの共通レンダラー。ダウンロードAPI（GET）と印刷キュー投入（POST /api/print-jobs）で
 * 同一のPDFを保証するため、生成経路を1本化する。
 */

export type ShippingDocType = 'sheet' | 'labels'

export interface RenderShippingDocParams {
  docType: ShippingDocType
  date: string
  customerId?: string | null
  productId?: string | null
  /** ラベルのみ: 供給先順を逆にする（積み込み順） */
  reverse?: boolean
}

export type RenderShippingDocResult =
  | { ok: true; buffer: Buffer; filename: string }
  | { ok: false; status: number; error: string }

export async function renderShippingDocPdf(params: RenderShippingDocParams): Promise<RenderShippingDocResult> {
  const { entries, dateDisplay, dateDisplayWide, error } = await loadShippingDocEntries({
    date: params.date,
    customerId: params.customerId,
    productId: params.productId,
  })
  if (error) return { ok: false, status: 500, error }
  if (!entries.length) return { ok: false, status: 404, error: 'この日の出荷対象はありません' }

  registerPdfFonts(await getSetting('PDF_FONT_URL'))

  if (params.docType === 'sheet') {
    const buffer = await renderToBuffer(<ShippingSheetPdf entries={entries} dateDisplay={dateDisplayWide} />)
    return { ok: true, buffer, filename: `shipping_sheet_${params.date}.pdf` }
  }

  const ordered = params.reverse ? [...entries].reverse() : entries
  const labels = buildLabels(ordered)
  const buffer = await renderToBuffer(<ShippingLabelsPdf entries={ordered} labels={labels} dateDisplay={dateDisplay} />)
  return { ok: true, buffer, filename: `shipping_labels_${params.date}.pdf` }
}
