import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { sumInvoiceTotals, formatInvoiceNumber, type TaxRate } from '@/lib/calculations/tax'
import { writeAudit } from '@/lib/audit/log'
import { jstTodayStr } from '@/lib/dates'
import { resolveBillingUnitPrice, type PriceRuleLite } from '@/lib/invoices/pricing'

/**
 * 既に有効な請求書（void 以外）に載っている order_item_id の集合。
 * 同じ明細の二重請求を防ぐため、請求書生成・候補表示の両方でこれを除外する。
 */
export async function fetchBilledOrderItemIds(
  supabase: SupabaseClient,
  orderItemIds: string[],
): Promise<{ ok: true; ids: Set<string> } | { ok: false; message: string }> {
  const ids = new Set<string>()
  const CHUNK = 200 // in() の URL 長制限対策
  for (let i = 0; i < orderItemIds.length; i += CHUNK) {
    const chunk = orderItemIds.slice(i, i + CHUNK)
    const { data, error } = await supabase
      .from('invoice_items')
      .select('order_item_id, invoices!inner(status)')
      .in('order_item_id', chunk)
      .neq('invoices.status', 'void')
    if (error) return { ok: false, message: `請求済み明細の確認に失敗しました: ${error.message}` }
    for (const r of (data ?? []) as { order_item_id: string | null }[]) {
      if (r.order_item_id) ids.add(r.order_item_id)
    }
  }
  return { ok: true, ids }
}

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

  const positiveRows = (rawRows ?? []).filter((r) => billableQty(r) > 0)
  // 二重請求防止: 既に有効な請求書（void 以外）に載っている明細は除外する
  const billed = await fetchBilledOrderItemIds(supabase, positiveRows.map((r) => r.id))
  if (!billed.ok) return { ok: false, reason: 'error', message: billed.message }
  const rows = positiveRows.filter((r) => !billed.ids.has(r.id))
  if (!rows.length) return { ok: false, reason: 'no_items' }

  // 単価が 0 または未設定の明細は、納品日に有効な price_rules → products.default_unit_price の順で補完
  const productIds = [...new Set(rows.map((r) => r.product_id).filter(Boolean))] as string[]
  const [priceRulesRes, productsRes] = await Promise.all([
    productIds.length
      ? supabase
          .from('price_rules')
          .select('product_id, customer_id, unit_price, effective_from, effective_to')
          .in('product_id', productIds)
          .or(`customer_id.eq.${customerId},customer_id.is.null`)
      : Promise.resolve({ data: [] as PriceRuleLite[], error: null }),
    productIds.length
      ? supabase.from('products').select('id, default_unit_price').in('id', productIds)
      : Promise.resolve({ data: [] as { id: string; default_unit_price: number | null }[], error: null }),
  ])
  // 単価マスタの取得失敗を「単価0」に化けさせない（誤った金額の請求書を作らない）
  if (priceRulesRes.error) return { ok: false, reason: 'error', message: `価格マスタの取得に失敗しました: ${priceRulesRes.error.message}` }
  if (productsRes.error) return { ok: false, reason: 'error', message: `商品マスタの取得に失敗しました: ${productsRes.error.message}` }

  const priceRules = (priceRulesRes.data ?? []) as PriceRuleLite[]
  const defaultPriceByProd = new Map(
    ((productsRes.data ?? []) as { id: string; default_unit_price: number | null }[]).map((p) => [p.id, p.default_unit_price]),
  )

  const resolvedRows = rows.map((r) => {
    const deliveryDate = (r.orders as unknown as { delivery_date: string | null } | null)?.delivery_date ?? null
    return {
      ...r,
      resolvedUnitPrice: resolveBillingUnitPrice({
        currentUnitPrice: r.unit_price,
        productId: r.product_id,
        customerId,
        deliveryDate,
        rules: priceRules,
        defaultUnitPrice: r.product_id ? defaultPriceByProd.get(r.product_id) : null,
      }),
    }
  })

  const totals = sumInvoiceTotals(
    resolvedRows.map((r) => ({
      quantity: billableQty(r),
      unitPrice: r.resolvedUnitPrice,
      taxRate: r.tax_rate as TaxRate,
    })),
  )

  // 登録番号はインボイス必須項目。取得失敗のまま発行しない（番号を消費する前に確認する）
  const { data: customer, error: customerErr } = await supabase
    .from('customers')
    .select('invoice_reg_num')
    .eq('id', customerId)
    .maybeSingle()
  if (customerErr) return { ok: false, reason: 'error', message: `取引先の取得に失敗しました: ${customerErr.message}` }

  const header = {
    customerId,
    billingMonth,
    periodStart,
    periodEnd,
    issueDate: jstTodayStr(),
    invoiceRegNum: customer?.invoice_reg_num ?? null,
    subtotal8: totals.reduced.subtotal.toNumber(),
    tax8: totals.reduced.tax.toNumber(),
    subtotal10: totals.standard.subtotal.toNumber(),
    tax10: totals.standard.tax.toNumber(),
    total: totals.total.toNumber(),
    userId,
  }
  const items = resolvedRows.map((r) => ({
    order_item_id: r.id,
    product_name: r.product_name,
    quantity: billableQty(r),
    unit: r.unit,
    unit_price: r.resolvedUnitPrice,
    tax_rate: r.tax_rate,
  }))

  // 採番・請求書・明細・単価確定を1トランザクションで（失敗時は採番も巻き戻る＝欠番なし。二重請求もDB側で拒否）
  const atomic = await createInvoiceAtomic(supabase, header, items)
  let invoice: { id: string }
  let invoiceNumber: string
  if (atomic.kind === 'ok') {
    invoice = { id: atomic.invoiceId }
    invoiceNumber = atomic.invoiceNumber
  } else if (atomic.kind === 'already_billed') {
    return { ok: false, reason: 'error', message: '同じ明細がすでに別の請求書に載っています。請求書一覧を確認してください' }
  } else if (atomic.kind === 'error') {
    return { ok: false, reason: 'error', message: `請求書の作成に失敗しました: ${atomic.message}` }
  } else {
    // migrations/0032 未適用の環境のみ: 旧方式（逐次実行）で作成する
    const legacy = await createInvoiceLegacy(supabase, header, items)
    if (!legacy.ok) return { ok: false, reason: 'error', message: legacy.message }
    invoice = { id: legacy.invoiceId }
    invoiceNumber = legacy.invoiceNumber
  }

  await writeAudit(supabase, {
    entityType: 'invoices',
    entityId: invoice.id,
    action: 'INSERT',
    newValues: { invoice_number: invoiceNumber, total_amount: totals.total.toNumber() },
    userId,
  })

  return { ok: true, invoice_id: invoice.id, invoice_number: invoiceNumber, total: totals.total.toNumber() }
}

