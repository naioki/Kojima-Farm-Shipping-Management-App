import { NextResponse } from 'next/server'
import { getAuthedUser } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { writeDroppingMissingColumns } from '@/lib/supabase/missing-column'
import { isStaffUser } from '@/lib/auth/is-staff-user'
import { shipmentAddSchema } from '@/types/database'
import { parseQuantity } from '@/lib/calculations/parse-quantity'
import { writeAudit } from '@/lib/audit/log'
import { jstTodayStr, shiftDateStr } from '@/lib/dates'
import { recordMistakeFeedback } from '@/lib/ai/learning-loop'
import { determineHasCard, resolveContainerType } from '@/lib/pipeline/schemas'
import { purgeOldReceiptBase64 } from '@/lib/receipts/retention'

export const runtime = 'nodejs'

function stripPriceFromNote(text?: string | null): string | null {
  if (!text) return null
  const cleaned = text
    .replace(/[\/／・,、\s]*買値\s*[:：]?\s*[¥￥]?\s*\d+(?:円)?/g, '')
    .replace(/[\/／・,、\s]*単価\s*[:：]?\s*[¥￥]?\s*\d+(?:円)?/g, '')
    .replace(/[¥￥]\s*\d+/g, '')
    .replace(/\(\s*\)|（\s*）/g, '')
    .replace(/^[\/／・\s]+|[\/／・\s]+$/g, '')
    .trim()
  return cleaned || null
}

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
 * 出荷一覧の「スマート追加」（Laravel版 画面2）。手動入力・AI一括登録チャネル。
 *   - 数量はスマートパース（"15c2" など）。c記法は customer_product_rules.packs_per_case で換算。
 *   - 数量 0（mode='set' で '0' または '0c'）は既存出荷があればキャンセル（削除）、無ければスキップ。
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
    has_seal: clientHasSeal,
    seal_text: clientSealText,
    bag_type: clientBagType,
    destination_id,
    mode = 'create',
    shipping_time,
    note: rawNote,
    original_file,
    receipt_id: clientReceiptId,
  } = parsed.data
  const note = stripPriceFromNote(rawNote)
  const supabase = createAdminClient()

  // 納入先が指定されたら、その取引先の配下（有効）であることを検証
  let destRow: { id: string; code?: string | null; full_name?: string | null; default_container_type?: string | null } | null = null
  if (destination_id) {
    const { data: dest, error: destErr } = await supabase
      .from('delivery_destinations')
      .select('*')
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
  const { data: ruleRaw, error: ruleErr } = await supabase
    .from('customer_product_rules')
    .select('*')
    .eq('customer_id', customer_id)
    .eq('product_id', product_id)
    .maybeSingle()
  if (ruleErr) console.error('[api/shipments] P/Cルールの取得に失敗:', ruleErr.message)
  const rule = ruleRaw as Record<string, unknown> | null

  // 入数の決定：クライアント指定値 → 取引ルール → 商品既定容量 → NSK判定(24) → 20
  const isNsk = confirmedCustName.includes('農業総合研究所') || confirmedCustName.toUpperCase().includes('NSK')
  const rulePacks = typeof rule?.packs_per_case === 'number' && rule.packs_per_case > 0 ? rule.packs_per_case : null
  const effectivePacksPerCase =
    (clientPacksPerCase && clientPacksPerCase > 0 ? clientPacksPerCase : null) ??
    rulePacks ??
    (product.container_capacity && product.container_capacity > 0 ? product.container_capacity : null) ??
    (isNsk ? 24 : 20)

  // 規格（spec）・コンテナ種別（container_type）・カード有無（has_card）・シール（has_seal/seal_text）の決定論的フォールバック
  const ruleSpec = (typeof rule?.spec === 'string' && rule.spec) || (typeof rule?.label_spec === 'string' && rule.label_spec) || ''
  const baseSpec =
    clientSpec?.trim() ||
    ruleSpec ||
    (isNsk
      ? confirmedDestName.includes('北海道')
        ? '200g'
        : '200gUP'
      : product.name.includes('小松菜')
      ? '200g'
      : product.name.includes('青梗菜') || product.name.includes('チンゲン')
      ? '2〜3株'
      : '')
  const effectiveSpec =
    baseSpec && !baseSpec.includes('入数')
      ? `${baseSpec} (入数${effectivePacksPerCase})`
      : baseSpec || `入数${effectivePacksPerCase}`

  const effectiveContainerType = resolveContainerType({
    explicitContainer: clientContainerType?.trim() || null,
    ruleContainer: (typeof rule?.container_type === 'string' && rule.container_type) || (typeof rule?.default_container_type === 'string' ? rule.default_container_type : null),
    destDefaultContainer: destRow?.default_container_type ?? null,
    clientName: confirmedCustName,
    destination: confirmedDestName,
    rawText: `${rawNote ?? ''} ${clientSpec ?? ''}`,
  })

  const effectiveHasCard = determineHasCard({
    explicitHasCard: clientHasCard,
    ruleHasCard: typeof rule?.has_card === 'boolean' ? rule.has_card : null,
    clientName: confirmedCustName,
    destination: confirmedDestName,
    rawText: `${rawNote ?? ''} ${clientSpec ?? ''}`,
  })

  const effectiveHasSeal =
    clientHasSeal !== undefined && clientHasSeal !== null
      ? clientHasSeal
      : typeof rule?.has_seal === 'boolean'
      ? rule.has_seal
      : isNsk
      ? !confirmedDestName.includes('北海道') && !effectiveSpec.startsWith('200g (')
      : null

  const effectiveSealText =
    stripPriceFromNote(clientSealText) ||
    (typeof rule?.seal_text === 'string' ? stripPriceFromNote(rule.seal_text) : null) ||
    (effectiveHasSeal === true
      ? isNsk
        ? 'シールあり（生産者11:小島裕美）'
        : 'シールあり'
      : effectiveHasSeal === false
      ? 'シールなし'
      : null)

  const effectiveBagType =
    clientBagType?.trim() ||
    (typeof rule?.bag_type === 'string' ? rule.bag_type : null) ||
    (confirmedCustName.includes('勘兵衛') ? '印字袋(FG)' : null)

  // スマートパース（誤解釈防止のため lib に集約・Decimal.js）
  const result = parseQuantity(quantity_raw, { packsPerCase: effectivePacksPerCase })
  if (result.type === 'delete') {
    return NextResponse.json({ error: 'empty_quantity' }, { status: 400 })
  }
  if (result.type === 'error') {
    return NextResponse.json({ error: result.reason, input: result.input }, { status: 400 })
  }

  const deltaQty = result.total.toNumber()

  // 同一 (取引先 × 納入先 × 出荷日) の有効注文（キャンセル除外）を検索
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

  type OrderItemRow = {
    id: string
    quantity: number
    version?: number | null
    shipped_qty?: number | null
    field_status?: string | null
    line_note: string | null
    spec?: string | null
    container_type?: string | null
    has_card?: boolean | null
    has_seal?: boolean | null
    seal_text?: string | null
    bag_type?: string | null
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

  // ⚡ 数量 0（キャンセル・削除指示）のハンドリング
  if (deltaQty === 0) {
    if (existingItem && (mode === 'set' || mode === 'create')) {
      await supabase.from('harvest_tasks').delete().eq('order_item_id', existingItem.id)
      await supabase.from('order_items').delete().eq('id', existingItem.id)
      try {
        await writeAudit(supabase, {
          entityType: 'order_items',
          entityId: existingItem.id,
          action: 'DELETE',
          oldValues: existingItem,
          newValues: null,
          userId: user.id,
        })
      } catch {}
      if (existing?.id) {
        const { count } = await supabase
          .from('order_items')
          .select('id', { count: 'exact', head: true })
          .eq('order_id', existing.id)
        if ((count ?? 0) === 0) {
          await supabase.from('orders').delete().eq('id', existing.id)
        }
      }
      return NextResponse.json({ deleted: true, cancelled: true, mode }, { status: 200 })
    }
    return NextResponse.json({ deleted: true, skipped: true, mode }, { status: 200 })
  }

  let orderId = existing?.id
  if (!orderId) {
    const { data: userRow } = await supabase.from('users').select('id').eq('id', user.id).maybeSingle()
    const { data: order, error: orderErr } = await supabase
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
      })
      .select('id')
      .single()
    if (orderErr) return NextResponse.json({ error: orderErr.message }, { status: 500 })
    orderId = order.id
  } else if (shipping_time && orderId) {
    await supabase.from('orders').update({ shipping_time }).eq('id', orderId)
  }

  let finalItem: Record<string, unknown>
  if (existingItem) {
    const oldQty = Number(existingItem.quantity) || 0
    let newQty = oldQty
    if (mode === 'increase' || mode === 'create') newQty += deltaQty
    else if (mode === 'decrease') newQty = Math.max(0, oldQty - deltaQty)
    else if (mode === 'set') newQty = deltaQty

    // 減量または上書きの結果 0 になった場合は明細を削除してクリーンアップ
    if (newQty <= 0) {
      await supabase.from('harvest_tasks').delete().eq('order_item_id', existingItem.id)
      await supabase.from('order_items').delete().eq('id', existingItem.id)
      if (existing?.id) {
        const { count } = await supabase
          .from('order_items')
          .select('id', { count: 'exact', head: true })
          .eq('order_id', existing.id)
        if ((count ?? 0) === 0) {
          await supabase.from('orders').delete().eq('id', existing.id)
        }
      }
      return NextResponse.json({ deleted: true, cancelled: true, mode }, { status: 200 })
    }

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

    const prevCleanedNote = (stripPriceFromNote(existingItem.line_note) ?? '')
      .split(/\s*\/\s*/)
      .filter((t) => t && !/^(?:数量変更:|🚨パック済|★?新規追加)/.test(t.trim()))
      .join(' / ')

    const combinedNote = [changeNote, prevCleanedNote, note]
      .filter((s): s is string => Boolean(s && s.trim()))
      .join(' / ') || null

    const updateCases = Math.floor(newQty / effectivePacksPerCase)
    const updateRem = newQty % effectivePacksPerCase
    const updatedQuantityRaw =
      updateRem > 0 ? `${updateCases}c+${updateRem}P` : `${updateCases}c`

    const { data: updatedItem, error: upErr } = await writeDroppingMissingColumns(
      {
        quantity: newQty,
        version: (Number(existingItem.version) || 1) + 1,
        quantity_raw: updatedQuantityRaw,
        fraction_note: updateRem > 0 ? `端数${updateRem}P` : null,
        spec: clientSpec?.trim() || existingItem.spec || effectiveSpec,
        container_type: clientContainerType?.trim() || existingItem.container_type || effectiveContainerType,
        has_card: clientHasCard ?? existingItem.has_card ?? effectiveHasCard,
        has_seal: clientHasSeal ?? existingItem.has_seal ?? effectiveHasSeal,
        seal_text: effectiveSealText ?? existingItem.seal_text ?? null,
        bag_type: effectiveBagType ?? existingItem.bag_type ?? null,
        line_note: combinedNote,
        is_manual_modified: true,
        ...(qtyChanged
          ? {
              field_status: 'not_started',
              shipped_qty: preservedPartialQty,
              snap_total_packs: oldQty,
            }
          : {}),
        updated_at: new Date().toISOString(),
      },
      (p) => supabase.from('order_items').update(p).eq('id', existingItem.id).select().single(),
    )
    if (upErr || !updatedItem) return NextResponse.json({ error: upErr?.message ?? 'update failed' }, { status: 500 })
    finalItem = updatedItem

    try {
      await writeAudit(supabase, {
        entityType: 'order_items',
        entityId: existingItem.id,
        action: 'UPDATE',
        oldValues: existingItem,
        newValues: updatedItem,
        userId: user.id,
      })
    } catch (auditErr) {
      console.warn('[api/shipments] audit warning:', auditErr)
    }
  } else {
    // 新規明細作成（単価・税率は商品マスタから。★新規追加トークンでボード上の新規バッジを点灯）
    const initCases = Math.floor(deltaQty / effectivePacksPerCase)
    const initRem = deltaQty % effectivePacksPerCase
    const initQuantityRaw =
      initRem > 0 ? `${initCases}c+${initRem}P` : `${initCases}c`
    const newAdditionLineNote = ['★新規追加', note].filter((s): s is string => Boolean(s && s.trim())).join(' / ')

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
        rule_id: (typeof rule?.id === 'string' ? rule.id : null),
        confidence: 1.0,
        field_status: 'not_started',
        line_note: newAdditionLineNote || '★新規追加',
        is_new_addition: true,
        spec: effectiveSpec,
        container_type: effectiveContainerType,
        has_card: effectiveHasCard,
        has_seal: effectiveHasSeal,
        seal_text: effectiveSealText,
        bag_type: effectiveBagType,
      },
      (p) => supabase.from('order_items').insert(p as never).select().single(),
    )
    if (itemErr || !item) return NextResponse.json({ error: itemErr?.message ?? 'insert failed' }, { status: 500 })
    finalItem = item

    try {
      await writeAudit(supabase, {
        entityType: 'order_items',
        entityId: String(item.id),
        action: 'INSERT',
        oldValues: null,
        newValues: item,
        userId: user.id,
      })
    } catch (auditErr) {
      console.warn('[api/shipments] audit warning:', auditErr)
    }
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

  // 💾 取引先×品目ルール（入数・規格・容器・カード・シール・袋）の自動保存・更新
  // 新規取引先やルール未登録の取引先でも、一度登録すれば次回選択時に全項目が自動セットされるようにする
  if (customer_id && product_id) {
    try {
      const rulePayload: Record<string, unknown> = {
        packs_per_case: effectivePacksPerCase,
        spec: effectiveSpec,
        label_spec: effectiveSpec,
        container_type: effectiveContainerType,
        has_card: effectiveHasCard,
      }
      if (effectiveHasSeal !== null && effectiveHasSeal !== undefined) {
        rulePayload.has_seal = effectiveHasSeal
      }
      if (effectiveSealText) {
        rulePayload.seal_text = effectiveSealText
      }
      if (effectiveBagType) {
        rulePayload.bag_type = effectiveBagType
      }
      if (rule && typeof rule.id === 'string') {
        await writeDroppingMissingColumns(rulePayload, (p) =>
          supabase.from('customer_product_rules').update(p).eq('id', rule.id as string),
        )
      } else {
        await writeDroppingMissingColumns(
          {
            customer_id,
            product_id,
            ...rulePayload,
          },
          (p) => supabase.from('customer_product_rules').insert(p as never),
        )
      }
    } catch (ruleUpsertErr) {
      console.warn('[api/shipments] customer_product_rules 自動保存警告:', ruleUpsertErr)
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

  // 📸 現場スマート追加からの添付写真・ファイルを order_receipts に自動保存（複数明細時は1レコード共有）
  let savedReceiptId: string | null = clientReceiptId ?? null
  const targetOrderId = (finalItem?.['order_id'] as string | undefined) ?? null
  if (targetOrderId) {
    try {
      if (savedReceiptId) {
        const { data: existingRec } = await supabase
          .from('order_receipts')
          .select('id, order_id, raw_payload')
          .eq('id', savedReceiptId)
          .maybeSingle()
        if (existingRec) {
          const rp = ((existingRec.raw_payload ?? {}) as Record<string, unknown>)
          const prevIds = Array.isArray(rp['created_order_ids'])
            ? (rp['created_order_ids'] as string[])
            : existingRec.order_id
            ? [existingRec.order_id]
            : []
          const nextIds = Array.from(new Set([...prevIds, targetOrderId]))
          await supabase
            .from('order_receipts')
            .update({
              order_id: existingRec.order_id ?? targetOrderId,
              raw_payload: { ...rp, created_order_ids: nextIds },
            })
            .eq('id', savedReceiptId)
        }
      } else if (original_file?.base64) {
        const { data: newRec } = await supabase
          .from('order_receipts')
          .insert({
            order_id: targetOrderId,
            customer_id,
            delivery_date,
            channel: 'manual',
            status: 'approved',
            received_at: new Date().toISOString(),
            raw_payload: {
              filename: original_file.fileName,
              content_type: original_file.mimeType,
              file_base64: original_file.base64,
              created_order_ids: [targetOrderId],
            },
          })
          .select('id')
          .single()
        if (newRec?.id) savedReceiptId = newRec.id
      }
      // 納品日経過+7日超の古い画像base64を非同期クリーンアップ（DB容量ゼロ維持）
      purgeOldReceiptBase64(supabase, 7).catch(() => {})
    } catch (recErr) {
      console.warn('[api/shipments] order_receipts アーカイブ警告:', recErr)
    }
  }

  return NextResponse.json(
    {
      item: finalItem,
      mode,
      learnedMistake,
      receiptId: savedReceiptId,
      previousQty: existingItem ? Number(existingItem.quantity) || 0 : 0,
      wasNewItem: !existingItem,
      effectivePacksPerCase,
    },
    { status: 201 },
  )
}
