import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { generateInvoiceForCustomer } from './generate'
import { createFakeSupabase, filterValue, type FakeCall, type FakeResult } from '@/tests/support/fake-supabase'

/**
 * 請求書作成の業務フロー（DB不要の通しテスト）:
 *   期間内の明細 → 請求済みの除外 → 納品日に有効な単価で補完 → 1トランザクションで作成
 */
const CUST = '11111111-1111-1111-1111-111111111111'
const P1 = 'p1'

function baseResolver(overrides: Partial<Record<string, (c: FakeCall) => FakeResult | undefined>> = {}) {
  return (c: FakeCall): FakeResult | undefined => {
    const o = overrides[c.table]
    if (o) {
      const r = o(c)
      if (r) return r
    }
    if (c.table === 'order_items' && c.op === 'select') {
      return {
        data: [
          // 単価未入力 → 納品日(11/3)に有効な取引先ルール 120円で補完される
          { id: 'i1', order_id: 'o1', product_id: P1, product_name: 'チンゲン菜', quantity: 10, shipped_qty: null, billable_qty: null, unit: 'P', unit_price: 0, tax_rate: 8, price_status: 'unpriced', orders: { customer_id: CUST, status: 'shipped', delivery_date: '2026-11-03' } },
          // すでに別の請求書に載っている → 除外
          { id: 'i2', order_id: 'o1', product_id: P1, product_name: 'チンゲン菜', quantity: 5, shipped_qty: null, billable_qty: null, unit: 'P', unit_price: 100, tax_rate: 8, price_status: 'confirmed', orders: { customer_id: CUST, status: 'shipped', delivery_date: '2026-11-03' } },
          // 数量0 → 除外
          { id: 'i3', order_id: 'o1', product_id: P1, product_name: 'チンゲン菜', quantity: 0, shipped_qty: null, billable_qty: null, unit: 'P', unit_price: 100, tax_rate: 8, price_status: 'unpriced', orders: { customer_id: CUST, status: 'shipped', delivery_date: '2026-11-03' } },
        ],
      }
    }
    if (c.table === 'invoice_items' && c.op === 'select') return { data: [{ order_item_id: 'i2' }] }
    if (c.table === 'price_rules') {
      return {
        data: [
          { product_id: P1, customer_id: CUST, unit_price: 120, effective_from: '2026-07-01', effective_to: null },
          { product_id: P1, customer_id: CUST, unit_price: 999, effective_from: '2027-01-01', effective_to: null },
        ],
      }
    }
    if (c.table === 'products') return { data: [{ id: P1, default_unit_price: 50 }] }
    if (c.table === 'customers') return { data: { invoice_reg_num: 'T1234567890123' } }
    if (c.table === 'audit_log') return { data: null }
    return undefined
  }
}

const params = { customerId: CUST, periodStart: '2026-11-01', periodEnd: '2026-11-30', userId: 'u1' }

