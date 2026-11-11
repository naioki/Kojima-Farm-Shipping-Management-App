import { NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { createAdminClient } from '@/lib/supabase/admin'
import { DeliveryNotePdf, type DeliveryNoteSheetProps } from '@/lib/pdf/DeliveryNotePdf'
import { registerPdfFonts } from '@/lib/pdf/fonts'
import { getSetting } from '@/lib/settings'
import { sumInvoiceTotals, type TaxRate } from '@/lib/calculations/tax'
import { parseAmountMode } from '@/lib/delivery-notes/amount-mode'
import { parseDocType } from '@/lib/delivery-notes/doc-type'
import {
  isDriverDeliveryNoteCustomer,
  parseDeliveryNoteLayout,
  parseIssuerPreset,
  resolveDefaultIssuerPreset,
  resolveIssuerCompanyName,
  resolvePrintedDeliveryDate,
} from '@/lib/delivery-notes/driver-note'
import { shiftDateStr } from '@/lib/dates'
import { deliveryNoteMonthKey, formatDeliveryNoteNumber } from '@/lib/delivery-notes/number'
import { isSameNoteSnapshot } from '@/lib/delivery-notes/snapshot'
import { reviseDeliveryNote } from '@/lib/delivery-notes/revise'
import { requireStaffApi } from '@/lib/auth/api-guard'

export const runtime = 'nodejs'

async function autoUpsertDeliveryNoteSnapshot(params: {
  supabase: ReturnType<typeof createAdminClient>
  userId: string
  customerId: string
  customerName: string
  deliveryDate: string
  amountMode: string
  issuerName: string
  issuerAddress: string | null
  issuerTel: string | null
  subtotal8: number
  subtotal10: number
  totalAmount: number
  items: {
    product_name: string
    quantity: number
    unit: string
    unit_price: number
    tax_rate: number
    subtotal: number
  }[]
}) {
  try {
    const {
      supabase,
      userId,
      customerId,
      customerName,
      deliveryDate,
      amountMode,
      issuerName,
      issuerAddress,
      issuerTel,
      subtotal8,
      subtotal10,
      totalAmount,
      items,
    } = params
    if (items.length === 0) return

    // 既存の納品書があれば: 内容が同じなら何もしない。違えば同じ番号の「訂正版」にする（旧内容は audit_log に保存）。
    const { data: existing, error: existingErr } = await supabase
      .from('delivery_notes')
      .select('id, note_number, amount_mode, issuer_name, issuer_address, issuer_tel, total_amount')
      .eq('customer_id', customerId)
      .eq('delivery_date', deliveryDate)
      .eq('customer_name', customerName)
      .order('issued_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (existingErr) {
      console.error('[delivery-notes/pdf] 既存納品書の確認に失敗:', existingErr.message)
      return
    }

    if (existing?.id) {
      const { data: existingItems, error: exItemsErr } = await supabase
        .from('delivery_note_items')
        .select('product_name, quantity, unit, unit_price, tax_rate')
        .eq('delivery_note_id', existing.id)
        .order('sort_order')
      if (exItemsErr) {
        console.error('[delivery-notes/pdf] 既存納品書の明細取得に失敗:', exItemsErr.message)
        return
      }
      const same = isSameNoteSnapshot(
        { header: existing, items: existingItems ?? [] },
        {
          header: {
            amount_mode: amountMode,
            issuer_name: issuerName,
            issuer_address: issuerAddress,
            issuer_tel: issuerTel,
            total_amount: totalAmount,
          },
          items,
        },
      )
      if (same) return

      const rev = await reviseDeliveryNote(supabase, {
        noteId: existing.id,
        header: {
          amount_mode: amountMode,
          issuer_name: issuerName,
          issuer_address: issuerAddress,
          issuer_tel: issuerTel,
          subtotal_8: subtotal8,
          subtotal_10: subtotal10,
          total_amount: totalAmount,
        },
        items: items.map((it, idx) => ({
          product_name: it.product_name,
          quantity: it.quantity,
          unit: it.unit,
          unit_price: it.unit_price,
          tax_rate: it.tax_rate,
          subtotal: it.subtotal,
          sort_order: idx,
        })),
        userId,
      })
      if (!rev.ok) console.error('[delivery-notes/pdf] 納品書の訂正に失敗:', rev.message)
      return
    }

    let noteId: string | null = null
    {
      const monthKey = deliveryNoteMonthKey(deliveryDate)
      const { data: seq, error: seqErr } = await supabase.rpc('get_next_delivery_note_number', {
        p_month: monthKey,
      })
      if (seqErr || seq == null) return
      const noteNumber = formatDeliveryNoteNumber(monthKey, seq as number)
      const { data: inserted, error: insErr } = await supabase
        .from('delivery_notes')
        .insert({
          note_number: noteNumber,
          customer_id: customerId,
          customer_name: customerName,
          delivery_date: deliveryDate,
          amount_mode: amountMode,
          issuer_name: issuerName,
          issuer_address: issuerAddress,
          issuer_tel: issuerTel,
          subtotal_8: subtotal8,
          subtotal_10: subtotal10,
          total_amount: totalAmount,
          issued_by: userId,
        })
        .select('id')
        .single()
      if (insErr || !inserted) return
      noteId = inserted.id
    }

    if (noteId) {
      const itemRows = items.map((it, idx) => ({
        delivery_note_id: noteId!,
        product_name: it.product_name,
        quantity: it.quantity,
        unit: it.unit,
        unit_price: it.unit_price,
        tax_rate: it.tax_rate as TaxRate,
        subtotal: it.subtotal,
        sort_order: idx,
      }))
      const { error: itemsErr } = await supabase.from('delivery_note_items').insert(itemRows)
      if (itemsErr) {
        // 明細の無い納品書を残さない
        console.error('[delivery-notes/pdf] 納品書明細の保存に失敗:', itemsErr.message)
        await supabase.from('delivery_notes').delete().eq('id', noteId)
      }
    }
  } catch (err) {
    console.warn('[api/delivery-notes/pdf] 自動履歴保存をスキップ:', err)
  }
}

/**
 * 納品書 / ご注文確認書 PDF（@react-pdf）。
 * - 単一取引先 (`?customer=UUID&date=YYYY-MM-DD`) および複数取引先一括 (`?customers=UUID1,UUID2&date=YYYY-MM-DD`) の両方に対応。
 * - `layout=2up|full`（A4上下2連＝切るとA5×2枚の納品書＋控 / A4全面1枚）
 * - `issuer=kojima|iplus`（小島農園 / 株式会社アイプラス、未指定時は取引先既定：勘兵衛＝アイプラス、オレンジ＝小島農園）
 * - オレンジファームは納品書に印字する日付を FAX記載の着日（11/5・11/7・11/12等）1つに自動解決。
 */
export async function GET(req: Request) {
  // 社内ユーザー（admin/staff）のみ。旧実装はログインだけで通り、取引先ポータルの利用者も他社の帳票を取得できた（fail open）
  const guard = await requireStaffApi()
  if (!guard.ok) return guard.response
  const user = guard.user

  const { searchParams } = new URL(req.url)
  const singleCustomer = searchParams.get('customer') ?? ''
  const multiCustomers = (searchParams.get('customers') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^[0-9a-f-]{36}$/i.test(s))
  const customerIds =
    multiCustomers.length > 0
      ? multiCustomers
      : /^[0-9a-f-]{36}$/i.test(singleCustomer)
      ? [singleCustomer]
      : []

  const date = searchParams.get('date') ?? ''
  const destinationId = searchParams.get('destination') ?? ''
  if (customerIds.length === 0 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'invalid_params' }, { status: 400 })
  }

  const supabase = createAdminClient()
  const [defaultFarmName, address, tel, fontUrl, amountDefault] = await Promise.all([
    getSetting('FARM_NAME'),
    getSetting('FARM_ADDRESS'),
    getSetting('FARM_TEL'),
    getSetting('PDF_FONT_URL'),
    getSetting('DELIVERY_NOTE_AMOUNT_MODE'),
  ])

  const docType = parseDocType(searchParams.get('type'))
  const explicitIssuerParam = searchParams.get('issuer')
  const explicitLayoutParam = searchParams.get('layout')
  const explicitAmountParam = searchParams.get('amount')

  const sheets: DeliveryNoteSheetProps[] = []

  for (const customerId of customerIds) {
    const { data: customer, error: customerErr } = await supabase
      .from('customers')
      .select('id, name, channel_identifiers')
      .eq('id', customerId)
      .maybeSingle()
    if (customerErr) console.error('[api/delivery-notes/pdf] 取引先名の取得に失敗:', customerErr.message)

    const rawCustName = customer?.name ?? '—'
    const chanIds = (customer?.channel_identifiers ?? null) as Record<string, unknown> | null
    let displayCustomerName = rawCustName

    if (destinationId && customerIds.length === 1) {
      const { data: dest, error: destErr } = await supabase
        .from('delivery_destinations')
        .select('code, full_name')
        .eq('id', destinationId)
        .maybeSingle()
      if (destErr) console.error('[api/delivery-notes/pdf] 納入先名の取得に失敗:', destErr.message)
      if (dest) displayCustomerName = `${displayCustomerName}＞${dest.code || dest.full_name}`
    }

    let ordersQuery = supabase
      .from('orders')
      .select('id, note, delivery_date')
      .eq('customer_id', customerId)
      .eq('delivery_date', date)
      .in('status', ['approved', 'shipped', 'invoiced'])
    if (destinationId && customerIds.length === 1) {
      ordersQuery = ordersQuery.eq('destination_id', destinationId)
    }
    const { data: initialOrders, error: ordersErr } = await ordersQuery
    let orders = initialOrders
    if (ordersErr) {
      return NextResponse.json({ error: `対象注文の取得に失敗しました: ${ordersErr.message}` }, { status: 500 })
    }

    // オレンジファーム等で「着日（木曜・土曜）」で検索された場合、前日（水曜・金曜出荷）の注文も自動照合
    if ((!orders || orders.length === 0) && rawCustName.includes('オレンジ')) {
      const prevDate = shiftDateStr(date, -1)
      const fallbackRes = await supabase
        .from('orders')
        .select('id, note, delivery_date')
        .eq('customer_id', customerId)
        .eq('delivery_date', prevDate)
        .in('status', ['approved', 'shipped', 'invoiced'])
      if (!fallbackRes.error && fallbackRes.data && fallbackRes.data.length > 0) {
        orders = fallbackRes.data
      }
    }

    const orderIds = (orders ?? []).map((o) => o.id)
    const itemsRes = orderIds.length
      ? await supabase
          .from('order_items')
          .select('product_name, quantity, shipped_qty, billable_qty, unit, unit_price, tax_rate, subtotal, spec, line_note')
          .in('order_id', orderIds)
          .order('product_name')
      : {
          data: [] as {
            product_name: string
            quantity: number
            shipped_qty?: number | null
            billable_qty?: number | null
            unit: string
            unit_price: number
            tax_rate: number
            subtotal: number
            spec?: string | null
            line_note?: string | null
          }[],
          error: null,
        }
    if (itemsRes.error) {
      return NextResponse.json({ error: `明細の取得に失敗しました: ${itemsRes.error.message}` }, { status: 500 })
    }

    const rawItems = (itemsRes.data ?? [])
      .map((it) => {
        const effQty = Number(it.billable_qty ?? it.shipped_qty ?? it.quantity) || 0
        return {
          product_name: it.product_name,
          quantity: effQty,
          unit: it.unit,
          unit_price: Number(it.unit_price) || 0,
          tax_rate: Number(it.tax_rate) || 8,
          subtotal: it.unit_price != null ? effQty * Number(it.unit_price) : Number(it.subtotal) || 0,
          spec: it.spec ?? null,
          line_note: it.line_note ?? null,
        }
      })
      .filter((it) => it.quantity > 0)

    if (customerIds.length > 1 && rawItems.length === 0) {
      continue
    }

    const isDriverTarget = isDriverDeliveryNoteCustomer(rawCustName, chanIds)
    const defaultIssuer = resolveDefaultIssuerPreset(rawCustName, chanIds)
    const issuerPreset = explicitIssuerParam
      ? parseIssuerPreset(explicitIssuerParam, defaultIssuer)
      : defaultIssuer
    const issuerName = resolveIssuerCompanyName(issuerPreset, defaultFarmName)

    const effectiveMode = explicitAmountParam
      ? parseAmountMode(explicitAmountParam, parseAmountMode(amountDefault))
      : isDriverTarget
      ? 'none'
      : parseAmountMode(amountDefault)

    const effectiveLayout = explicitLayoutParam
      ? parseDeliveryNoteLayout(explicitLayoutParam, '2up')
      : isDriverTarget || effectiveMode === 'none'
      ? '2up'
      : 'full'

    const orderNotes = [
      ...(orders ?? []).map((o) => o.note),
      ...rawItems.map((it) => it.line_note),
    ]
    const effectiveOrderDate = orders?.[0]?.delivery_date ?? date
    const printedDate = resolvePrintedDeliveryDate(rawCustName, effectiveOrderDate, orderNotes)

    const t = sumInvoiceTotals(
      rawItems.map((it) => ({
        quantity: it.quantity,
        unitPrice: it.unit_price,
        taxRate: it.tax_rate as TaxRate,
      })),
    )

    const subtotal8 = t.reduced.subtotal.toNumber()
    const subtotal10 = t.standard.subtotal.toNumber()
    const totalAmount = t.total.toNumber()

    if (docType === 'delivery' && rawItems.length > 0) {
      await autoUpsertDeliveryNoteSnapshot({
        supabase,
        userId: user.id,
        customerId,
        customerName: displayCustomerName,
        deliveryDate: printedDate,
        amountMode: effectiveMode,
        issuerName,
        issuerAddress: address ?? null,
        issuerTel: tel ?? null,
        subtotal8,
        subtotal10,
        totalAmount,
        items: rawItems,
      })
    }

    sheets.push({
      customerName: displayCustomerName,
      date: printedDate,
      mode: effectiveMode,
      docType,
      layout: effectiveLayout,
      issuer: { name: issuerName, address, tel },
      items: rawItems,
      totals: {
        subtotal8,
        subtotal10,
        total: totalAmount,
      },
    })
  }

  if (sheets.length === 0) {
    return NextResponse.json({ error: '対象の納品明細がありません' }, { status: 404 })
  }

  registerPdfFonts(fontUrl)
  const firstSheet = sheets[0]!
  const buffer = await renderToBuffer(
    <DeliveryNotePdf
      {...firstSheet}
      sheets={sheets}
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
