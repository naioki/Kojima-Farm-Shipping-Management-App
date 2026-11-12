import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthedUser } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { writeDroppingMissingColumns } from '@/lib/supabase/missing-column'
import { portalOrderInputSchema } from '@/types/database'
import { jstTodayStr } from '@/lib/dates'
import { determineHasCard, resolveContainerType } from '@/lib/pipeline/schemas'
import { loadDestDefaultContainer } from '@/lib/field/destination-routes-store'

export const runtime = 'nodejs'

const extendedPortalOrderSchema = portalOrderInputSchema.extend({
  destination_id: z.string().uuid().nullish(),
  note: z.string().max(1000).nullish(),
})

/**
 * B2Bポータルからの発注（features.md §2-3）。
 *   - 認証ユーザーの app_metadata.customer_id を信頼の起点にする
 *   - RLS で orders / order_items の INSERT が弾かれないよう、customer_id 検証後に createAdminClient() で確実に保存する
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
  const parsed = extendedPortalOrderSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid', detail: parsed.error.flatten() }, { status: 400 })
  }

  const admin = createAdminClient()

  // 納入先が指定されている場合は自社配下であることを検証
  let destRow: { id: string; code?: string | null; full_name?: string | null; default_container_type?: string | null } | null = null
  if (parsed.data.destination_id) {
    const { data: dest } = await admin
      .from('delivery_destinations')
      .select('*')
      .eq('id', parsed.data.destination_id)
      .eq('customer_id', customerId)
      .maybeSingle()
    if (!dest) {
      return NextResponse.json({ error: 'invalid_destination' }, { status: 400 })
    }
    destRow = dest
  }
  const { data: custRow } = await admin.from('customers').select('name').eq('id', customerId).maybeSingle()
  const custName = custRow?.name ?? ''
  const destName = destRow?.full_name || destRow?.code || ''
  // 規定コンテナは「列の値 → 退避ストアの値」（列が無い本番では退避ストアが唯一の保存先）
  const destDefaultContainer = await loadDestDefaultContainer(admin, destRow?.id, destRow?.default_container_type)

  // 商品マスタおよび取引ルールから単価・税率・規格・荷姿を確定（税率は注文時に冗長保持・tax.md）
  const productIds = parsed.data.items.map((i) => i.product_id)
  const [productsRes, rulesRes] = await Promise.all([
    admin
      .from('products')
      .select('id, name, default_unit_price, default_tax_rate, unit')
      .in('id', productIds),
    admin
      .from('customer_product_rules')
      .select('id, product_id, spec, label_spec, container_type, has_card')
      .eq('customer_id', customerId)
      .in('product_id', productIds),
  ])
  if (productsRes.error) return NextResponse.json({ error: productsRes.error.message }, { status: 500 })

  const byId = new Map((productsRes.data ?? []).map((p) => [p.id, p]))
  const ruleByProdId = new Map((rulesRes.data ?? []).map((r) => [r.product_id, r]))

  for (const it of parsed.data.items) {
    if (!byId.has(it.product_id)) {
      return NextResponse.json({ error: 'unknown_product', product_id: it.product_id }, { status: 400 })
    }
  }

  // 注文ヘッダー作成
  const { data: order, error: orderErr } = await admin
    .from('orders')
    .insert({
      customer_id: customerId,
      destination_id: parsed.data.destination_id ?? null,
      source: 'portal',
      status: 'pending_review',
      order_date: jstTodayStr(),
      delivery_date: parsed.data.delivery_date,
      delivery_date_source: 'manual',
      note: parsed.data.note?.trim() || null,
    })
    .select('id')
    .single()
  if (orderErr || !order) return NextResponse.json({ error: orderErr?.message ?? 'order insert failed' }, { status: 500 })

  // 明細作成（confidence=1.0）
  for (const it of parsed.data.items) {
    const p = byId.get(it.product_id)!
    const rule = ruleByProdId.get(it.product_id)
    const { error: itemsErr } = await writeDroppingMissingColumns(
      {
        order_id: order.id,
        product_id: it.product_id,
        product_name: p.name,
        quantity: it.quantity,
        unit: p.unit,
        unit_price: p.default_unit_price ?? 0,
        tax_rate: p.default_tax_rate,
        confidence: 1.0,
        rule_id: rule?.id ?? null,
        spec: rule?.spec ?? rule?.label_spec ?? null,
        container_type: resolveContainerType({
          ruleContainer: rule?.container_type ?? null,
          destDefaultContainer,
          clientName: custName,
          destination: destName,
          rawText: parsed.data.note ?? '',
        }),
        has_card: determineHasCard({
          ruleHasCard: typeof rule?.has_card === 'boolean' ? rule.has_card : null,
          clientName: custName,
          destination: destName,
          rawText: parsed.data.note ?? '',
        }),
      },
      (payload) => admin.from('order_items').insert(payload as never).select('id').single(),
    )
    if (itemsErr) {
      // 巻き戻し（先に入った明細は orders の ON DELETE CASCADE で一緒に消える）
      const { error: rollbackErr } = await admin.from('orders').delete().eq('id', order.id)
      if (rollbackErr) {
        console.error('[portal/orders] 巻き戻し（注文の削除）に失敗。作りかけの注文が残っています:', order.id, rollbackErr.message)
        return NextResponse.json(
          { error: `${itemsErr.message}（送信途中の注文の一部が残っている可能性があります。農園へご連絡ください）` },
          { status: 500 },
        )
      }
      return NextResponse.json({ error: itemsErr.message }, { status: 500 })
    }
  }

  return NextResponse.json({ order_id: order.id, status: 'pending_review' }, { status: 201 })
}
