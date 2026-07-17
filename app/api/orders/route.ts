import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { jstTodayStr } from '@/lib/dates'

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
  /** 納入先（取引先配下の届け先）。任意。 */
  destination_id: z.string().uuid().nullish(),
  delivery_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  shipping_time: z.enum(['am', 'pm']).optional(),
  note: z.string().optional(),
  items: z.array(itemSchema).min(1),
  /** 同一取引先×納品日の既存注文があっても新規として登録を強行する（重複警告を承認した）。 */
  confirm_duplicate: z.boolean().optional(),
  /** 指定すると新規INSERTでなく、この注文を置き換える（訂正・再送）。 */
  replace_order_id: z.string().uuid().optional(),
  /** 置換時の楽観ロック。取得時の orders.updated_at と一致しないと409（他の人が触った）。 */
  expected_updated_at: z.string().optional(),
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
  const { data: profile, error: profileErr } = await supabase.from('users').select('role').eq('id', user.id).maybeSingle()
  // ロール解決の失敗は admin として扱わない（fail closed）。無言にせずログに残す。
  if (profileErr) console.error('[app/api/orders/route.ts] ロールの取得に失敗:', profileErr.message)
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

  const {
    customer_id,
    destination_id,
    delivery_date,
    shipping_time,
    note,
    items,
    confirm_duplicate,
    replace_order_id,
    expected_updated_at,
  } = parsed.data
  const admin = createAdminClient()

  // 重複警告（dedupe.ts の sender_date_key と同思想：取引先×納入先×納品日）。
  // ブロックせず 409 で既存を知らせ、ユーザーが「追加」か「置き換え」かを選んだら通す。
  // replace_order_id 指定時は、その置き換え先が既に確認済みなのでこの検知はスキップする。
  if (!confirm_duplicate && !replace_order_id) {
    let dupeQuery = admin
      .from('orders')
      .select('id, created_at, updated_at, order_items(count)')
      .eq('customer_id', customer_id)
      .eq('delivery_date', delivery_date)
      .neq('status', 'cancelled')
    // 納入先が指定されていれば同じ納入先のみ、無ければ納入先なしの注文のみを重複対象にする
    dupeQuery = destination_id ? dupeQuery.eq('destination_id', destination_id) : dupeQuery.is('destination_id', null)
    const { data: dupes } = await dupeQuery
    if (dupes && dupes.length > 0) {
      return NextResponse.json(
        {
          duplicate: true,
          error: '同じ取引先・納品日の注文が既に存在します',
          existing: dupes.map((o) => ({
            id: o.id as string,
            created_at: o.created_at as string,
            updated_at: o.updated_at as string,
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

  let orderId: string
  let replaced = false

  if (replace_order_id) {
    // 置き換え（訂正・再送）。「取引先を間違えてFAXが2件になった」等の事故を、
    // 新規並存でなくこの注文を上書きする形で解消する（features.md §6のUndo思想＝audit_logに必ず残す）。
    const { data: existingOrder, error: fetchErr } = await admin
      .from('orders')
      .select('id, status, updated_at, delivery_date, destination_id')
      .eq('id', replace_order_id)
      .maybeSingle()

    if (fetchErr || !existingOrder) {
      return NextResponse.json({ error: '置き換え対象の注文が見つかりません' }, { status: 404 })
    }
    if (existingOrder.status === 'shipped' || existingOrder.status === 'invoiced') {
      return NextResponse.json(
        { error: '出荷済み・請求済みの注文は置き換えできません。別の注文として登録してください。' },
        { status: 409 },
      )
    }
    if (expected_updated_at && existingOrder.updated_at !== expected_updated_at) {
      return NextResponse.json(
        { error: '他の人がこの注文を変更しました。画面を更新してから、もう一度お試しください。', conflict: true },
        { status: 409 },
      )
    }

    const { data: oldItems } = await admin
      .from('order_items')
      .select('product_id, product_name, quantity, unit, unit_price, tax_rate, pack_config_id')
      .eq('order_id', replace_order_id)

    const { error: delErr } = await admin.from('order_items').delete().eq('order_id', replace_order_id)
    if (delErr) {
      console.error('[POST /api/orders] replace: delete old items failed', delErr)
      return NextResponse.json({ error: '既存明細の削除に失敗しました' }, { status: 500 })
    }

    const { error: updErr } = await admin
      .from('orders')
      .update({
        customer_id,
        destination_id: destination_id ?? null,
        delivery_date,
        delivery_date_source: 'manual',
        shipping_time: shipping_time ?? null,
        note: note ?? null,
      })
      .eq('id', replace_order_id)
    if (updErr) {
      console.error('[POST /api/orders] replace: order update failed', updErr)
      return NextResponse.json({ error: '注文の更新に失敗しました' }, { status: 500 })
    }

    const { error: itemsErr } = await admin.from('order_items').insert(
      items.map((it) => ({
        order_id: replace_order_id,
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
      console.error('[POST /api/orders] replace: items insert error', itemsErr)
      return NextResponse.json({ error: '新しい明細の登録に失敗しました' }, { status: 500 })
    }

    await admin.from('audit_log').insert({
      entity_type: 'orders',
      entity_id: replace_order_id,
      action: 'UPDATE',
      changed_fields: ['order_items', 'delivery_date', 'destination_id'],
      old_values: { items: oldItems, delivery_date: existingOrder.delivery_date, destination_id: existingOrder.destination_id },
      new_values: { items, delivery_date, destination_id: destination_id ?? null },
      user_id: user.id,
    })

    orderId = replace_order_id
    replaced = true
  } else {
    // 注文作成（approved で直接登録）
    const { data: order, error: orderErr } = await admin
      .from('orders')
      .insert({
        customer_id,
        destination_id: destination_id ?? null,
        source: 'manual',
        status: 'approved',
        order_date: jstTodayStr(),
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

    orderId = order.id
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

  return NextResponse.json({ orderId, replaced, warnings })
}
