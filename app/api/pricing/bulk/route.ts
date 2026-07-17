import 'server-only'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolvePrice, type PriceRule } from '@/lib/pricing/resolve'

export const runtime = 'nodejs'

const bodySchema = z.object({
  itemIds: z.array(z.string().uuid()).min(1),
  /** resolve=価格表から基準日で解決 / flat=一律単価を適用 */
  mode: z.enum(['resolve', 'flat']),
  unit_price: z.number().nonnegative().optional(),
  tax_rate: z.union([z.literal(8), z.literal(10)]).optional(),
  status: z.enum(['provisional', 'confirmed']).default('confirmed'),
})

/**
 * 価格の一括確定（管理者）。
 *   - flat: 指定単価・税率を選択明細すべてに適用
 *   - resolve: 各明細の（取引先・商品・荷姿・チャネル）と基準日（納品日）で price_rules を解決
 * 解決できない明細は skip して結果に返す（未設定のまま＝請求ゲートで止まる）。
 */
export async function POST(req: Request) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 })
  const supabase = createClient()
  const { data: profile, error: profileErr } = await supabase.from('users').select('role').eq('id', user.id).maybeSingle()
  // ロール解決の失敗は admin として扱わない（fail closed）。無言にせずログに残す。
  if (profileErr) console.error('[app/api/pricing/bulk/route.ts] ロールの取得に失敗:', profileErr.message)
  if (profile?.role !== 'admin') return NextResponse.json({ error: '価格確定は管理者のみです' }, { status: 403 })

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? '入力値が不正です' }, { status: 400 })
  }
  const { itemIds, mode, unit_price, tax_rate, status } = parsed.data
  if (mode === 'flat' && (unit_price == null || tax_rate == null)) {
    return NextResponse.json({ error: '一律適用には単価と税率が必要です' }, { status: 400 })
  }

  const admin = createAdminClient()
  const nowIso = new Date().toISOString()

  // 対象明細＋注文（取引先・チャネル・納品日）を取得
  const { data: items, error } = await admin
    .from('order_items')
    .select('id, product_id, pack_config_id, orders!inner(customer_id, source, delivery_date)')
    .in('id', itemIds)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!items || items.length === 0) return NextResponse.json({ updated: 0, skipped: [] })

  let rules: PriceRule[] = []
  if (mode === 'resolve') {
    const productIds = [...new Set(items.map((it) => it.product_id))]
    const { data: ruleRows, error: ruleRowsErr } = await admin
      .from('price_rules')
      .select('id, product_id, customer_id, pack_config_id, channel, price_unit, unit_price, tax_rate, effective_from, effective_to')
      .in('product_id', productIds)
    // 価格表の取得失敗を「該当ルールなし＝全件skip」に化けさせない。
    if (ruleRowsErr) return NextResponse.json({ error: `価格表の取得に失敗しました: ${ruleRowsErr.message}` }, { status: 500 })
    rules = (ruleRows ?? []) as PriceRule[]
  }

  let updated = 0
  const skipped: string[] = []

  for (const it of items) {
    const order = it.orders as unknown as { customer_id: string | null; source: string; delivery_date: string | null }
    let price: number
    let tax: 8 | 10

    if (mode === 'flat') {
      price = unit_price!
      tax = tax_rate!
    } else {
      const referenceDate = order.delivery_date ?? nowIso.slice(0, 10)
      const resolved = resolvePrice(rules, {
        productId: it.product_id,
        customerId: order.customer_id,
        packConfigId: it.pack_config_id,
        channel: order.source,
        referenceDate,
      })
      if (!resolved) {
        skipped.push(it.id)
        continue
      }
      price = resolved.rule.unit_price
      tax = resolved.rule.tax_rate
    }

    const { error: updErr } = await admin
      .from('order_items')
      .update({ unit_price: price, tax_rate: tax, price_status: status, priced_at: nowIso, priced_by: user.id })
      .eq('id', it.id)
    if (updErr) skipped.push(it.id)
    else updated++
  }

  return NextResponse.json({ updated, skipped })
}
