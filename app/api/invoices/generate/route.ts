import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { sumInvoiceTotals, formatInvoiceNumber, type TaxRate } from '@/lib/calculations/tax'
import { writeAudit } from '@/lib/audit/log'

export const runtime = 'nodejs'

const inputSchema = z.object({
  customer_id: z.string().uuid(),
  billing_month: z.string().regex(/^\d{4}-\d{2}$/), // 'YYYY-MM'
})

/**
 * 月末請求書生成（tax.md 厳守）。features.md Phase G の請求接続。
 *   approved/shipped の order_items を集計 → 税率別合計 → 欠番なし採番 → invoices/invoice_items。
 *   税率は order_items.tax_rate（冗長保持値）を使う。products.default_tax_rate では計算しない。
 *   生成は audit_log に記録（7年保存）。
 */
export async function POST(req: Request) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const parsed = inputSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid', detail: parsed.error.flatten() }, { status: 400 })
  }
  const { customer_id, billing_month } = parsed.data
  const supabase = createClient()

  // 対象期間の注文明細（締めルールの厳密な期間決定は今後 customers.closing_rule で精緻化）
  const monthStart = `${billing_month}-01`
  const { data: rows, error } = await supabase
    .from('order_items')
    .select('id, product_name, quantity, unit, unit_price, tax_rate, orders!inner(customer_id, status, delivery_date)')
    .eq('orders.customer_id', customer_id)
    .in('orders.status', ['approved', 'shipped'])
    .gte('orders.delivery_date', monthStart)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!rows?.length) return NextResponse.json({ error: 'no_billable_items' }, { status: 404 })

  // 税率別合計（Decimal.js・税率バケットで集計してから課税）
  const totals = sumInvoiceTotals(
    rows.map((r) => ({ quantity: r.quantity, unitPrice: r.unit_price, taxRate: r.tax_rate as TaxRate })),
  )

  // 欠番なし採番（DB の RPC でロック取得）
  const { data: seq, error: seqErr } = await supabase.rpc('get_next_invoice_number', {
    p_month: billing_month.replace('-', ''),
  })
  if (seqErr) return NextResponse.json({ error: seqErr.message }, { status: 500 })
  const invoiceNumber = formatInvoiceNumber(billing_month, seq as number)

  const { data: customer } = await supabase
    .from('customers')
    .select('invoice_reg_num')
    .eq('id', customer_id)
    .maybeSingle()

  const { data: invoice, error: invErr } = await supabase
    .from('invoices')
    .insert({
      invoice_number: invoiceNumber,
      customer_id,
      billing_month,
      issue_date: new Date().toISOString().slice(0, 10),
      invoice_reg_num: customer?.invoice_reg_num ?? null,
      subtotal_8: totals.reduced.subtotal.toNumber(),
      tax_8: totals.reduced.tax.toNumber(),
      subtotal_10: totals.standard.subtotal.toNumber(),
      tax_10: totals.standard.tax.toNumber(),
      total_amount: totals.total.toNumber(),
      status: 'draft',
      created_by: user.id,
    })
    .select('id')
    .single()
  if (invErr) return NextResponse.json({ error: invErr.message }, { status: 500 })

  // 明細スナップショット（税率冗長保持）
  const invoiceItems = rows.map((r) => ({
    invoice_id: invoice.id,
    order_item_id: r.id,
    product_name: r.product_name,
    quantity: r.quantity,
    unit: r.unit,
    unit_price: r.unit_price,
    tax_rate: r.tax_rate,
  }))
  const { error: iiErr } = await supabase.from('invoice_items').insert(invoiceItems)
  if (iiErr) return NextResponse.json({ error: iiErr.message }, { status: 500 })

  await writeAudit(supabase, {
    entityType: 'invoices',
    entityId: invoice.id,
    action: 'INSERT',
    newValues: { invoice_number: invoiceNumber, total_amount: totals.total.toNumber() },
    userId: user.id,
  })

  return NextResponse.json(
    { invoice_id: invoice.id, invoice_number: invoiceNumber, total: totals.total.toNumber() },
    { status: 201 },
  )
}
