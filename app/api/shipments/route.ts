import { NextResponse } from 'next/server'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { shipmentAddSchema } from '@/types/database'
import { parseQuantity } from '@/lib/calculations/parse-quantity'
import { writeAudit } from '@/lib/audit/log'

export const runtime = 'nodejs'

/**
 * 出荷一覧の「スマート追加」（Laravel版 画面2）。手動入力チャネル。
 *   - 数量はスマートパース（"15c2" など）。c記法は customer_product_rules.packs_per_case で換算。
 *   - 同一 (取引先 × 出荷日 × source='manual') の注文があれば再利用、無ければ作成。
 *   - 税率・単価・名称は商品マスタから確定して order_items に冗長保持（tax.md）。
 *     ※ products.default_tax_rate は「マスタ既定の取得」であり、計算には order_items.tax_rate を使う。
 */
export async function POST(req: Request) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const parsed = shipmentAddSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid', detail: parsed.error.flatten() }, { status: 400 })
  }
  const { customer_id, product_id, delivery_date, quantity_raw, destination_id } = parsed.data
  const supabase = createClient()

  // 納入先が指定されたら、その取引先の配下（有効）であることを検証（他取引先の届け先を混入させない）。
  if (destination_id) {
    const { data: dest, error: destErr } = await supabase
      .from('delivery_destinations')
      .select('id')
      .eq('id', destination_id)
      .eq('customer_id', customer_id)
      .eq('is_active', true)
      .maybeSingle()
    if (destErr) return NextResponse.json({ error: destErr.message }, { status: 500 })
    if (!dest) return NextResponse.json({ error: 'invalid_destination' }, { status: 400 })
  }

  // 商品マスタ（単価・税率・名称・単位）
  const { data: product, error: prodErr } = await supabase
    .from('products')
    .select('id, name, unit, default_unit_price, default_tax_rate')
    .eq('id', product_id)
    .maybeSingle()
  if (prodErr) return NextResponse.json({ error: prodErr.message }, { status: 500 })
  if (!product) return NextResponse.json({ error: 'unknown_product' }, { status: 400 })

  // 取引先×商品ルール（P/C＝c記法換算の基準値）
  const { data: rule, error: ruleErr } = await supabase
    .from('customer_product_rules')
    .select('id, packs_per_case, spec, container_type, has_card')
    .eq('customer_id', customer_id)
    .eq('product_id', product_id)
    .maybeSingle()
  // P/C は c記法換算の補助（未設定でも動く）。取得失敗しても続行するが無言にはしない。
  if (ruleErr) console.error('[api/shipments] P/Cルールの取得に失敗:', ruleErr.message)

  // スマートパース（誤解釈防止のため lib に集約・Decimal.js）
  const result = parseQuantity(quantity_raw, { packsPerCase: rule?.packs_per_case ?? null })
  if (result.type === 'delete') {
    return NextResponse.json({ error: 'empty_quantity' }, { status: 400 })
  }
  if (result.type === 'error') {
    // c記法なのに P/C 未設定 → 取引先設定で登録してもらう（勝手に推測しない）
    return NextResponse.json({ error: result.reason, input: result.input }, { status: 400 })
  }

  // 同一 (取引先 × 納入先 × 出荷日 × manual) の注文を再利用、無ければ作成。
  // 納入先が別なら別注文として分ける（表示は常に「取引先＞納入先」。届け先違いを1注文に混ぜない）。
  const findQuery = supabase
    .from('orders')
    .select('id')
    .eq('customer_id', customer_id)
    .eq('delivery_date', delivery_date)
    .eq('source', 'manual')
  const { data: existing, error: findErr } = await (
    destination_id ? findQuery.eq('destination_id', destination_id) : findQuery.is('destination_id', null)
  )
    .limit(1)
    .maybeSingle()
  if (findErr) return NextResponse.json({ error: findErr.message }, { status: 500 })

  let orderId = existing?.id
  if (!orderId) {
    const { data: order, error: orderErr } = await supabase
      .from('orders')
      .insert({
        customer_id,
        destination_id: destination_id ?? null,
        source: 'manual',
        status: 'approved',
        delivery_date,
        delivery_date_source: 'manual',
        created_by: user.id,
      })
      .select('id')
      .single()
    if (orderErr) return NextResponse.json({ error: orderErr.message }, { status: 500 })
    orderId = order.id
  }

  // 明細作成（税率は注文時確定値を冗長保持・confidence=1.0 は人間入力）
  const { data: item, error: itemErr } = await supabase
    .from('order_items')
    .insert({
      order_id: orderId,
      product_id,
      product_name: product.name,
      quantity: result.total.toNumber(),
      unit: product.unit,
      unit_price: product.default_unit_price ?? 0,
      tax_rate: product.default_tax_rate,
      rule_id: rule?.id ?? null,
      confidence: 1.0,
      field_status: 'not_started',
      // 荷姿を規則から自動補完（出荷ごとにアコーディオンで上書き可）
      spec: rule?.spec ?? null,
      container_type: rule?.container_type ?? null,
      has_card: rule?.has_card ?? null,
    })
    .select()
    .single()
  if (itemErr) return NextResponse.json({ error: itemErr.message }, { status: 500 })

  await writeAudit(supabase, {
    entityType: 'order_items',
    entityId: item.id,
    action: 'INSERT',
    oldValues: null,
    newValues: item,
    userId: user.id,
  })

  return NextResponse.json({ item }, { status: 201 })
}
