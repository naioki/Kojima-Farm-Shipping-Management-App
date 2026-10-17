import { NextResponse } from 'next/server'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { portalOrderInputSchema } from '@/types/database'

export const runtime = 'nodejs'

/**
 * B2Bポータルからの発注（features.md §2-3）。
 *   - 認証ユーザーの app_metadata.customer_id を信頼の起点にする（RLS と一致）
 *   - source='portal'、status='pending_review'、confidence は常に 1.0（人間入力扱い）
 *   - delivery_date 必須（Zod で検証）
 * OCR を通さない構造化入力なので Gemini 不要（無料枠を消費しない）。
 */
export async function POST(req: Request) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const customerId = (user.app_metadata as { customer_id?: string } | undefined)?.customer_id
  if (!customerId) {
    return NextResponse.json({ error: 'not_a_portal_customer' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  const parsed = portalOrderInputSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid', detail: parsed.error.flatten() }, { status: 400 })
  }

  const supabase = createClient()

  // 商品マスタから単価・税率・名称を確定（税率は注文時に冗長保持・tax.md）
  const productIds = parsed.data.items.map((i) => i.product_id)
  const { data: products, error: prodErr } = await supabase
    .from('products')
    .select('id, name, default_unit_price, default_tax_rate, unit')
    .in('id', productIds)
  if (prodErr) return NextResponse.json({ error: prodErr.message }, { status: 500 })

  const byId = new Map((products ?? []).map((p) => [p.id, p]))
  for (const it of parsed.data.items) {
    if (!byId.has(it.product_id)) {
      return NextResponse.json({ error: 'unknown_product', product_id: it.product_id }, { status: 400 })
    }
  }

  // 注文ヘッダー作成
  const { data: order, error: orderErr } = await supabase
    .from('orders')
    .insert({
      customer_id: customerId,
      source: 'portal',
      status: 'pending_review',
      delivery_date: parsed.data.delivery_date,
      delivery_date_source: 'manual',
    })
    .select('id')
    .single()
  if (orderErr) return NextResponse.json({ error: orderErr.message }, { status: 500 })

  // 明細作成（confidence=1.0）
  const items = parsed.data.items.map((it) => {
    const p = byId.get(it.product_id)!
    return {
      order_id: order.id,
      product_id: it.product_id,
      product_name: p.name,
      quantity: it.quantity,
      unit: p.unit,
      unit_price: p.default_unit_price ?? 0,
      tax_rate: p.default_tax_rate,
      confidence: 1.0,
    }
  })
  const { error: itemsErr } = await supabase.from('order_items').insert(items)
  if (itemsErr) return NextResponse.json({ error: itemsErr.message }, { status: 500 })

  return NextResponse.json({ order_id: order.id, status: 'pending_review' }, { status: 201 })
}
