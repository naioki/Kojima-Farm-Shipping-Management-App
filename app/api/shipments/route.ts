import { NextResponse } from 'next/server'
import { getAuthedUser } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { writeDroppingMissingColumns } from '@/lib/supabase/missing-column'
import { isStaffUser } from '@/lib/auth/is-staff-user'
import { shipmentAddSchema } from '@/types/database'
import { parseQuantity } from '@/lib/calculations/parse-quantity'
import { writeAudit } from '@/lib/audit/log'
import { shiftDateStr } from '@/lib/dates'
import { recordMistakeFeedback } from '@/lib/ai/learning-loop'
import { determineContainerType } from '@/lib/pipeline/schemas'

export const runtime = 'nodejs'

/**
 * GET /api/shipments?customerId=...&deliveryDate=...&productId=...&destinationId=...
 * 登録・変更前の既存出荷状況（差分プレビュー用）を高速チェック。
 */
export async function GET(req: Request) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const customerId = searchParams.get('customerId')
  const deliveryDate = searchParams.get('deliveryDate')
  const productId = searchParams.get('productId')
  const destinationId = searchParams.get('destinationId')

  if (!customerId || !deliveryDate) {
    return NextResponse.json({ ok: true, existingShipment: null })
  }

  const supabase = createAdminClient()
  let query = supabase
    .from('orders')
    .select(`
      id,
      delivery_date,
      order_items (
        id,
        product_id,
        product_name,
        quantity
      )
    `)
    .eq('customer_id', customerId)
    .eq('delivery_date', deliveryDate)
    .neq('status', 'cancelled')

  if (destinationId) {
    query = query.eq('destination_id', destinationId)
  }

  const { data: orders } = await query.order('created_at', { ascending: false }).limit(1)
  const ord = orders?.[0]
  if (!ord) {
    return NextResponse.json({ ok: true, existingShipment: null })
  }

  type RawItem = { id: string; product_id: string | null; product_name: string; quantity: number }
  const items = (ord.order_items || []) as unknown as RawItem[]
  const matchingItems = productId
    ? items.filter((i) => i.product_id === productId)
    : items

  if (matchingItems.length === 0) {
    return NextResponse.json({ ok: true, existingShipment: null, orderId: ord.id })
  }

  const totalQty = matchingItems.reduce((acc, cur) => acc + (Number(cur.quantity) || 0), 0)
  const firstMatch = matchingItems[0]!

  return NextResponse.json({
    ok: true,
    existingShipment: {
      order_id: ord.id,
      delivery_date: ord.delivery_date,
      product_name: firstMatch.product_name,
      current_quantity: totalQty,
    },
  })
}

/**
 * 出荷一覧の「スマート追加」（Laravel版 画面2）。手動入力チャネル。
 *   - 数量はスマートパース（"15c2" など）。c記法は customer_product_rules.packs_per_case で換算。
 *   - 同一 (取引先 × 出荷日 × source='manual') の注文があれば再利用、無ければ作成。
 *   - 税率・単価・名称は商品マスタから確定して order_items に冗長保持（tax.md）。
 *   - mode: 'increase' | 'decrease' | 'set' | 'create' による既存出荷の加算・減量・上書きに対応。
 */
