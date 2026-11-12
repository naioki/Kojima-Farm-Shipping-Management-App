import { redirect } from 'next/navigation'
import { getAuthedUser } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { OrderForm, type DefaultSetItem } from '@/components/portal/OrderForm'
import { jstTodayStr, shiftDateStr } from '@/lib/dates'

export const dynamic = 'force-dynamic'

/**
 * ポータル発注画面（features.md §2-3）。
 * 「いつものセット」（customer_product_rules.is_default_set）を自動表示し、
 * 定番セットが未登録の取引先でも取引ルール登録品目または農園の主力品目からそのまま発注できるようにする。
 */
export default async function PortalOrderPage() {
  const user = await getAuthedUser()
  if (!user) redirect('/portal/login')

  const customerId = (user.app_metadata as { customer_id?: string } | undefined)?.customer_id
  if (!customerId) return <ErrorState message="この発注ポータルの利用権限がありません。" />

  const admin = createAdminClient()
  const [rulesRes, allProductsRes, destinationsRes] = await Promise.all([
    admin
      .from('customer_product_rules')
      .select('product_id, default_quantity, packs_per_case, is_default_set, products!inner(name, unit, is_active)')
      .eq('customer_id', customerId),
    admin
      .from('products')
      .select('id, name, unit, category')
      .eq('is_active', true)
      .order('name'),
    admin
      .from('delivery_destinations')
      .select('id, code, full_name')
      .eq('customer_id', customerId)
      .eq('is_active', true)
      .order('sort_order'),
  ])

  if (rulesRes.error) return <ErrorState message={rulesRes.error.message} />
  // 品目・納入先が取れないまま「発注可能な品目がありません」と出すと誤解を招くため、エラーとして出す
  if (allProductsRes.error) return <ErrorState message={allProductsRes.error.message} />
  if (destinationsRes.error) return <ErrorState message={destinationsRes.error.message} />

  const allRules = rulesRes.data ?? []
  const defaultRules = allRules.filter((r) => r.is_default_set)
  const effectiveRules = defaultRules.length > 0 ? defaultRules : allRules

  let items: DefaultSetItem[] = effectiveRules.map((r) => {
    const prod = (r as unknown as { products: { name: string; unit?: string } }).products
    return {
      productId: r.product_id,
      productName: prod.name,
      unit: prod.unit ?? '袋',
      defaultQuantity: Number(r.default_quantity ?? r.packs_per_case ?? 20),
    }
  })

  // 取引ルールがまだ1件もない取引先の場合は、資材以外の有効品目をフォールバック表示
  if (items.length === 0 && (allProductsRes.data ?? []).length > 0) {
    items = (allProductsRes.data ?? [])
      .filter((p) => p.category !== '資材')
      .map((p) => ({
        productId: p.id,
        productName: p.name,
        unit: p.unit || '袋',
        defaultQuantity: 0,
      }))
  }

  const destinations = (destinationsRes.data ?? []).map((d) => ({
    id: d.id,
    label: d.code?.trim() || d.full_name,
  }))

  const tomorrow = shiftDateStr(jstTodayStr(), 1)

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold text-ink">いつものセットで発注</h1>
      {!items.length ? (
        <EmptyState title="発注可能な品目がありません" description="担当者にお問い合わせください。" />
      ) : (
        <OrderForm
          items={items}
          destinations={destinations}
          defaultDeliveryDate={tomorrow}
        />
      )}
    </div>
  )
}
