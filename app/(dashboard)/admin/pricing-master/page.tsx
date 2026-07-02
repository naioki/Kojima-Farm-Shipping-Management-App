import { Tag, Package } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import { PackConfigManager, type PackConfigRow } from '@/components/admin/PackConfigManager'
import { PriceRuleManager, type PriceRuleListRow } from '@/components/admin/PriceRuleManager'
import { requireAdmin } from '@/lib/auth/require-admin'

export const dynamic = 'force-dynamic'

/**
 * 価格・荷姿マスタ（管理者）。
 * 荷姿（pack_configs）と価格表（price_rules）を一元管理する。
 * 過去の請求は order_items に凍結済みなので、ここの変更は遡及しない。
 */
export default async function PricingMasterPage() {
  const guard = await requireAdmin('価格・荷姿マスタは管理者のみです。')
  if (guard) return guard

  const supabase = createClient()

  const [{ data: products }, { data: customers }, { data: packs }, { data: prices }] = await Promise.all([
    supabase.from('products').select('id, name, base_unit').eq('is_active', true).order('name'),
    supabase.from('customers').select('id, name').eq('is_active', true).order('name'),
    supabase
      .from('pack_configs')
      .select('id, product_id, customer_id, label, selling_unit_label, base_per_selling, needs_manual_confirm')
      .eq('is_active', true)
      .order('created_at', { ascending: false }),
    supabase
      .from('price_rules')
      .select('id, product_id, customer_id, channel, price_unit, unit_price, tax_rate, effective_from, effective_to')
      .order('effective_from', { ascending: false }),
  ])

  const productOpts = (products ?? []).map((p) => ({ id: p.id, name: p.name }))
  const customerOpts = (customers ?? []).map((c) => ({ id: c.id, name: c.name }))

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">単価・荷姿マスタ</h1>
        <p className="text-sm text-ink-soft">
          荷姿（多形態）と価格（期間×取引先）を管理します。過去の請求には遡及しません。
        </p>
      </div>

      <Card className="space-y-3">
        <h2 className="flex items-center gap-1.5 font-display text-base font-bold text-ink">
          <Package className="h-4 w-4 text-earth-600" aria-hidden />
          荷姿マスタ
        </h2>
        <PackConfigManager
          products={productOpts}
          customers={customerOpts}
          rows={(packs ?? []) as PackConfigRow[]}
        />
      </Card>

      <Card className="space-y-3">
        <h2 className="flex items-center gap-1.5 font-display text-base font-bold text-ink">
          <Tag className="h-4 w-4 text-earth-600" aria-hidden />
          価格表（期間×取引先）
        </h2>
        <PriceRuleManager
          products={productOpts}
          customers={customerOpts}
          rows={(prices ?? []) as PriceRuleListRow[]}
        />
      </Card>
    </div>
  )
}