export async function POST(req: Request) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!(await isStaffUser(user.id))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  const parsed = shipmentAddSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid', detail: parsed.error.flatten() }, { status: 400 })
  }
  const {
    customer_id,
    product_id,
    delivery_date,
    quantity_raw,
    packs_per_case: clientPacksPerCase,
    spec: clientSpec,
    container_type: clientContainerType,
    has_card: clientHasCard,
    destination_id,
    mode = 'create',
    shipping_time,
    note,
  } = parsed.data
  const supabase = createAdminClient()

  // 納入先が指定されたら、その取引先の配下（有効）であることを検証
  let destRow: { id: string; code?: string | null; full_name?: string | null } | null = null
  if (destination_id) {
    const { data: dest, error: destErr } = await supabase
      .from('delivery_destinations')
      .select('id, code, full_name')
      .eq('id', destination_id)
      .eq('customer_id', customer_id)
      .eq('is_active', true)
      .maybeSingle()
    if (destErr) return NextResponse.json({ error: destErr.message }, { status: 500 })
    if (!dest) return NextResponse.json({ error: 'invalid_destination' }, { status: 400 })
    destRow = dest
  }

  // 商品マスタ（単価・税率・名称・単位）
  const { data: product, error: prodErr } = await supabase
    .from('products')
    .select('id, name, unit, default_unit_price, default_tax_rate, container_capacity')
    .eq('id', product_id)
    .maybeSingle()
  if (prodErr) return NextResponse.json({ error: prodErr.message }, { status: 500 })
  if (!product) return NextResponse.json({ error: 'unknown_product' }, { status: 400 })

  // 取引先名を取得（コンテナ種別・規格の決定論的推論およびAI学習フィードバック用）
  const { data: custObj } = await supabase
    .from('customers')
    .select('name')
    .eq('id', customer_id)
    .maybeSingle()
  const confirmedCustName = custObj?.name || ''
  const confirmedDestName = destRow?.full_name || destRow?.code || ''

  // 取引先×商品ルール（P/C＝c記法換算の基準値）
  let { data: rule, error: ruleErr } = await supabase
    .from('customer_product_rules')
    .select('id, packs_per_case, spec, label_spec, container_type, default_container_type, has_card')
    .eq('customer_id', customer_id)
    .eq('product_id', product_id)
    .maybeSingle()
  if (ruleErr) {
    const fbRule = await supabase
      .from('customer_product_rules')
      .select('id, packs_per_case, spec, label_spec, container_type, has_card')
      .eq('customer_id', customer_id)
      .eq('product_id', product_id)
      .maybeSingle()
    rule = fbRule.data as typeof rule
    ruleErr = fbRule.error
  }
  if (ruleErr) console.error('[api/shipments] P/Cルールの取得に失敗:', ruleErr.message)

  // 入数の決定：クライアント指定値 → 取引ルール → 商品既定容量 → 20（絶対に packs_per_case_required で失敗させない）
  const effectivePacksPerCase =
    (clientPacksPerCase && clientPacksPerCase > 0 ? clientPacksPerCase : null) ??
    (rule?.packs_per_case && rule.packs_per_case > 0 ? rule.packs_per_case : null) ??
    (product.container_capacity && product.container_capacity > 0 ? product.container_capacity : null) ??
    20

  // 規格（spec）・コンテナ種別（container_type）・カード有無（has_card）の決定論的フォールバック
  const baseSpec =
    clientSpec?.trim() ||
    rule?.spec ||
    rule?.label_spec ||
    (product.name.includes('小松菜') ? '200g' : product.name.includes('青梗菜') ? '2〜3株' : '')
  const effectiveSpec =
    baseSpec && !baseSpec.includes('入数')
      ? `${baseSpec} (入数${effectivePacksPerCase})`
      : baseSpec || `入数${effectivePacksPerCase}`

  const effectiveContainerType =
    clientContainerType?.trim() ||
    rule?.container_type ||
    rule?.default_container_type ||
    determineContainerType(confirmedCustName, confirmedDestName)

  const effectiveHasCard =
    clientHasCard !== undefined && clientHasCard !== null
      ? clientHasCard
      : rule?.has_card ?? true

  // スマートパース（誤解釈防止のため lib に集約・Decimal.js）
  const result = parseQuantity(quantity_raw, { packsPerCase: effectivePacksPerCase })
  if (result.type === 'delete') {
    return NextResponse.json({ error: 'empty_quantity' }, { status: 400 })
  }
  if (result.type === 'error') {
    return NextResponse.json({ error: result.reason, input: result.input }, { status: 400 })
  }

  // 同一 (取引先 × 納入先 × 出荷日) の有効注文（キャンセル除外）を再利用、無ければ作成。
  const findQuery = supabase
    .from('orders')
    .select('id')
    .eq('customer_id', customer_id)
    .eq('delivery_date', delivery_date)
    .neq('status', 'cancelled')
    .order('created_at', { ascending: false })
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
        shipping_time: shipping_time ?? null,
        created_by: user.id,
      })
      .select('id')
      .single()
    if (orderErr) return NextResponse.json({ error: orderErr.message }, { status: 500 })
    orderId = order.id
  } else if (shipping_time && orderId) {
    // 既存注文が存在する場合も指定があれば出荷時間帯を更新
    await supabase.from('orders').update({ shipping_time }).eq('id', orderId)
  }

  const deltaQty = result.total.toNumber()

  // 既存明細の検索（加算・減量・上書き時、または同一品目が既に存在する場合の合算）
  type OrderItemRow = {
    id: string
    quantity: number
    shipped_qty?: number | null
    field_status?: string | null
    line_note: string | null
    spec?: string | null
    container_type?: string | null
    has_card?: boolean | null
    [key: string]: unknown
  }
  let existingItem: OrderItemRow | null = null
  if (existing?.id) {
    const { data: itm } = await supabase
      .from('order_items')
      .select('*')
      .eq('order_id', existing.id)
      .eq('product_id', product_id)
      .limit(1)
      .maybeSingle()
    existingItem = itm as OrderItemRow | null
  }

  let finalItem: Record<string, unknown>
  if (existingItem) {
    const oldQty = Number(existingItem.quantity) || 0
    let newQty = oldQty
    if (mode === 'increase' || mode === 'create') newQty += deltaQty
    else if (mode === 'decrease') newQty = Math.max(0, newQty - deltaQty)
    else if (mode === 'set') newQty = deltaQty

    const qtyChanged = newQty !== oldQty
    const wasPackedAndIncreased =
      qtyChanged &&
      newQty > oldQty &&
      (existingItem.field_status === 'packed' || existingItem.field_status === 'shipped')

    const preservedPartialQty = wasPackedAndIncreased
      ? oldQty
      : existingItem.shipped_qty && existingItem.shipped_qty > 0 && existingItem.shipped_qty < newQty
      ? existingItem.shipped_qty
      : null

    const changeNote = qtyChanged
      ? wasPackedAndIncreased
        ? `🚨パック済(${oldQty}P)→${newQty}P(+${newQty - oldQty}P追加必要)`
        : `数量変更:${oldQty}→${newQty}P`
      : null

    const combinedNote = [existingItem.line_note, changeNote, note]
      .filter((s): s is string => Boolean(s && s.trim()))
      .join(' / ') || null

    const updateCases = Math.floor(newQty / effectivePacksPerCase)
    const updateRem = newQty % effectivePacksPerCase
    const updatedQuantityRaw =
      updateRem > 0 ? `${updateCases}c+${updateRem}P` : `${updateCases}c`

    const { data: updatedItem, error: upErr } = await writeDroppingMissingColumns(
      {
        quantity: newQty,
        quantity_raw: updatedQuantityRaw,
        fraction_note: updateRem > 0 ? `端数${updateRem}P` : null,
        spec: clientSpec?.trim() || existingItem.spec || effectiveSpec,
        container_type: clientContainerType?.trim() || existingItem.container_type || effectiveContainerType,
        has_card: clientHasCard ?? existingItem.has_card ?? effectiveHasCard,
        line_note: combinedNote,
        is_manual_modified: true,
        ...(qtyChanged
          ? {
              field_status: 'not_started',
              shipped_qty: preservedPartialQty,
            }
          : {}),
        updated_at: new Date().toISOString(),
      },
      (p) => supabase.from('order_items').update(p).eq('id', existingItem.id).select().single(),
    )
    if (upErr || !updatedItem) return NextResponse.json({ error: upErr?.message ?? 'update failed' }, { status: 500 })
    finalItem = updatedItem

    await writeAudit(supabase, {
      entityType: 'order_items',
      entityId: existingItem.id,
      action: 'UPDATE',
      oldValues: existingItem,
      newValues: updatedItem,
      userId: user.id,
    })
  } else {
    // 新規明細作成（単価・税率は商品マスタから）
    const initCases = Math.floor(deltaQty / effectivePacksPerCase)
    const initRem = deltaQty % effectivePacksPerCase
    const initQuantityRaw =
      initRem > 0 ? `${initCases}c+${initRem}P` : `${initCases}c`

    const { data: item, error: itemErr } = await writeDroppingMissingColumns<Record<string, unknown>, { code?: string; message?: string }>(
      {
        order_id: orderId,
        product_id,
        product_name: product.name,
        quantity: deltaQty,
        quantity_raw: initQuantityRaw,
        fraction_note: initRem > 0 ? `端数${initRem}P` : null,
        unit: product.unit,
        unit_price: product.default_unit_price ?? 0,
        tax_rate: product.default_tax_rate,
        rule_id: rule?.id ?? null,
        confidence: 1.0,
        field_status: 'not_started',
        line_note: note ?? null,
        spec: effectiveSpec,
        container_type: effectiveContainerType,
        has_card: effectiveHasCard,
        is_manual_modified: true,
      },
      (p) => supabase.from('order_items').insert(p as never).select().single(),
    )
    if (itemErr || !item) return NextResponse.json({ error: itemErr?.message ?? 'insert failed' }, { status: 500 })
    finalItem = item

    await writeAudit(supabase, {
      entityType: 'order_items',
      entityId: String(item.id),
      action: 'INSERT',
      oldValues: null,
      newValues: item,
      userId: user.id,
    })
  }

  // 全品目「出荷日の前日に収穫・パック」原則に従い harvest_tasks を自動同期
  if (delivery_date && finalItem && finalItem['id'] && product_id) {
    try {
      const finalQty = Number(finalItem['quantity']) || 0
      const harvestDate = shiftDateStr(delivery_date, -1)
      if (finalQty <= 0) {
        await supabase.from('harvest_tasks').delete().eq('order_item_id', finalItem['id'] as string)
      } else {
        const { data: existingTask } = await supabase
          .from('harvest_tasks')
          .select('id')
          .eq('order_item_id', finalItem['id'] as string)
          .maybeSingle()

        if (existingTask) {
          await supabase
            .from('harvest_tasks')
            .update({ required_qty: finalQty, task_date: harvestDate })
            .eq('id', existingTask.id)
        } else {
          await supabase.from('harvest_tasks').insert({
            product_id,
            order_item_id: finalItem['id'] as string,
            required_qty: finalQty,
            task_date: harvestDate,
            status: 'not_started',
          })
        }
      }
    } catch (htErr) {
      console.warn('[api/shipments] harvest_tasks 同期警告:', htErr)
    }
  }

  // ⚡ AI読取誤読・修正差分を検知し自律学習ループ（ai_rules）へ自動蓄積
  let learnedMistake = false
  if (parsed.data.ai_original && customer_id) {
    try {
      const orig = parsed.data.ai_original

      // 1. 取引先の誤読修正
      if (orig.customer_name && confirmedCustName && orig.customer_name.trim() !== confirmedCustName) {
        await recordMistakeFeedback({
          clientName: confirmedCustName,
          rawInput: orig.customer_name,
          correctedField: 'customer',
          correctedValue: confirmedCustName,
        })
        learnedMistake = true
      }

      // 2. 納入先の誤読修正
      if (destination_id && orig.destination_name && confirmedDestName) {
        if (orig.destination_name.trim() !== confirmedDestName) {
          await recordMistakeFeedback({
            clientName: confirmedCustName,
            rawInput: orig.destination_name,
            correctedField: 'destination',
            correctedValue: confirmedDestName,
          })
          learnedMistake = true
        }
      }

      // 3. 入数の修正
      if (effectivePacksPerCase && orig.packs_per_case && orig.packs_per_case !== effectivePacksPerCase) {
        await recordMistakeFeedback({
          clientName: confirmedCustName,
          rawInput: String(orig.packs_per_case),
          correctedField: 'packs_per_case',
          correctedValue: String(effectivePacksPerCase),
        })
        learnedMistake = true
      }
    } catch (err) {
      console.warn('[api/shipments] AI学習ループ蓄積警告:', err)
    }
  }

  return NextResponse.json({ item: finalItem, mode, learnedMistake }, { status: 201 })
}
