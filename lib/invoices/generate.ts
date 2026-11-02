import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { sumInvoiceTotals, formatInvoiceNumber, type TaxRate } from '@/lib/calculations/tax'
import { writeAudit } from '@/lib/audit/log'
import { jstTodayStr } from '@/lib/dates'

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

/**
 * 1取引先・指定期間の請求書を生成する共通ロジック（#42 unpriced 注文でも0件エラーにならない自動単価補完＆確定対応）。
 */
export async function generateInvoiceForCustomer(
  supabase: SupabaseClient,
  params: { customerId: string; periodStart: string; periodEnd: string; userId: string | null },
): Promise<GenerateOutcome> {
  const { customerId, periodStart, periodEnd, userId } = params
  const billingMonth = periodEnd.slice(0, 7)

  // #42 現場・管理画面から追加された注文（price_status = 'unpriced'）も含め、期間内の確定注文（approved / shipped）を取得
  const { data: rawRows, error } = await supabase
    .from('order_items')
    .select(
      'id, order_id, product_id, product_name, quantity, shipped_qty, billable_qty, unit, unit_price, tax_rate, price_status, orders!inner(customer_id, status, delivery_date)',
    )
    .eq('orders.customer_id', customerId)
    .in('orders.status', ['approved', 'shipped'])
    .gte('orders.delivery_date', periodStart)
    .lte('orders.delivery_date', periodEnd)
  if (error) return { ok: false, reason: 'error', message: error.message }

  const billableQty = (r: { quantity: number; shipped_qty: number | null; billable_qty: number | null }): number =>
    Number(r.billable_qty ?? r.shipped_qty ?? r.quantity) || 0

  const rows = (rawRows ?? []).filter((r) => billableQty(r) > 0)
  if (!rows.length) return { ok: false, reason: 'no_items' }

  // 単価が 0 または未設定の明細がある場合は price_rules または products.default_unit_price から自動補完
  const productIds = [...new Set(rows.map((r) => r.product_id).filter(Boolean))] as string[]
  const [priceRulesRes, productsRes] = await Promise.all([
    productIds.length
      ? supabase
          .from('price_rules')
          .select('product_id, customer_id, unit_price, effective_from, effective_to')
          .in('product_id', productIds)
          .or(`customer_id.eq.${customerId},customer_id.is.null`)
          .order('effective_from', { ascending: false })
      : Promise.resolve({ data: [] as { product_id: string; customer_id: string | null; unit_price: number }[] }),
    productIds.length
      ? supabase.from('products').select('id, default_unit_price').in('id', productIds)
      : Promise.resolve({ data: [] as { id: string; default_unit_price: number | null }[] }),
  ])

  const defaultPriceByProd = new Map((productsRes.data ?? []).map((p) => [p.id, Number(p.default_unit_price ?? 0)]))
  const rulePriceByProd = new Map<string, number>()
  for (const pr of priceRulesRes.data ?? []) {
    if (pr.customer_id === customerId && !rulePriceByProd.has(pr.product_id)) {
      rulePriceByProd.set(pr.product_id, Number(pr.unit_price))
    }
  }
  for (const pr of priceRulesRes.data ?? []) {
    if (pr.customer_id === null && !rulePriceByProd.has(pr.product_id)) {
      rulePriceByProd.set(pr.product_id, Number(pr.unit_price))
    }
  }

  const resolvedRows = rows.map((r) => {
    let up = Number(r.unit_price ?? 0)
    if (up <= 0 && r.product_id) {
      up = rulePriceByProd.get(r.product_id) ?? defaultPriceByProd.get(r.product_id) ?? 0
    }
    return {
      ...r,
      resolvedUnitPrice: up,
    }
  })

  const totals = sumInvoiceTotals(
    resolvedRows.map((r) => ({
      quantity: billableQty(r),
      unitPrice: r.resolvedUnitPrice,
      taxRate: r.tax_rate as TaxRate,
    })),
  )

  const { data: seq, error: seqErr } = await supabase.rpc('get_next_invoice_number', {
    p_month: billingMonth.replace('-', ''),
  })
  if (seqErr) return { ok: false, reason: 'error', message: seqErr.message }
  const invoiceNumber = formatInvoiceNumber(billingMonth, seq as number)

  const { data: customer, error: customerErr } = await supabase
    .from('customers')
    .select('invoice_reg_num')
    .eq('id', customerId)
    .maybeSingle()
  if (customerErr) console.error('[invoices/generate] 取引先の登録番号取得に失敗:', customerErr.message)

  const { data: invoice, error: invErr } = await supabase
    .from('invoices')
    .insert({
      invoice_number: invoiceNumber,
      customer_id: customerId,
      billing_month: billingMonth,
      period_start: periodStart,
      period_end: periodEnd,
      issue_date: jstTodayStr(),
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

  const invoiceItems = resolvedRows.map((r) => ({
    invoice_id: invoice.id,
    order_item_id: r.id,
    product_name: r.product_name,
    quantity: billableQty(r),
    unit: r.unit,
    unit_price: r.resolvedUnitPrice,
    tax_rate: r.tax_rate,
  }))
  const { error: iiErr } = await supabase.from('invoice_items').insert(invoiceItems)
  if (iiErr) return { ok: false, reason: 'error', message: iiErr.message }

  // 請求書に取り込んだ明細の price_status を confirmed に同期
  try {
    const itemIds = resolvedRows.map((r) => r.id)
    await supabase
      .from('order_items')
      .update({ price_status: 'confirmed' })
      .in('id', itemIds)
  } catch {}

  await writeAudit(supabase, {
    entityType: 'invoices',
    entityId: invoice.id,
    action: 'INSERT',
    newValues: { invoice_number: invoiceNumber, total_amount: totals.total.toNumber() },
    userId,
  })

  return { ok: true, invoice_id: invoice.id, invoice_number: invoiceNumber, total: totals.total.toNumber() }
}
