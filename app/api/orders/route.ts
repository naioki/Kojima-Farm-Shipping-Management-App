import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthedUser } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isStaffUser } from '@/lib/auth/is-staff-user'
import { writeDroppingMissingColumns } from '@/lib/supabase/missing-column'
import { writeAudit } from '@/lib/audit/log'
import { jstTodayStr, shiftDateStr } from '@/lib/dates'
import {
  determineHasCard,
  determineUnitCount,
  formatQuantityCaseText,
  generateOrderKey,
  resolveContainerType,
} from '@/lib/pipeline/schemas'
import { purgeOldReceiptBase64 } from '@/lib/receipts/retention'

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
  /** 規格表記（任意。未指定時は取引先×商品ルールまたは自動推論）。 */
  spec: z.string().nullish(),
  /** コンテナ・荷姿種別（任意。未指定時は取引先×納入先から自動推論）。 */
  container_type: z.string().nullish(),
  /** 生産者カード同梱有無（任意）。 */
  has_card: z.boolean().nullish(),
  /** 袋種別（任意）。 */
  bag_type: z.string().nullish(),
  /** シール有無（任意）。 */
  has_seal: z.boolean().nullish(),
  /** シール指示文（任意）。 */
  seal_text: z.string().nullish(),
  /** 明細行メモ（任意）。 */
  line_note: z.string().nullish(),
})

const orderSchema = z.object({
  customer_id: z.string().uuid(),
  /** 納入先（取引先配下の届け先）。任意。 */
  destination_id: z.string().uuid().nullish(),
  delivery_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  shipping_time: z.enum(['am', 'pm']).optional(),
  note: z.string().optional(),
  items: z.array(itemSchema).min(1),
  /** 受注経路の内訳（電話・LINE・紙・その他）。評価指標「紙の卒業」の計測用。未指定は不明。 */
  intake_channel: z.enum(['phone', 'line', 'paper', 'other', 'fax', 'email']).optional(),
  /** 同一取引先×納品日の既存注文があっても新規として登録を強行する（重複警告を承認した）。 */
  confirm_duplicate: z.boolean().optional(),
  /** 指定すると新規INSERTでなく、この注文を置き換える（訂正・再送）。 */
  replace_order_id: z.string().uuid().optional(),
  /** 指定すると新規INSERTでなく、この既存注文に明細を合算（追加・マージ）する。 */
  merge_order_id: z.string().uuid().optional(),
  /** 置換時の楽観ロック。取得時の orders.updated_at と一致しないと409（他の人が触った）。 */
  expected_updated_at: z.string().optional(),
  /** アップロードされた原本ファイル情報（FAX/PDF/写真/Excel）。order_receipts に自動アーカイブする。 */
  original_file: z
    .object({
      base64: z.string(),
      mimeType: z.string(),
      fileName: z.string(),
    })
    .optional(),
})

/**
 * POST /api/orders
 * 手動・AI読取注文登録（admin / 社内スタッフ）。
 * - status='approved' で即時登録し、全品目「出荷日の前日に収穫・パック」原則に従い harvest_tasks を自動同期。
 * - 同一（取引先×納入先×納品日）の既存注文がある場合：
 *   - デフォルトは 409 duplicate を返し、UIで「既存に合算（追加）」「既存を上書き（置換）」「別注文として新規登録」を選ばせる。
 *   - merge_order_id 指定時は既存注文に数量合算（パック済み明細の途中数保護・数量変更メモ付与対応）。
 *   - replace_order_id 指定時は既存注文の明細を置き換え（audit_log に entity_id で記録）。
 *   - confirm_duplicate=true 指定時は別便の注文として新規INSERT。
 * - 各明細に V5 荷姿属性（spec, container_type, has_card, bag_type, has_seal, seal_text, quantity_raw, fraction_note, rule_id, order_key）を自動補完し、
 *   0026 未適用DB環境でも writeDroppingMissingColumns で安全に保存する。
 */
