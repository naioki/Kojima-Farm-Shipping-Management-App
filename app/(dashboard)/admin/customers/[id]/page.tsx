import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { CustomerRulesEditor, type RuleRow } from '@/components/admin/CustomerRulesEditor'
import type { FractionPolicy } from '@/types/database'

export const dynamic = 'force-dynamic'

/**
 * 取引先 詳細（Laravel版 画面5）。
 * 品目ごとの P/C・荷姿・「いつものセット」・端数ポリシーを編集する。
 * P/C はスマートパース（"15c2" 換算）と出荷指示書の基準値。
 */
export default async function CustomerDetailPage({ params }: { params: { id: string } }) {
  const supabase = createClient()

  const [{ data: customer, error: custErr }, { data: products, error: prodErr }, { data: rules }] =
    await Promise.all([
      supabase.from('customers').select('id, name, name_kana').eq('id', params.id).maybeSingle(),
      supabase.from('products').select('id, name, unit').eq('is_active', true).order('name'),
      supabase
        .from('customer_product_rules')
        .select('product_id, packs_per_case, container_type, spec, has_card, is_default_set, default_quantity, fraction_policy')
        .eq('customer_id', params.id),
    ])
  if (custErr) return <ErrorState message={custErr.message} />
  if (prodErr) return <ErrorState message={prodErr.message} />
  if (!customer) return <ErrorState title="取引先が見つかりません" message="削除されたか、IDが不正です。" />

  const initialRules: Record<string, RuleRow> = {}
  for (const r of rules ?? []) {
    initialRules[r.product_id] = {
      packs_per_case: r.packs_per_case,
      container_type: r.container_type,
      spec: r.spec,
      has_card: r.has_card,
      is_default_set: r.is_default_set,
      default_quantity: r.default_quantity,
      fraction_policy: r.fraction_policy as FractionPolicy,
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <Link
        href="/admin/customers"
        className="inline-flex items-center gap-1 text-sm text-trust-600 hover:underline"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden />
        取引先一覧
      </Link>

      <div>
        <h1 className="font-display text-2xl font-bold text-ink">{customer.name}</h1>
        {customer.name_kana && <p className="text-sm text-ink-faint">{customer.name_kana}</p>}
      </div>

      <Card className="space-y-3">
        <div>
          <h2 className="font-display text-base font-bold text-ink">取引ルール（品目別）</h2>
          <p className="text-sm text-ink-soft">
            P/C はケース記法（例 <span className="num">15c2</span>）の換算基準。「いつものセット」はポータルの初期表示に使われます。
          </p>
        </div>
        {!products?.length ? (
          <EmptyState title="商品がありません" description="商品マスタを登録すると編集できます。" />
        ) : (
          <CustomerRulesEditor
            customerId={customer.id}
            products={products.map((p) => ({ id: p.id, name: p.name, unit: p.unit }))}
            initialRules={initialRules}
          />
        )}
      </Card>
    </div>
  )
}
