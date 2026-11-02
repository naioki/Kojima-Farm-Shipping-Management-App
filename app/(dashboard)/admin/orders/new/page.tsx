import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { Card } from '@/components/ui/Card'
import { ErrorState } from '@/components/ui/States'
import { OrderNewForm } from '@/components/admin/OrderNewForm'
import { ShipmentAddForm } from '@/components/field/ShipmentAddForm'
import { jstTodayStr, shiftDateStr } from '@/lib/dates'
import { getSetting } from '@/lib/settings'
import { requireAdmin } from '@/lib/auth/require-admin'

export const dynamic = 'force-dynamic'

/**
 * 注文新規入力画面（画面B）。
 * - 上部に【AIスマート注文読取】ドロップ枠を常設（FAX画像・PDF・写真・Excel・テキスト貼付対応）。
 * - AIが迷った箇所のみ【AI質問カード】で提示しつつ、抽出内容は即座に下部フォームへ自動反映。
 * - 取引先・納入先のその場でのワンストップ新規作成、3連動数量入力（箱数×入数＋端数＝総数）、
 *   既存注文がある場合の「合算（追加）／上書き（置換）／別便追加」に完全対応。
 * - 手動入力・AI読取入力のどちらも直接 status='approved' で登録し、出荷日前日の収穫タスクを自動生成する。
 */
export default async function OrderNewPage() {
  const guard = await requireAdmin('注文入力は管理者のみアクセスできます。')
  if (guard) return guard

  // RLSによるマスタ取得漏れ（pack_configs 等）を防ぐため createAdminClient() を使用（GEMINI.md §1）
  const admin = createAdminClient()

  // QTY_INPUT_MODE 設定
  const qtyModeSetting = await getSetting('QTY_INPUT_MODE')
  const qtyInputMode = qtyModeSetting === 'cases' ? 'cases' : 'total'

  // 取引先・商品・取引ルール・納入先・荷姿マスタを並列取得
  const [customersRes, productsRes, defaultRulesRes, destinationsRes, packRowsRes] = await Promise.all([
    admin
      .from('customers')
      .select('id, name, display_color')
      .eq('is_active', true)
      .order('name'),
    admin
      .from('products')
      .select('id, name, unit, category, photo_url, default_tax_rate, default_unit_price')
      .eq('is_active', true)
      .order('category', { nullsFirst: false })
      .order('name'),
    admin
      .from('customer_product_rules')
      .select('customer_id, product_id, packs_per_case, container_type, spec, label_spec, has_card, is_default_set, default_quantity'),
    admin
      .from('delivery_destinations')
      .select('id, customer_id, code, full_name, aliases')
      .eq('is_active', true)
      .order('sort_order'),
    admin
      .from('pack_configs')
      .select('id, product_id, customer_id, label, selling_unit_label, base_per_selling')
      .eq('is_active', true),
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
  const customers = customersRes.data ?? []
  const products = productsRes.data ?? []
  const defaultRules = defaultRulesRes.data ?? []
  const destinations = destinationsRes.data ?? []
  if (packRowsRes.error) console.error('[orders/new] 荷姿マスタの取得に失敗:', packRowsRes.error.message)

  // 商品ごとの荷姿（共通 customer_id=null ＋ 取引先別 customer_id 指定の両方）を構築
  const packsByProduct: Record<
    string,
    { id: string; customer_id: string | null; label: string; selling_unit_label: string; base_per_selling: number }[]
  > = {}
  for (const p of packRowsRes.data ?? []) {
    const arr = (packsByProduct[p.product_id] ??= [])
    arr.push({
      id: p.id,
      customer_id: p.customer_id ?? null,
      label: p.label,
      selling_unit_label: p.selling_unit_label,
      base_per_selling: Number(p.base_per_selling),
    })
  }

  // 取引先ごとのデフォルトセット＆取引先×品目ルールを構築
  const productNameById = new Map(products.map((p) => [p.id, p.name]))
  const defaultSets: Record<
    string,
    {
      product_id: string
      product_name: string
      default_quantity: number | null
      packs_per_case: number | null
      container_type: string | null
      label_spec: string | null
      spec?: string | null
      has_card?: boolean | null
    }[]
  > = {}
  const customerRulesByPair: Record<
    string,
    {
      packs_per_case: number | null
      container_type: string | null
      spec: string | null
      has_card: boolean | null
    }
  > = {}

  for (const r of defaultRules) {
    const ruleRec = r as Record<string, unknown>
    const ppc = r.packs_per_case != null ? Number(r.packs_per_case) : null
    const specStr = (typeof ruleRec.spec === 'string' && ruleRec.spec) || r.label_spec || null
    const hasCardVal = typeof ruleRec.has_card === 'boolean' ? ruleRec.has_card : null

    customerRulesByPair[`${r.customer_id}:${r.product_id}`] = {
      packs_per_case: ppc,
      container_type: r.container_type,
      spec: specStr,
      has_card: hasCardVal,
    }

    if (!r.is_default_set) continue
    const arr = (defaultSets[r.customer_id] ??= [])
    arr.push({
      product_id: r.product_id,
      product_name: productNameById.get(r.product_id) ?? '不明',
      default_quantity: r.default_quantity != null ? Number(r.default_quantity) : null,
      packs_per_case: ppc,
      container_type: r.container_type,
      label_spec: r.label_spec,
      spec: specStr,
      has_card: hasCardVal,
    })
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center justify-between gap-3">
        <Link
          href="/admin"
          className="inline-flex items-center gap-1 text-sm text-ink-soft hover:text-ink"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
          ダッシュボードへ
        </Link>
        <Link
          href="/admin/orders"
          className="text-xs font-medium text-trust-600 hover:underline"
        >
          受注一覧を見る →
        </Link>
      </div>
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">注文を新規入力</h1>
        <p className="text-sm text-ink-soft">
          FAX画像・PDF・写真・Excel・テキストからAIスマート一括読取（生協連の週間表切替・6関西余白内訳分割・既存差分比較対応）するか、下のフォームから手動入力できます。
        </p>
      </div>
      <ShipmentAddForm
        deliveryDate={shiftDateStr(jstTodayStr(), 1)}
        customers={customers.map((c) => ({ id: c.id, name: c.name }))}
        products={products.map((p) => ({ id: p.id, name: p.name, unit: p.unit, category: p.category }))}
        destinations={destinations.map((d) => ({
          id: d.id,
          customerId: d.customer_id ?? '',
          label: d.code?.trim() || d.full_name,
        }))}
        packsByPair={Object.fromEntries(
          Object.entries(customerRulesByPair).map(([k, v]) => [k, v.packs_per_case]),
        )}
      />
      <Card>
        <OrderNewForm
          customers={customers.map((c) => ({
            id: c.id,
            name: c.name,
            display_color: c.display_color,
          }))}
          destinations={destinations.map((d) => ({
            id: d.id,
            customer_id: d.customer_id,
            code: d.code,
            full_name: d.full_name,
          }))}
          products={products.map((p) => ({
            id: p.id,
            name: p.name,
            unit: p.unit,
            category: p.category,
            photo_url: p.photo_url,
            default_tax_rate: p.default_tax_rate as 8 | 10,
            default_unit_price: p.default_unit_price != null ? Number(p.default_unit_price) : null,
          }))}
          defaultSets={defaultSets}
          customerRulesByPair={customerRulesByPair}
          packsByProduct={packsByProduct}
          qtyInputMode={qtyInputMode}
        />
      </Card>
    </div>
  )
}