export async function POST(req: NextRequest) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 })

  const admin = createAdminClient()
  const { data: profile, error: profileErr } = await admin
    .from('users')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()
  if (profileErr) console.error('[app/api/orders/route.ts] ロールの取得に失敗:', profileErr.message)

  const jwtRole = (user.app_metadata as { role?: string } | undefined)?.role
  const effectiveRole = profile?.role ?? jwtRole
  if (effectiveRole !== 'admin' && effectiveRole !== 'staff' && !(await isStaffUser(user.id))) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 })
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
    merge_order_id,
    expected_updated_at,
    original_file,
  } = parsed.data

  // 取引先・納入先・取引先×商品ルールを取得（荷姿・コンテナ・入数の自動補完用）
  const productIds = [...new Set(items.map((i) => i.product_id))]
  const [custRes, destRes, rulesRes, packsRes] = await Promise.all([
    admin.from('customers').select('id, name').eq('id', customer_id).maybeSingle(),
    destination_id
      ? admin
          .from('delivery_destinations')
          .select('*')
          .eq('id', destination_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    productIds.length > 0
      ? admin
          .from('customer_product_rules')
          .select('*')
          .eq('customer_id', customer_id)
          .in('product_id', productIds)
      : Promise.resolve({ data: [], error: null }),
    productIds.length > 0
      ? admin
          .from('pack_configs')
          .select('id, product_id, customer_id, label, base_per_selling')
          .eq('is_active', true)
          .in('product_id', productIds)
      : Promise.resolve({ data: [], error: null }),
  ])

  const customerName = custRes.data?.name ?? ''
  const destinationName = destRes.data?.full_name || destRes.data?.code || ''
  const ruleByProduct = new Map<string, Record<string, unknown>>(
    ((rulesRes.data ?? []) as Record<string, unknown>[]).map((r) => [String(r.product_id), r]),
  )
  const packById = new Map(
    ((packsRes.data ?? []) as { id: string; product_id: string; customer_id: string | null; label: string; base_per_selling: number }[]).map(
      (p) => [p.id, p],
    ),
  )

  // 重複警告（取引先×納入先×納品日）。
  // confirm_duplicate / replace_order_id / merge_order_id のいずれも未指定のときのみ 409 で既存注文を知らせる。
  if (!confirm_duplicate && !replace_order_id && !merge_order_id) {
    let dupeQuery = admin
      .from('orders')
      .select('id, created_at, updated_at, order_items(id, product_id, product_name, quantity)')
      .eq('customer_id', customer_id)
      .eq('delivery_date', delivery_date)
      .neq('status', 'cancelled')
    dupeQuery = destination_id ? dupeQuery.eq('destination_id', destination_id) : dupeQuery.is('destination_id', null)
    const { data: dupes, error: dupesErr } = await dupeQuery
    if (dupesErr) return NextResponse.json({ error: dupesErr.message }, { status: 500 })
    if (dupes && dupes.length > 0) {
      return NextResponse.json(
        {
          duplicate: true,
          error: '同じ取引先・納品日の注文が既に存在します',
          existing: dupes.map((o) => {
            const rawItems = Array.isArray(o.order_items) ? o.order_items : []
            return {
              id: o.id as string,
              created_at: o.created_at as string,
              updated_at: o.updated_at as string,
              item_count: rawItems.length,
              items: rawItems,
            }
          }),
        },
        { status: 409 },
      )
    }
  }

  // 過去90日の同取引先×商品の最大数量を取得（異常値検知）
  const since = shiftDateStr(jstTodayStr(), -90)
  const { data: histOrders, error: histOrdersErr } = await admin
    .from('orders')
    .select('id')
    .eq('customer_id', customer_id)
    .gte('delivery_date', since)
  if (histOrdersErr) console.error('[api/orders] 履歴注文の取得に失敗（異常値検知）:', histOrdersErr.message)

  const histOrderIds = (histOrders ?? []).map((o) => o.id)
  const histStats: Record<string, { max: number; min: number; avg: number }> = {}
  if (histOrderIds.length > 0 && productIds.length > 0) {
    const { data: histItems, error: histItemsErr } = await admin
      .from('order_items')
      .select('product_id, quantity')
      .in('order_id', histOrderIds)
      .in('product_id', productIds)
    if (histItemsErr) console.error('[api/orders] 履歴明細の取得に失敗（異常値検知）:', histItemsErr.message)

    const byProduct: Record<string, number[]> = {}
    for (const it of histItems ?? []) {
      if (!it.product_id) continue
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

  /** 各明細行の V5 属性・数量文字列を決定論的に構築するヘルパー */
  function buildItemPayload(orderId: string, it: z.infer<typeof itemSchema>) {
    const rule = ruleByProduct.get(it.product_id)
    const pack = it.pack_config_id ? packById.get(it.pack_config_id) : undefined
    const rulePacks = typeof rule?.packs_per_case === 'number' ? Number(rule.packs_per_case) : undefined
    const effectivePacks =
      (it.packs_per_case && it.packs_per_case > 0 ? it.packs_per_case : undefined) ??
      (pack ? Number(pack.base_per_selling) : undefined) ??
      rulePacks ??
      determineUnitCount(customerName, it.spec ?? (rule?.spec as string | undefined), undefined, it.product_name)

    const totalQty = Math.max(0, Math.round(it.quantity))
    const cases = effectivePacks > 0 ? Math.floor(totalQty / effectivePacks) : 0
    const rem = effectivePacks > 0 ? totalQty % effectivePacks : totalQty
    const quantityRaw =
      effectivePacks > 0
        ? rem > 0
          ? `${cases}c+${rem}P`
          : `${cases}c`
        : formatQuantityCaseText(totalQty, cases, rem)

    const baseSpec =
      it.spec?.trim() ||
      (typeof rule?.spec === 'string' ? rule.spec : null) ||
      (typeof rule?.label_spec === 'string' ? rule.label_spec : null) ||
      pack?.label ||
      (it.product_name.includes('小松菜') ? '200g' : it.product_name.includes('青梗菜') || it.product_name.includes('チンゲン') ? '2〜3株' : '')
    const effectiveSpec =
      baseSpec && !baseSpec.includes('入数') && effectivePacks > 0
        ? `${baseSpec} (入数${effectivePacks})`
        : baseSpec || (effectivePacks > 0 ? `入数${effectivePacks}` : null)

    const destDefaultContainer = (destRes.data as { default_container_type?: string | null } | null)?.default_container_type ?? null
    const effectiveContainer = resolveContainerType({
      explicitContainer: it.container_type?.trim() || null,
      ruleContainer:
        (typeof rule?.container_type === 'string' && rule.container_type) ||
        (typeof rule?.default_container_type === 'string' ? rule.default_container_type : null),
      destDefaultContainer,
      clientName: customerName,
      destination: destinationName,
      rawText: `${it.line_note ?? ''} ${note ?? ''} ${effectiveSpec ?? ''}`,
    })

    const effectiveHasCard = determineHasCard({
      explicitHasCard: it.has_card,
      ruleHasCard: typeof rule?.has_card === 'boolean' ? rule.has_card : null,
      clientName: customerName,
      destination: destinationName,
      rawText: `${it.line_note ?? ''} ${note ?? ''} ${effectiveSpec ?? ''}`,
    })

    const effectiveBagType =
      it.bag_type?.trim() ||
      (typeof rule?.bag_type === 'string' ? rule.bag_type : null) ||
      (customerName.includes('勘兵衛') ? '印字袋(FG)' : null)

    const effectiveSealText =
      it.seal_text?.trim() ||
      (typeof rule?.seal_text === 'string' ? rule.seal_text : null)

    const effectiveHasSeal =
      it.has_seal != null
        ? it.has_seal
        : typeof rule?.has_seal === 'boolean'
        ? rule.has_seal
        : Boolean(effectiveSealText)

    const orderKey = generateOrderKey({
      clientName: customerName,
      deliveryDate: delivery_date,
      destination: destinationName,
      itemName: it.product_name,
      spec: effectiveSpec ?? '',
    })

    return {
      order_id: orderId,
      product_id: it.product_id,
      product_name: it.product_name,
      quantity: it.quantity,
      quantity_raw: quantityRaw,
      fraction_note: rem > 0 ? `端数${rem}P` : null,
      unit: it.unit,
      unit_price: it.unit_price,
      tax_rate: it.tax_rate,
      pack_config_id: it.pack_config_id ?? null,
      rule_id: (rule?.id as string | undefined) ?? null,
      confidence: 1.0,
      field_status: 'not_started' as const,
      spec: effectiveSpec,
      container_type: effectiveContainer,
      has_card: effectiveHasCard,
      line_note: it.line_note ?? note ?? null,
      bag_type: effectiveBagType,
      seal_text: effectiveSealText,
      has_seal: effectiveHasSeal,
      order_key: orderKey,
    }
  }

  let orderId: string
  let replaced = false
  let merged = false

  if (merge_order_id) {
    // 既存注文への合算（追加・マージ）
    const { data: existingOrder, error: fetchErr } = await admin
      .from('orders')
      .select('id, status, note, shipping_time')
      .eq('id', merge_order_id)
      .maybeSingle()

    if (fetchErr || !existingOrder) {
      return NextResponse.json({ error: '合算対象の注文が見つかりません' }, { status: 404 })
    }
    if (existingOrder.status === 'invoiced') {
      return NextResponse.json(
        { error: '請求済みの注文には合算できません。別の注文として登録してください。' },
        { status: 409 },
      )
    }

    const { data: existingItems } = await admin
      .from('order_items')
      .select('*')
      .eq('order_id', merge_order_id)

    for (const it of items) {
      const payload = buildItemPayload(merge_order_id, it)
      const prev = (existingItems ?? []).find((x) => x.product_id === it.product_id)
      if (prev) {
        const oldQty = Number(prev.quantity) || 0
        const newQty = oldQty + it.quantity
        const wasPacked = prev.field_status === 'packed' || prev.field_status === 'shipped'
        const preservedPartialQty = wasPacked
          ? oldQty
          : prev.shipped_qty && prev.shipped_qty > 0 && prev.shipped_qty < newQty
          ? prev.shipped_qty
          : null
        const changeMemo = wasPacked
          ? `🚨パック済(${oldQty}P)→${newQty}P(+${it.quantity}P追加必要)`
          : `数量合算:${oldQty}→${newQty}P(+${it.quantity}P)`
        const combinedLineNote = [prev.line_note, changeMemo, it.line_note ?? note]
          .filter((s): s is string => Boolean(s && s.trim()))
          .join(' / ') || null

        const mergedPayload = buildItemPayload(merge_order_id, { ...it, quantity: newQty })
        const { error: upErr } = await writeDroppingMissingColumns(
          {
            quantity: newQty,
            version: (Number(prev.version) || 1) + 1,
            quantity_raw: mergedPayload.quantity_raw,
            fraction_note: mergedPayload.fraction_note,
            line_note: combinedLineNote,
            field_status: 'not_started',
            shipped_qty: preservedPartialQty,
            updated_at: new Date().toISOString(),
          },
          (p) => admin.from('order_items').update(p).eq('id', prev.id).select().single(),
        )
        if (upErr) {
          return NextResponse.json({ error: `既存明細の合算に失敗しました: ${upErr.message}` }, { status: 500 })
        }
      } else {
        const { error: insErr } = await writeDroppingMissingColumns(
          payload,
          (p) => admin.from('order_items').insert(p as never).select().single(),
        )
        if (insErr) {
          return NextResponse.json({ error: `追加明細の登録に失敗しました: ${insErr.message}` }, { status: 500 })
        }
      }
    }

    if (shipping_time || note) {
      const combinedNote = [existingOrder.note, note].filter(Boolean).join(' / ') || null
      await admin
        .from('orders')
        .update({
          ...(shipping_time ? { shipping_time } : {}),
          ...(combinedNote ? { note: combinedNote } : {}),
        })
        .eq('id', merge_order_id)
    }

    orderId = merge_order_id
    merged = true
  } else if (replace_order_id) {
    // 置き換え（訂正・再送）
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

    const { data: oldItems, error: oldItemsErr } = await admin
      .from('order_items')
      .select('id, product_id, product_name, quantity, unit, unit_price, tax_rate, pack_config_id')
      .eq('order_id', replace_order_id)
    if (oldItemsErr) console.error('[api/orders] 差し替え前明細の取得に失敗（監査）:', oldItemsErr.message)

    // 先に harvest_tasks を削除してから order_items を削除
    await admin.from('harvest_tasks').delete().in(
      'order_item_id',
      ((oldItems ?? []) as { id?: string }[]).map((x) => x.id).filter((x): x is string => Boolean(x)),
    )

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

    for (const it of items) {
      const payload = buildItemPayload(replace_order_id, it)
      const { error: itemsErr } = await writeDroppingMissingColumns(
        payload,
        (p) => admin.from('order_items').insert(p as never).select('id').single(),
      )
      if (itemsErr) {
        console.error('[POST /api/orders] replace: items insert error', itemsErr)
        return NextResponse.json({ error: '新しい明細の登録に失敗しました' }, { status: 500 })
      }
    }

    try {
      await writeAudit(admin, {
        entityType: 'orders',
        entityId: replace_order_id,
        action: 'UPDATE',
        oldValues: { items: oldItems, delivery_date: existingOrder.delivery_date, destination_id: existingOrder.destination_id },
        newValues: { items, delivery_date, destination_id: destination_id ?? null },
        userId: user.id,
      })
    } catch (auditErr) {
      console.warn('[POST /api/orders] replace audit_log warning:', auditErr)
    }

    orderId = replace_order_id
    replaced = true
  } else {
    // 注文新規作成（approved で直接登録。created_by が users に存在しない場合の FK エラーも自動回避）
    const { data: userRow } = await admin.from('users').select('id').eq('id', user.id).maybeSingle()
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
        created_by: userRow ? user.id : null,
        // 手入力は登録＝承認（approved で直接登録）なので承認時刻＝登録時刻
        intake_channel: parsed.data.intake_channel ?? null,
        approved_at: new Date().toISOString(),
        approved_by: userRow ? user.id : null,
      })
      .select('id')
      .single()

    if (orderErr || !order) {
      console.error('[POST /api/orders] order insert error', orderErr)
      return NextResponse.json({ error: `注文の登録に失敗しました: ${orderErr?.message ?? 'unknown'}` }, { status: 500 })
    }

    for (const it of items) {
      const payload = buildItemPayload(order.id, it)
      const { error: itemsErr } = await writeDroppingMissingColumns(
        payload,
        (p) => admin.from('order_items').insert(p as never).select('id').single(),
      )
      if (itemsErr) {
        console.error('[POST /api/orders] items insert error', itemsErr)
        await admin.from('orders').delete().eq('id', order.id)
        return NextResponse.json({ error: `明細の登録に失敗しました: ${itemsErr.message}` }, { status: 500 })
      }
    }

    orderId = order.id
  }

  // 入り数(P/C)を規格マスタに保存（未設定のときのみ。既存値は誤上書きしない）。
  const withPacks = items.filter((it) => typeof it.packs_per_case === 'number' && it.packs_per_case > 0)
  if (withPacks.length > 0) {
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
      } catch (e) {
        console.error('[POST /api/orders] packs_per_case upsert skipped', e)
      }
    }
  }

  // アップロードされた原本ファイルがある場合、order_receipts にアーカイブして現場FAX原本と紐付ける
  if (original_file && orderId) {
    try {
      await admin.from('order_receipts').insert({
        order_id: orderId,
        customer_id: customer_id,
        delivery_date: delivery_date,
        channel: 'manual',
        status: 'approved',
        received_at: new Date().toISOString(),
        raw_payload: {
          filename: original_file.fileName,
          content_type: original_file.mimeType,
          file_base64: original_file.base64,
          created_order_ids: [orderId],
        },
      })
      purgeOldReceiptBase64(admin, 7).catch(() => {})
    } catch (e) {
      console.error('[POST /api/orders] original_file receipt insert error', e)
    }
  }

  // 全品目「出荷日の前日に収穫・パック」の原則に従い harvest_tasks を自動同期
  if (delivery_date && orderId) {
    try {
      const { data: dbItems } = await admin
        .from('order_items')
        .select('id, product_id, quantity')
        .eq('order_id', orderId)

      if (dbItems && dbItems.length > 0) {
        const itemIds = dbItems.map((i) => i.id)
        await admin.from('harvest_tasks').delete().in('order_item_id', itemIds)

        const harvestTaskDate = shiftDateStr(delivery_date, -1)
        const taskRows = dbItems
          .filter((it) => Boolean(it.product_id))
          .map((it) => ({
            product_id: it.product_id!,
            order_item_id: it.id,
            required_qty: Number(it.quantity),
            task_date: harvestTaskDate,
            status: 'not_started' as const,
          }))

        if (taskRows.length > 0) {
          const { error: htErr } = await admin.from('harvest_tasks').insert(taskRows)
          if (htErr) console.error('[POST /api/orders] harvest_tasks 自動生成エラー:', htErr.message)
        }
      }
    } catch (htEx) {
      console.error('[POST /api/orders] harvest_tasks 生成失敗 (続行):', htEx)
    }
  }

  return NextResponse.json({ orderId, replaced, merged, warnings })
}