interface InvoiceHeaderInput {
  customerId: string
  billingMonth: string
  periodStart: string
  periodEnd: string
  issueDate: string
  invoiceRegNum: string | null
  subtotal8: number
  tax8: number
  subtotal10: number
  tax10: number
  total: number
  userId: string | null
}
interface InvoiceItemInput {
  order_item_id: string
  product_name: string
  quantity: number
  unit: string
  unit_price: number
  tax_rate: number
}

/** PostgREST が「関数が無い」と返したか（migrations/0032 未適用） */
function isMissingFunction(err: { code?: string; message?: string }): boolean {
  return err.code === 'PGRST202' || /could not find the function/i.test(err.message ?? '')
}

/** 1トランザクションで請求書を作る（migrations/0032 の create_invoice_atomic） */
export async function createInvoiceAtomic(
  supabase: SupabaseClient,
  h: InvoiceHeaderInput,
  items: InvoiceItemInput[],
): Promise<
  | { kind: 'ok'; invoiceId: string; invoiceNumber: string }
  | { kind: 'already_billed' }
  | { kind: 'missing_function' }
  | { kind: 'error'; message: string }
> {
  const { data, error } = await supabase.rpc('create_invoice_atomic', {
    p_customer_id: h.customerId,
    p_billing_month: h.billingMonth,
    p_period_start: h.periodStart,
    p_period_end: h.periodEnd,
    p_issue_date: h.issueDate,
    p_invoice_reg_num: h.invoiceRegNum,
    p_subtotal_8: h.subtotal8,
    p_tax_8: h.tax8,
    p_subtotal_10: h.subtotal10,
    p_tax_10: h.tax10,
    p_total_amount: h.total,
    p_created_by: h.userId,
    p_items: items,
  })
  if (error) {
    if (isMissingFunction(error)) return { kind: 'missing_function' }
    if (/already_billed/.test(error.message ?? '')) return { kind: 'already_billed' }
    return { kind: 'error', message: error.message }
  }
  const row = (Array.isArray(data) ? data[0] : data) as { invoice_id?: string; invoice_number?: string } | null
  if (!row?.invoice_id || !row.invoice_number) return { kind: 'error', message: '請求書の作成結果を受け取れませんでした' }
  return { kind: 'ok', invoiceId: row.invoice_id, invoiceNumber: row.invoice_number }
}

