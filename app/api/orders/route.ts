import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

const itemSchema = z.object({
  product_id: z.string().uuid(),
  product_name: z.string().min(1),
  /** 総数（基準単位）。荷姿選択時は呼び出し側で base 換算済み。 */
  quantity: z.number().positive(),
  unit: z.string().min(1),
  unit_price: z.number().min(0).default(0),
  tax_rate: z.union([z.literal(8), z.literal(10)]).default(8),
  /** 荷姿（pack_config）。出荷表示・後の価格解決に使う。 */
  pack_config_id: z.string().uuid().nullish(),
  /** 入り数(P/C)。任意。未設定の規格マスタにのみ保存する（既存値は上書きしない）。 */
  packs_per_case: z.number().positive().nullish(),
})

const orderSchema = z.object({
  customer_id: z.string().uuid(),
  delivery_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  shipping_time: z.enum(['am', 'pm']).optional(),
  note: z.string().optional(),
  items: z.array(itemSchema).min(1),
  /** 同一取引先×納品日の既存注文があっても登録を強行する（重複警告を承認した）。 */
  confirm_duplicate: z.boolean().optional(),
})

/**
 * POST /api/orders
 * 手動注文登録（admin バックオフィス）。
 * 手動入力は admin が直接確認している扱いとして status='approved' で登録する。
 * 各明細の数量が過去90日の最大値の2.5倍を超える場合は warnings を返す（保存は通す）。
 */
export async function POST(req: NextRequest) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 })

  const supabase = createClient()
  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).maybeSingle()
  if (profile?.role !== 'admin') {
    return NextResponse.json({ error: '管理者権限が必要です' }, { status: 403 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'リクエストの解析に失敗しました' }, { status: 400 })
  }

  const parsed = orderSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: '入力値が不正です', details: parsed.error.flatten() }, { status: 422 })
  }

  const { customer_id, delivery_date, shipping_time, note, items, confirm_duplicate } = parsed.data
  const admin = createAdminClient()

  // 重複警告（dedupe.ts の sender_date_key と同思想：取引先×納品日）。
  // ブロックせず 409 で既存を知らせ、ユーザーが confirm_duplicate=true で再送信したら通す。
  if (!confirm_duplicate) {
    const { data: dupes } = await admin
      .from('orders')
      .select('id, created_at, order_items(count)')
      .eq('customer_id', customer_id)
      .eq('delivery_date', delivery_date)
      .neq('status', 'cancelled')
    if (dupes && dupes.length > 0) {
      return NextResponse.json(
        {
          duplicate: true,
          error: '同じ取引先・納品日の注文が既に存在します',
          existing: dupes.map((o) => ({
            id: o.id as string,
            created_at: o.created_at as string,
            item_count: (o.order_items as unknown as { count: number }[])?.[0]?.count ?? 0,
          })),
        },
        { status: 409 },
      )
    }
  }

  // 過去90日の同取引先×商品の最大数量を取得（異常値検知）
  const productIds = [...new Set(items.map((i) => i.product_id))]
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const { data: histOrders } = await admin
    .from('orders')
    .select('id')
    .eq('customer_id', customer_id)
    .gte('delivery_date', since)

  const histOrderIds = (histOrders ?? []).map((o) => o.id)
  const histStats: Record<string, { max: number; min: number; avg: number }> = {}
  if (histOrderIds.length > 0 && productIds.length > 0) {
    const { data: histItems } = await admin
      .from('order_items')
      .select('product_id, quantity')
      .in('order_id', histOrderIds)
      .in('product_id', productIds)

    const byProduct: Record<string, number[]> = {}
    for (const it of histItems ?? []) {
      ;(byProduct[it.product_id] ??= []).push(Number(it.quantity))
    }
    for (const [pid, qtys] of Object.entries(byProduct)) {
      const max = Math.max(...qtys)
      const min = Math.min(...qtys)
      const avg = qtys.reduce((a, b) => a + b, 0) / qtys.length
      histStats[pid] = { max, min, avg }
    }
  }

  const THRESHOLD = 2.5
  const warnings: Record<string, { type: 'high' | 'low'; ratio: number; histMax: number; histMin: number }> = {}
  for (const it of items) {
    const stats = histStats[it.product_id]
    if (!stats) continue
    if (it.quantity > stats.max * THRESHOLD) {
      warnings[it.product_id] = { type: 'high', ratio: it.quantity / stats.max, histMax: stats.max, histMin: stats.min }
    } else if (stats.min > 0 && it.quantity < stats.min / THRESHOLD) {
      warnings[it.product_id] = { type: 'low', ratio: it.quantity / stats.min, histMax: stats.max, histMin: stats.min }
    }
  }

  // 注文作成（approved で直接登録）
  const { data: order, error: orderErr } = await admin
    .from('orders')
    .insert({
      customer_id,
      source: 'manual',
      status: 'approved',
      order_date: new Date().toISOString().slice(0, 10),
      delivery_date,
      delivery_date_source: 'manual',
      shipping_time: shipping_time ?? null,
      note: note ?? null,
      created_by: user.id,
    })
    .select('id')
    .single()

  if (orderErr || !order) {
    console.error('[POST /api/orders] order insert error', orderErr)
    return NextResponse.json({ error: '注文の登録に失敗しました' }, { status: 500 })
  }

  const { error: itemsErr } = await admin.from('order_items').insert(
    items.map((it) => ({
      order_id: order.id,
      product_id: it.product_id,
      product_name: it.product_name,
      quantity: it.quantity,
      unit: it.unit,
      unit_price: it.unit_price,
      tax_rate: it.tax_rate,
      pack_config_id: it.pack_config_id ?? null,
    })),
  )

  if (itemsErr) {
    console.error('[POST /api/orders] items insert error', itemsErr)
    // ロールバック（order だけ残さない）
    await admin.from('orders').delete().eq('id', order.id)
    return NextResponse.json({ error: '明細の登録に失敗しました' }, { status: 500 })
  }

  // 入り数(P/C)を規格マスタに保存（未設定のときのみ。既存値は誤上書きしない）。
  // 注文本体は登録済みなので、ここでの失敗は注文を巻き戻さない（best-effort）。
  const withPacks = items.filter((it) => typeof it.packs_per_case === 'number' && it.packs_per_case > 0)
  if (withPacks.length > 0) {
    const pids = [...new Set(withPacks.map((it) => it.product_id))]
    const { data: existing } = await admin
      .from('customer_product_rules')
      .select('product_id, packs_per_case')
      .eq('customer_id', customer_id)
      .in('product_id', pids)
    const ruleByProduct = new Map((existing ?? []).map((r) => [r.product_id as string, r]))

    for (const it of withPacks) {
      const rule = ruleByProduct.get(it.product_id)
      try {
        if (!rule) {
          await admin.from('customer_product_rules').insert({
            customer_id,
            product_id: it.product_id,
            packs_per_case: it.packs_per_case,
          })
        } else if (rule.packs_per_case == null) {
          await admin
            .from('customer_product_rules')
            .update({ packs_per_case: it.packs_per_case })
            .eq('customer_id', customer_id)
            .eq('product_id', it.product_id)
        }
        // 既に入り数が入っている場合は上書きしない
      } catch (e) {
        console.error('[POST /api/orders] packs_per_case upsert skipped', e)
      }
    }
  }

  return NextResponse.json({ orderId: order.id, warnings })
}
