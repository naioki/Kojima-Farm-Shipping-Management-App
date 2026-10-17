import 'server-only'
import type { createAdminClient } from '@/lib/supabase/admin'

type AdminClient = ReturnType<typeof createAdminClient>

export interface MissingSpec {
  customerId: string
  customerName: string
  productName: string
  count: number
  missingPacks: boolean
  missingSpec: boolean
  hasRule: boolean
}

/**
 * 「注文実績はあるのに customer_product_rules が無い／入り数(P/C)・規格(spec)が空」の
 * 取引先×商品を洗い出す（マスタ健全性・pull型）。
 * 規格未登録一覧ページとダッシュボードのアラートで共有する。
 */
export async function getMissingSpecs(admin: AdminClient): Promise<MissingSpec[]> {
  const [{ data: items }, { data: rules }] = await Promise.all([
    admin
      .from('order_items')
      .select('product_id, products(name), orders!inner(customer_id, status, customers(name))'),
    admin.from('customer_product_rules').select('customer_id, product_id, packs_per_case, spec'),
  ])

  const ruleMap = new Map<string, { packs: number | null; spec: string | null }>()
  for (const r of rules ?? []) {
    ruleMap.set(`${r.customer_id}:${r.product_id}`, {
      packs: r.packs_per_case as number | null,
      spec: (r.spec as string | null) ?? null,
    })
  }

  type Agg = { customerId: string; customerName: string; productName: string; count: number }
  const seen = new Map<string, Agg>()
  for (const it of items ?? []) {
    const ord = it.orders as unknown as {
      customer_id: string
      status: string
      customers: { name: string } | null
    } | null
    const prod = it.products as unknown as { name: string } | null
    const productId = it.product_id as string | null
    if (!ord || !productId) continue
    if (ord.status === 'cancelled') continue
    const key = `${ord.customer_id}:${productId}`
    const cur = seen.get(key)
    if (cur) {
      cur.count++
    } else {
      seen.set(key, {
        customerId: ord.customer_id,
        customerName: ord.customers?.name ?? '(不明な取引先)',
        productName: prod?.name ?? '(不明な商品)',
        count: 1,
      })
    }
  }

  return [...seen.entries()]
    .map(([key, agg]) => {
      const rule = ruleMap.get(key)
      const missingPacks = !rule || rule.packs == null
      const missingSpec = !rule || rule.spec == null || rule.spec.trim() === ''
      return { ...agg, missingPacks, missingSpec, hasRule: Boolean(rule) }
    })
    .filter((m) => m.missingPacks || m.missingSpec)
    .sort(
      (a, b) =>
        a.customerName.localeCompare(b.customerName, 'ja') ||
        b.count - a.count ||
        a.productName.localeCompare(b.productName, 'ja'),
    )
}