/** 旧方式（逐次実行）。0032 未適用の環境でだけ使う。明細保存に失敗したら void にして番号の記録を残す */
async function createInvoiceLegacy(
  supabase: SupabaseClient,
  h: InvoiceHeaderInput,
  items: InvoiceItemInput[],
): Promise<{ ok: true; invoiceId: string; invoiceNumber: string } | { ok: false; message: string }> {
  const { data: seq, error: seqErr } = await supabase.rpc('get_next_invoice_number', {
    p_month: h.billingMonth.replace('-', ''),
  })
  if (seqErr) return { ok: false, message: seqErr.message }
  const invoiceNumber = formatInvoiceNumber(h.billingMonth, seq as number)

  const { data: invoice, error: invErr } = await supabase
    .from('invoices')
    .insert({
      invoice_number: invoiceNumber,
      customer_id: h.customerId,
      billing_month: h.billingMonth,
      period_start: h.periodStart,
      period_end: h.periodEnd,
      issue_date: h.issueDate,
      invoice_reg_num: h.invoiceRegNum,
      subtotal_8: h.subtotal8,
      tax_8: h.tax8,
      subtotal_10: h.subtotal10,
      tax_10: h.tax10,
      total_amount: h.total,
      status: 'draft',
      created_by: h.userId,
    })
    .select('id')
    .single()
  if (invErr || !invoice) {
    console.error(`[invoices/generate] 請求書 ${invoiceNumber} の作成に失敗（欠番）:`, invErr?.message)
    return { ok: false, message: `請求書 ${invoiceNumber} の作成に失敗しました: ${invErr?.message ?? 'unknown'}` }
  }

  const { error: iiErr } = await supabase
    .from('invoice_items')
    .insert(items.map((it) => ({ ...it, invoice_id: invoice.id })))
  if (iiErr) {
    const { error: voidErr } = await supabase.from('invoices').update({ status: 'void' }).eq('id', invoice.id)
    if (voidErr) console.error(`[invoices/generate] 請求書 ${invoiceNumber} の無効化に失敗:`, voidErr.message)
    await writeAudit(supabase, {
      entityType: 'invoices',
      entityId: invoice.id,
      action: 'UPDATE',
      oldValues: { status: 'draft' },
      newValues: { status: 'void', reason: `明細の保存に失敗: ${iiErr.message}` },
      userId: h.userId,
    }).catch(() => {})
    return { ok: false, message: `請求書 ${invoiceNumber} の明細保存に失敗したため無効にしました: ${iiErr.message}` }
  }

  const { error: psErr } = await supabase
    .from('order_items')
    .update({ price_status: 'confirmed' })
    .in('id', items.map((it) => it.order_item_id))
  if (psErr) console.error('[invoices/generate] price_status の同期に失敗:', psErr.message)
  return { ok: true, invoiceId: invoice.id, invoiceNumber }
}
