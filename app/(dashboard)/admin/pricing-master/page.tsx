import { Tag, Package } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { Card } from '@/components/ui/Card'
import { PackConfigManager, type PackConfigRow } from '@/components/admin/PackConfigManager'
import { PriceRuleManager, type PriceRuleListRow } from '@/components/admin/PriceRuleManager'
import { requireAdmin } from '@/lib/auth/require-admin'
import { ErrorState } from '@/components/ui/States'
import { positiveNumber } from '@/lib/masters/packs-per-case'

export const dynamic = 'force-dynamic'

/**
 * 単価・荷姿の設定（管理者）。
 * 荷姿（pack_configs）と価格表（price_rules）を一元管理する。
 * 過去の請求は order_items に凍結済みなので、ここの変更は遡及しない。
 */
export default async function PricingMasterPage() {
  const guard = await requireAdmin('単価・荷姿の設定は管理者のみです。')
  if (guard) return guard

  const supabase = createAdminClient()

  const [productsRes, customersRes, packsRes, pricesRes, rulesRes] = await Promise.all([
    supabase.from('products').select('id, name, base_unit').eq('is_active', true).order('name'),
    supabase.from('customers').select('id, name').eq('is_active', true).order('name'),
    supabase
      .from('pack_configs')
      .select('id, product_id, customer_id, label, selling_unit_label, base_per_selling, needs_manual_confirm, spec_note, has_card, has_seal, tape_color, label_spec, price_tag_required, returnable_container, quality_note, standing_notes, field_memo')
      .eq('is_active', true)
      .order('created_at', { ascending: false }),
    supabase
      .from('price_rules')
      .select('id, product_id, customer_id, channel, price_unit, unit_price, tax_rate, effective_from, effective_to')
      .order('effective_from', { ascending: false }),
    // 荷姿より優先される「取引先別の設定」の入数（荷姿の行に注記するため）
    supabase.from('customer_product_rules').select('customer_id, product_id, packs_per_case'),
  ])

  // クエリエラーを空表示に化けさせない（CLAUDE.md: NEVER swallow errors）。
  // 特に migration 未適用時の「column does not exist」はここで顕在化させる。
  const queryError =
    productsRes.error ?? customersRes.error ?? packsRes.error ?? pricesRes.error ?? rulesRes.error
  if (queryError) return <ErrorState message={`単価・荷姿を読み込めませんでした: ${queryError.message}`} />

  const { data: products } = productsRes
  const { data: customers } = customersRes
  const { data: packs } = packsRes
  const { data: prices } = pricesRes

  const productOpts = (products ?? []).map((p) => ({ id: p.id, name: p.name, base_unit: p.base_unit ?? undefined }))
  const customerOpts = (customers ?? []).map((c) => ({ id: c.id, name: c.name }))
  const rulePacksByPair: Record<string, number> = {}
  for (const r of rulesRes.data ?? []) {
    const v = positiveNumber(r.packs_per_case)
    if (v != null) rulePacksByPair[`${r.customer_id}:${r.product_id}`] = v
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">単価・荷姿の設定</h1>
        <p className="text-sm text-ink-soft">
          荷姿（ケース・箱など）と単価（期間×取引先）を管理します。過去の請求には遡及しません。
        </p>
      </div>

      <Card className="space-y-3">
        <h2 className="flex items-center gap-1.5 font-display text-base font-bold text-ink">
          <Package className="h-4 w-4 text-earth-600" aria-hidden />
          荷姿
        </h2>
        <p className="text-xs text-ink-soft">
          1箱の入数は「取引先別の設定」→「荷姿」→「品目の標準1箱入数」→ 20 の順で使われます。取引先別の設定があればそちらが優先です。
        </p>
        <PackConfigManager
          products={productOpts}
          customers={customerOpts}
          rows={(packs ?? []) as PackConfigRow[]}
          rulePacksByPair={rulePacksByPair}
        />
      </Card>

      <Card className="space-y-3">
        <h2 className="flex items-center gap-1.5 font-display text-base font-bold text-ink">
          <Tag className="h-4 w-4 text-earth-600" aria-hidden />
          単価表（期間×取引先）
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
