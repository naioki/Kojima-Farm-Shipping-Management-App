import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { jstTodayStr, shiftDateStr } from '@/lib/dates'

export const QUANTITY_HISTORY_DAYS = 90

/**
 * 同じ取引先×品目の過去の承認済み数量（「いつもの数量」の材料）。キーは `customerId:productId`。
 * 承認画面・スタッフ承認・FAX自動取り込みの3か所で同じものを使う（判定がずれないように）。
 * 取得に失敗しても業務は止めない（空で返し、警告が出ないだけ）。
 * Supabase の1回の取得上限（既定1000行）に備え、新しい明細から取る。
 */
export async function loadQuantityHistory(
  supabase: SupabaseClient,
  customerIds: string[],
  productIds: string[],
): Promise<Map<string, number[]>> {
  const out = new Map<string, number[]>()
  if (customerIds.length === 0 || productIds.length === 0) return out
  const { data, error } = await supabase
    .from('order_items')
    .select('product_id, quantity, orders!inner(customer_id, status, delivery_date)')
    .in('product_id', productIds)
    .in('orders.customer_id', customerIds)
    .in('orders.status', ['approved', 'shipped', 'invoiced'])
    .gte('orders.delivery_date', shiftDateStr(jstTodayStr(), -QUANTITY_HISTORY_DAYS))
    .order('created_at', { ascending: false })
    .limit(1000)
  if (error) {
    console.error('[quantity-history] 過去の数量の取得に失敗:', error.message)
    return out
  }
  for (const h of (data ?? []) as unknown as { product_id: string; quantity: number; orders: { customer_id: string } | null }[]) {
    if (!h.orders) continue
    const k = `${h.orders.customer_id}:${h.product_id}`
    out.set(k, [...(out.get(k) ?? []), Number(h.quantity)])
  }
  return out
}
