import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { sumInvoiceTotals, formatInvoiceNumber, type TaxRate } from '@/lib/calculations/tax'
import { writeAudit } from '@/lib/audit/log'

/**
 * 1取引先・指定期間の請求書を生成する共通ロジック（tax.md 厳守）。
 * 単発（/api/invoices/generate）と一括（/api/invoices/generate-bulk）で共有する。
 *   - 期間内の approved/shipped の order_items を税率別に集計
 *   - 欠番なし採番（終了日の月で番号払い出し）
 *   - invoices / invoice_items を作成し audit_log に記録
 *   - 税率は order_items.tax_rate（冗長保持値）。products.default_tax_rate では計算しない。
 */

export interface GenerateOk {
  ok: true
  invoice_id: string
  invoice_number: string
  total: number
}
export type GenerateOutcome =
  | GenerateOk
  | { ok: false; reason: 'no_items' }
  | { ok: false; reason: 'error'; message: string }

export async function generateInvoiceForCustomer(
  // 呼び出し側で型付き Supabase クライアントを渡す（RLS or service_role）
  supabase: SupabaseClient,
  params: { customerId: string; periodStart: string; periodEnd: string; userId: string | null },
): Promise<GenerateOutcome> {
  const { customerId, periodStart, periodEnd, userId } = params
  const billingMonth = periodEnd.slice(0, 7)

  // 後決め対応：confirmed（価格確定済み）の明細だけを請求対象にする。
  // 請求数量は billable_qty（赤点で減らした実数）→ 無ければ shipped_qty → quantity の順。
  const { data: rows, error } = await supabase
    .from('order_items')
    .select('id, product_name, quantity, shipped_qty, billable_qty, unit, unit_price, tax_rate, price_status, orders!inner(customer_id, status, delivery_date)')
    .eq('orders.customer_id', customerId)
    .eq('price_status', 'confirmed')
    .in('orders.status', ['approved', 'shipped'])
    .gte('orders.delivery_date', periodStart)
    .lte('orders.delivery_date', periodEnd)
  if (error) return { ok: false, reason: 'error', message: error.message }
  if (!rows?.length) return { ok: false, reason: 'no_items' }

  // 請求数量の確定（billable_qty → shipped_qty → quantity）
  const billableQty = (r: { quantity: number; shipped_qty: number | null; billable_qty: number | null }): number =>
    r.billable_qty ?? r.shipped_qty ?? r.quantity

  const totals = sumInvoiceTotals(
    rows.map((r: { quantity: number; shipped_qty: number | null; billable_qty: number | null; unit_price: number; tax_rate: number }) => ({
      quantity: billableQty(r),
      unitPrice: r.unit_price,
      taxRate: r.tax_rate as TaxRate,
    })),
  )

  const { data: seq, error: seqErr } = await supabase.rpc('get_next_invoice_number', {
    p_month: billingMonth.replace('-', ''),
  })
  if (seqErr) return { ok: false, reason: 'error', message: seqErr.message }
  const invoiceNumber = formatInvoiceNumber(billingMonth, seq as number)

  const { data: customer } = await supabase
    .from('customers')
    .select('invoice_reg_num')
    .eq('id', customerId)
    .maybeSingle()

  const { data: invoice, error: invErr } = await supabase
    .from('invoices')
    .insert({
      invoice_number: invoiceNumber,
      customer_id: customerId,
      billing_month: billingMonth,
      period_start: periodStart,
      period_end: periodEnd,
      issue_date: new Date().toISOString().slice(0, 10),
      invoice_reg_num: customer?.invoice_reg_num ?? null,
      subtotal_8: totals.reduced.subtotal.toNumber(),
      tax_8: totals.reduced.tax.toNumber(),
      subtotal_10: totals.standard.subtotal.toNumber(),
      tax_10: totals.standard.tax.toNumber(),
      total_amount: totals.total.toNumber(),
      status: 'draft',
      created_by: userId,
    })
    .select('id')
    .single()
  if (invErr) return { ok: false, reason: 'error', message: invErr.message }

  const invoiceItems = rows.map(
    (r: { id: string; product_name: string; quantity: number; shipped_qty: number | null; billable_qty: number | null; unit: string; unit_price: number; tax_rate: number }) => ({
      invoice_id: invoice.id,
      order_item_id: r.id,
      product_name: r.product_name,
      quantity: billableQty(r), // 請求数量＝実出荷/赤点反映後
      unit: r.unit,
      unit_price: r.unit_price,
      tax_rate: r.tax_rate,
    }),
  )
  const { error: iiErr } = await supabase.from('invoice_items').insert(invoiceItems)
  if (iiErr) return { ok: false, reason: 'error', message: iiErr.message }

  await writeAudit(supabase, {
    entityType: 'invoices',
    entityId: invoice.id,
    action: 'INSERT',
    newValues: { invoice_number: invoiceNumber, total_amount: totals.total.toNumber() },
    userId,
  })

  return { ok: true, invoice_id: invoice.id, invoice_number: invoiceNumber, total: totals.total.toNumber() }
}
