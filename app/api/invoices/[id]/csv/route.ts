import { NextResponse } from 'next/server'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { getSetting } from '@/lib/settings'
import { buildInvoiceCsv, CSV_BOM, type InvoiceCsvRow } from '@/lib/invoices/csv'
import type { TaxRate } from '@/types/database'

export const runtime = 'nodejs'

/** 1請求書の明細を会計ソフト取り込み用 CSV（UTF-8 BOM）でダウンロード。 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const supabase = createClient()
  const { data: invoice, error } = await supabase
    .from('invoices')
    .select('invoice_number, customer_id, billing_month, period_start, period_end, issue_date, invoice_reg_num')
    .eq('id', params.id)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!invoice) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const [{ data: items }, { data: customer }, farmReg] = await Promise.all([
    supabase
      .from('invoice_items')
      .select('product_name, quantity, unit, unit_price, tax_rate, subtotal, tax_amount, line_total')
      .eq('invoice_id', params.id),
    supabase.from('customers').select('name').eq('id', invoice.customer_id).maybeSingle(),
    getSetting('FARM_INVOICE_REG_NUM'),
  ])

  const regNum = invoice.invoice_reg_num ?? farmReg ?? null
  const rows: InvoiceCsvRow[] = (items ?? []).map((it) => ({
    invoice_number: invoice.invoice_number,
    issue_date: invoice.issue_date,
    customer_name: customer?.name ?? '—',
    billing_month: invoice.billing_month,
    period_start: invoice.period_start,
    period_end: invoice.period_end,
    product_name: it.product_name,
    quantity: it.quantity,
    unit: it.unit,
    unit_price: it.unit_price,
    tax_rate: it.tax_rate as TaxRate,
    subtotal: it.subtotal,
    tax_amount: it.tax_amount,
    line_total: it.line_total,
    registration_number: regNum,
  }))

  const csv = CSV_BOM + buildInvoiceCsv(rows)
  return new Response(csv, {
    headers: {
      'content-type': 'text/csv;charset=utf-8',
      'content-disposition': `attachment; filename="${invoice.invoice_number}.csv"`,
    },
  })
}
