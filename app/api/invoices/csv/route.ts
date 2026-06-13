import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { getSetting } from '@/lib/settings'
import { buildInvoiceCsv, CSV_BOM, type InvoiceCsvRow } from '@/lib/invoices/csv'
import type { TaxRate } from '@/types/database'

export const runtime = 'nodejs'

const querySchema = z.object({
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

/**
 * 期間内の全請求書の明細を1ファイルにまとめた会計取り込み用 CSV（UTF-8 BOM）。
 * 会計ソフト（マネーフォワード / freee）に月次でまとめて取り込む用途。
 *   - issue_date（発行日）が start〜end に入る請求書を対象（無効は除外）。
 *   - 明細1行＝CSV1行。請求書番号でグルーピングできる。
 */
export async function GET(req: Request) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const parsed = querySchema.safeParse({ start: searchParams.get('start'), end: searchParams.get('end') })
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid', detail: parsed.error.flatten() }, { status: 400 })
  }
  const { start, end } = parsed.data
  if (start > end) {
    return NextResponse.json({ error: 'invalid', detail: '開始日は終了日以前である必要があります' }, { status: 400 })
  }

  const supabase = createClient()

  const { data: invoices, error } = await supabase
    .from('invoices')
    .select('id, invoice_number, customer_id, billing_month, period_start, period_end, issue_date, invoice_reg_num')
    .neq('status', 'void')
    .gte('issue_date', start)
    .lte('issue_date', end)
    .order('invoice_number')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const farmReg = await getSetting('FARM_INVOICE_REG_NUM')

  if (!invoices?.length) {
    const csv = CSV_BOM + buildInvoiceCsv([])
    return new Response(csv, {
      headers: {
        'content-type': 'text/csv;charset=utf-8',
        'content-disposition': `attachment; filename="invoices_${start}_${end}.csv"`,
      },
    })
  }

  const invoiceIds = invoices.map((i) => i.id)
  const customerIds = [...new Set(invoices.map((i) => i.customer_id))]
  const [{ data: items }, { data: custRows }] = await Promise.all([
    supabase
      .from('invoice_items')
      .select('invoice_id, product_name, quantity, unit, unit_price, tax_rate, subtotal, tax_amount, line_total')
      .in('invoice_id', invoiceIds),
    supabase.from('customers').select('id, name').in('id', customerIds),
  ])
  const customerName = new Map((custRows ?? []).map((c) => [c.id, c.name]))

  // 請求書番号順に並べ、各請求書の明細を続けて出す
  const itemsByInvoice = new Map<string, NonNullable<typeof items>>()
  for (const it of items ?? []) {
    const arr = itemsByInvoice.get(it.invoice_id) ?? []
    arr.push(it)
    itemsByInvoice.set(it.invoice_id, arr)
  }

  const rows: InvoiceCsvRow[] = []
  for (const inv of invoices) {
    const regNum = inv.invoice_reg_num ?? farmReg ?? null
    for (const it of itemsByInvoice.get(inv.id) ?? []) {
      rows.push({
        invoice_number: inv.invoice_number,
        issue_date: inv.issue_date,
        customer_name: customerName.get(inv.customer_id) ?? '—',
        billing_month: inv.billing_month,
        period_start: inv.period_start,
        period_end: inv.period_end,
        product_name: it.product_name,
        quantity: it.quantity,
        unit: it.unit,
        unit_price: it.unit_price,
        tax_rate: it.tax_rate as TaxRate,
        subtotal: it.subtotal,
        tax_amount: it.tax_amount,
        line_total: it.line_total,
        registration_number: regNum,
      })
    }
  }

  const csv = CSV_BOM + buildInvoiceCsv(rows)
  return new Response(csv, {
    headers: {
      'content-type': 'text/csv;charset=utf-8',
      'content-disposition': `attachment; filename="invoices_${start}_${end}.csv"`,
    },
  })
}
