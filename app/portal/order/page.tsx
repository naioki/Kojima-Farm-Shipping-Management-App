import { redirect } from 'next/navigation'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { OrderForm, type DefaultSetItem } from '@/components/portal/OrderForm'
import { jstTodayStr, shiftDateStr } from '@/lib/dates'

export const dynamic = 'force-dynamic'

/**
 * ポータル発注画面（features.md §2-3）。
 * 「いつものセット」（customer_product_rules.is_default_set）を自動表示。
 * RLS により自社の customer_id のデータのみ可視。
 */
export default async function PortalOrderPage() {
  const user = await getAuthedUser()
  if (!user) redirect('/portal/login')

  const customerId = (user.app_metadata as { customer_id?: string } | undefined)?.customer_id
  if (!customerId) return <ErrorState message="この発注ポータルの利用権限がありません。" />

  const supabase = createClient()
  const { data: rules, error } = await supabase
    .from('customer_product_rules')
    .select('product_id, default_quantity, products!inner(name)')
    .eq('customer_id', customerId)
    .eq('is_default_set', true)

  if (error) return <ErrorState message={error.message} />

  const items: DefaultSetItem[] = (rules ?? []).map((r) => ({
    productId: r.product_id,
    productName: (r as unknown as { products: { name: string } }).products.name,
    defaultQuantity: Number(r.default_quantity ?? 0),
  }))

  const tomorrow = shiftDateStr(jstTodayStr(), 1)

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold text-ink">いつものセットで発注</h1>
      {!items.length ? (
        <EmptyState title="定番セットが未登録です" description="担当者にお問い合わせください。" />
      ) : (
        <OrderForm items={items} defaultDeliveryDate={tomorrow} />
      )}
    </div>
  )
}