describe('generateInvoiceForCustomer（請求書作成の通しフロー）', () => {
  it('請求済み・数量0を除き、納品日に有効な単価で1トランザクション作成する', async () => {
    const fake = createFakeSupabase(baseResolver(), (fn) =>
      fn === 'create_invoice_atomic' ? { data: [{ invoice_id: 'inv1', invoice_number: '202611-0001' }] } : undefined,
    )
    const r = await generateInvoiceForCustomer(fake.client as unknown as SupabaseClient, params)

    expect(r).toMatchObject({ ok: true, invoice_id: 'inv1', invoice_number: '202611-0001' })
    const rpc = fake.rpcCalls.find((c) => c.fn === 'create_invoice_atomic')!
    const items = rpc.args.p_items as { order_item_id: string; unit_price: number; quantity: number }[]
    expect(items).toEqual([expect.objectContaining({ order_item_id: 'i1', unit_price: 120, quantity: 10 })])
    // 10 × 120 = 1200（8%対象）、税 96、合計 1296
    expect(rpc.args).toMatchObject({ p_subtotal_8: 1200, p_tax_8: 96, p_total_amount: 1296, p_invoice_reg_num: 'T1234567890123' })
    // 旧方式（個別の採番）は使わない
    expect(fake.rpcCalls.some((c) => c.fn === 'get_next_invoice_number')).toBe(false)
  })

  it('DB側で二重請求を検知したら作成しない', async () => {
    const fake = createFakeSupabase(baseResolver(), (fn) =>
      fn === 'create_invoice_atomic' ? { error: { message: 'already_billed:1' } } : undefined,
    )
    const r = await generateInvoiceForCustomer(fake.client as unknown as SupabaseClient, params)
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.reason === 'error' && r.message).toMatch(/すでに別の請求書/)
  })

  it('請求できる明細が無ければ何も作らない', async () => {
    const fake = createFakeSupabase(
      baseResolver({ invoice_items: () => ({ data: [{ order_item_id: 'i1' }, { order_item_id: 'i2' }] }) }),
    )
    const r = await generateInvoiceForCustomer(fake.client as unknown as SupabaseClient, params)
    expect(r).toEqual({ ok: false, reason: 'no_items' })
    expect(fake.rpcCalls).toHaveLength(0)
  })

  it('価格マスタが読めないときは単価0で作らずエラーにする', async () => {
    const fake = createFakeSupabase(baseResolver({ price_rules: () => ({ error: { message: 'timeout' } }) }))
    const r = await generateInvoiceForCustomer(fake.client as unknown as SupabaseClient, params)
    expect(r.ok).toBe(false)
    expect(fake.rpcCalls).toHaveLength(0)
  })

  it('0032 未適用の環境では旧方式で作成する（デプロイ順に依存しない）', async () => {
    const fake = createFakeSupabase(
      baseResolver({
        invoices: (c) => (c.op === 'insert' ? { data: { id: 'inv-legacy' } } : undefined),
        invoice_items: (c) => (c.op === 'insert' ? { data: null } : undefined),
      }),
      (fn) =>
        fn === 'create_invoice_atomic'
          ? { error: { message: 'Could not find the function public.create_invoice_atomic', code: 'PGRST202' } }
          : fn === 'get_next_invoice_number'
            ? { data: 7 }
            : undefined,
    )
    const r = await generateInvoiceForCustomer(fake.client as unknown as SupabaseClient, params)
    expect(r).toMatchObject({ ok: true, invoice_id: 'inv-legacy', invoice_number: '202611-0007' })
  })

  it('作成後に取引先の支払条件で支払期日を入れる（未設定は月末締め・翌月末払い）', async () => {
    const rpc = (fn: string) =>
      fn === 'create_invoice_atomic' ? { data: [{ invoice_id: 'inv1', invoice_number: '202611-0001' }] } : undefined
    // 未設定: 11/30 締め → 12/31
    const fake = createFakeSupabase(baseResolver(), rpc)
    const r = await generateInvoiceForCustomer(fake.client as unknown as SupabaseClient, params)
    expect(r.ok).toBe(true)
    const upd = fake.calls.find((c) => c.table === 'invoices' && c.op === 'update')!
    expect(upd.payload).toEqual({ due_date: '2026-12-31' })
    expect(filterValue(upd, 'eq', 'id')).toBe('inv1')

    // 20日締め・翌月10日払い: 10/21〜11/20 の請求 → 12/10
    const fake2 = createFakeSupabase(
      baseResolver({
        customers: () => ({
          data: {
            invoice_reg_num: 'T1234567890123',
            channel_identifiers: { payment_schedule: { closing: 20, pay_month_offset: 1, pay_day: 10 } },
          },
        }),
      }),
      rpc,
    )
    await generateInvoiceForCustomer(fake2.client as unknown as SupabaseClient, {
      ...params,
      periodStart: '2026-10-21',
      periodEnd: '2026-11-20',
    })
    const upd2 = fake2.calls.find((c) => c.table === 'invoices' && c.op === 'update')!
    expect(upd2.payload).toEqual({ due_date: '2026-12-10' })
  })

  it('支払期日の保存に失敗しても請求書の作成は成功扱い', async () => {
    const fake = createFakeSupabase(
      baseResolver({ invoices: (c) => (c.op === 'update' ? { error: { message: 'permission denied' } } : undefined) }),
      (fn) => (fn === 'create_invoice_atomic' ? { data: [{ invoice_id: 'inv1', invoice_number: '202611-0001' }] } : undefined),
    )
    const r = await generateInvoiceForCustomer(fake.client as unknown as SupabaseClient, params)
    expect(r).toMatchObject({ ok: true, invoice_id: 'inv1', invoice_number: '202611-0001' })
  })
})
