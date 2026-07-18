import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import { ErrorState } from '@/components/ui/States'
import { OrderNewForm } from '@/components/admin/OrderNewForm'
import { getSetting } from '@/lib/settings'
import { requireAdmin } from '@/lib/auth/require-admin'

export const dynamic = 'force-dynamic'

/**
 * 注文新規入力画面（画面B）。
 * 取引先選択 → いつものセット展開 → 数量入力 → 確認 → 保存。
 * 手動入力は OCR を通さず直接 status='approved' で登録する。
 */
export default async function OrderNewPage() {
  const guard = await requireAdmin('注文入力は管理者のみアクセスできます。')
  if (guard) return guard

  const supabase = createClient()

  // QTY_INPUT_MODE 設定
  const qtyModeSetting = await getSetting('QTY_INPUT_MODE')
  const qtyInputMode = qtyModeSetting === 'cases' ? 'cases' : 'total'

  // 取引先・商品・デフォルトセットを並列取得
  const [customersRes, productsRes, defaultRulesRes] = await Promise.all([
    supabase
      .from('customers')
      .select('id, name, display_color')
      .eq('is_active', true)
      .order('name'),
    supabase
      .from('products')
      .select('id, name, unit, category, photo_url, default_tax_rate, default_unit_price')
      .eq('is_active', true)
      .order('category', { nullsFirst: false })
      .order('name'),
    supabase
      .from('customer_product_rules')
      .select('customer_id, product_id, packs_per_case, container_type, label_spec, is_default_set, default_quantity'),
  ])

  // マスタ取得の失敗を「空」に化けさせない（migration 未適用の顕在化・CLAUDE.md）。
  const masterErr = customersRes.error ?? productsRes.error ?? defaultRulesRes.error
  if (masterErr) {
    return (
      <ErrorState
        message="マスタデータを読み込めませんでした。時間をおいて再度お試しください。"
        detail={masterErr.message}
      />
    )
  }
  const customers = customersRes.data
  const products = productsRes.data
  const defaultRules = defaultRulesRes.data

  // 商品ごとの荷姿（共通＝customer_id null）を構築。注文入力の単位選択に使う。
  const { data: packRows, error: packErr } = await supabase
    .from('pack_configs')
    .select('id, product_id, label, selling_unit_label, base_per_selling')
    .is('customer_id', null)
    .eq('is_active', true)
  // 単位選択の補助。失敗しても既定単位で入力は続けられるので本体は殺さない。
  if (packErr) console.error('[orders/new] 荷姿マスタの取得に失敗:', packErr.message)
  const packsByProduct: Record<string, { id: string; label: string; selling_unit_label: string; base_per_selling: number }[]> = {}
  for (const p of packRows ?? []) {
    const arr = (packsByProduct[p.product_id] ??= [])
    arr.push({
      id: p.id,
      label: p.label,
      selling_unit_label: p.selling_unit_label,
      base_per_selling: Number(p.base_per_selling),
    })
  }

  // 取引先ごとのデフォルトセットを構築
  const productNameById = new Map((products ?? []).map((p) => [p.id, p.name]))
  const defaultSets: Record<string, {
    product_id: string
    product_name: string
    default_quantity: number | null
    packs_per_case: number | null
    container_type: string | null
    label_spec: string | null
  }[]> = {}

  for (const r of defaultRules ?? []) {
    if (!r.is_default_set) continue
    const arr = (defaultSets[r.customer_id] ??= [])
    arr.push({
      product_id: r.product_id,
      product_name: productNameById.get(r.product_id) ?? '不明',
      default_quantity: r.default_quantity != null ? Number(r.default_quantity) : null,
      packs_per_case: r.packs_per_case != null ? Number(r.packs_per_case) : null,
      container_type: r.container_type,
      label_spec: r.label_spec,
    })
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center gap-3">
        <Link
          href="/admin"
          className="inline-flex items-center gap-1 text-sm text-ink-soft hover:text-ink"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
          ダッシュボードへ
        </Link>
      </div>
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">注文を新規入力</h1>
        <p className="text-sm text-ink-soft">
          手動・電話注文など。入力した内容は即時「承認済み」として登録されます。
        </p>
      </div>
      <Card>
        <OrderNewForm
          customers={(customers ?? []).map((c) => ({
            id: c.id,
            name: c.name,
            display_color: c.display_color,
          }))}
          products={(products ?? []).map((p) => ({
            id: p.id,
            name: p.name,
            unit: p.unit,
            category: p.category,
            photo_url: p.photo_url,
            default_tax_rate: (p.default_tax_rate as 8 | 10),
            default_unit_price: p.default_unit_price != null ? Number(p.default_unit_price) : null,
          }))}
          defaultSets={defaultSets}
          packsByProduct={packsByProduct}
          qtyInputMode={qtyInputMode}
        />
      </Card>
    </div>
  )
}
