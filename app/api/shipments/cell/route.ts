import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { writeDroppingMissingColumns } from '@/lib/supabase/missing-column'
import { matrixCellSchema } from '@/types/database'
import { parseQuantity } from '@/lib/calculations/parse-quantity'
import { determineHasCard, resolveContainerType } from '@/lib/pipeline/schemas'
import { runSideEffect, withWarnings, writeAuditAfterSuccess } from '@/lib/api/side-effects'
import { jstTodayStr, shiftDateStr } from '@/lib/dates'
import { resolvePacksPerCase, splitPacksForCustomer } from '@/lib/masters/packs-per-case'
import { requireStaffApi } from '@/lib/auth/api-guard'

export const runtime = 'nodejs'

/**
 * 週間マトリックスの1セル更新（#21 決定論的荷姿・規格・コンテナ補完 ＆ writeDroppingMissingColumns 対応）。
 * (取引先 × 納入先(任意) × 品目 × 出荷日) を1セルとして upsert / 削除する。
 */
export async function PUT(req: Request) {
  const guard = await requireStaffApi('forbidden')
  if (!guard.ok) return guard.response
  const user = guard.user

  const body = await req.json().catch(() => null)
  const parsed = matrixCellSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid', detail: parsed.error.flatten() }, { status: 400 })
  }
  const { customer_id, destination_id, product_id, delivery_date, quantity_raw } = parsed.data
  const supabase = createAdminClient()

  // 商品マスタ ＆ 取引先名 ＆ 納入先名
  const [{ data: product, error: prodErr }, { data: cust }, destRes] = await Promise.all([
    supabase
      .from('products')
      .select('id, name, unit, default_unit_price, default_tax_rate, container_capacity')
      .eq('id', product_id)
      .maybeSingle(),
    supabase.from('customers').select('name').eq('id', customer_id).maybeSingle(),
    destination_id
      ? supabase.from('delivery_destinations').select('*').eq('id', destination_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ])
  if (prodErr) return NextResponse.json({ error: prodErr.message }, { status: 500 })
  if (!product) return NextResponse.json({ error: 'unknown_product' }, { status: 400 })

  // P/C ルール（全カラム取得で0026差異を吸収）
  const { data: ruleRaw, error: ruleErr } = await supabase
    .from('customer_product_rules')
    .select('*')
    .eq('customer_id', customer_id)
    .eq('product_id', product_id)
    .maybeSingle()
  if (ruleErr) console.error('[api/shipments/cell] P/Cルールの取得に失敗:', ruleErr.message)
  const rule = ruleRaw as Record<string, unknown> | null

  const custName = cust?.name ?? ''
  const destName = destRes.data?.code || destRes.data?.full_name || ''
  // 規格・シールの既定（入数とは別の規則。ここでは変えない）
  const isNsk = custName.includes('農業総合研究所') || custName.toUpperCase().includes('NSK')

  // 入数：取引先別の設定 → 荷姿（取引先専用 → 取引先共通）→ 品目の標準 → 20（lib/masters/packs-per-case.ts）。
  // 週の管理の画面（app/field/matrix/page.tsx）と同じく取引先単位で決め、明細の荷姿は使わない
  // （画面の「1箱＝◯P」と保存される数量を一致させるため）。取引先名からの推測はしない。
  const { data: perCasePacks, error: perCasePacksErr } = await supabase
    .from('pack_configs')
    .select('id, product_id, customer_id, base_per_selling, is_active')
    .eq('product_id', product_id)
  if (perCasePacksErr) console.error('[api/shipments/cell] 入数用の荷姿の取得に失敗:', perCasePacksErr.message)
  const { customerPacks, sharedPacks } = splitPacksForCustomer(perCasePacks ?? [], customer_id, product_id)
  const defaultPpc = resolvePacksPerCase({
    rule: rule ? { packs_per_case: rule.packs_per_case as number | null } : null,
    customerPacks,
    sharedPacks,
    product,
  }).value

  let orderQuery = supabase
    .from('orders')
    .select('id')
    .eq('customer_id', customer_id)
    .eq('delivery_date', delivery_date)
    .neq('status', 'cancelled')

  if (destination_id) {
    orderQuery = orderQuery.eq('destination_id', destination_id)
  }

  const { data: order, error: orderErr } = await orderQuery
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (orderErr) return NextResponse.json({ error: orderErr.message }, { status: 500 })

  const existingItem = order
    ? (
        await supabase
          .from('order_items')
          .select('*')
          .eq('order_id', order.id)
          .eq('product_id', product_id)
          .limit(1)
          .maybeSingle()
      ).data
    : null

  const result = parseQuantity(quantity_raw, { packsPerCase: defaultPpc })
  // 付随更新（収穫数の同期など）の失敗は 500 にせず、成功応答の warnings で現場に知らせる
  const warnings: string[] = []

  // 空欄または0＝削除
  if (result.type === 'delete' || (result.type === 'ok' && result.total.toNumber() <= 0)) {
    if (existingItem) {
      await runSideEffect(
        warnings,
        '[api/shipments/cell] 削除時の harvest_tasks 削除に失敗',
        '数量は削除しましたが、収穫数の更新に失敗しました。画面を読み込み直して確認してください',
        () => supabase.from('harvest_tasks').delete().eq('order_item_id', existingItem.id),
      )
      const { error: delErr } = await supabase.from('order_items').delete().eq('id', existingItem.id)
      if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })
      await writeAuditAfterSuccess(
        supabase,
        {
          entityType: 'order_items',
          entityId: existingItem.id,
          action: 'DELETE',
          oldValues: existingItem,
          newValues: null,
          userId: user.id,
        },
        '[api/shipments/cell] 削除の監査ログ記録に失敗',
      )
      if (order) {
        const { count, error: countErr } = await supabase
          .from('order_items')
          .select('id', { count: 'exact', head: true })
          .eq('order_id', order.id)
        if (countErr) console.error('[api/shipments/cell] 残り明細数の取得に失敗:', countErr.message)
        if (!countErr && (count ?? 0) === 0) {
          await runSideEffect(
            warnings,
            '[api/shipments/cell] 明細が空になった orders の削除に失敗',
            '数量は削除しましたが、空になった注文の片付けに失敗しました。画面を読み込み直して確認してください',
            () => supabase.from('orders').delete().eq('id', order.id),
          )
        }
      }
    }
    return NextResponse.json(withWarnings({ deleted: true }, warnings))
  }

  if (result.type === 'error') {
    return NextResponse.json({ error: result.reason, input: result.input }, { status: 400 })
  }

  const quantity = result.total.toNumber()

  if (existingItem) {
    const oldQty = Number(existingItem.quantity) || 0
    const qtyChanged = quantity !== oldQty
    const wasPackedAndIncreased =
      qtyChanged &&
      quantity > oldQty &&
      (existingItem.field_status === 'packed' || existingItem.field_status === 'shipped')
    const preservedPartialQty = wasPackedAndIncreased
      ? oldQty
      : existingItem.shipped_qty && existingItem.shipped_qty > 0 && existingItem.shipped_qty < quantity
      ? existingItem.shipped_qty
      : null

    const { data: updated, error: updErr } = await writeDroppingMissingColumns(
      {
        quantity,
        quantity_raw: quantity_raw.trim() || String(quantity),
        version: (Number(existingItem.version) || 1) + 1,
        ...(qtyChanged
          ? {
              field_status: 'not_started',
              shipped_qty: preservedPartialQty,
            }
          : {}),
      },
      (p) => supabase.from('order_items').update(p).eq('id', existingItem.id).select().single(),
    )
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

    await runSideEffect(
      warnings,
      '[api/shipments/cell] 数量変更後の harvest_tasks.required_qty 同期に失敗',
      '数量は保存しましたが、収穫数の更新に失敗しました。画面を読み込み直して確認してください',
      () =>
        supabase
          .from('harvest_tasks')
          .update({ required_qty: quantity })
          .eq('order_item_id', existingItem.id),
    )

    await writeAuditAfterSuccess(
      supabase,
      {
        entityType: 'order_items',
        entityId: existingItem.id,
        action: 'UPDATE',
        oldValues: existingItem,
        newValues: updated,
        userId: user.id,
      },
      '[api/shipments/cell] 更新の監査ログ記録に失敗',
    )
    return NextResponse.json(withWarnings({ item: updated }, warnings))
  }

  let orderId = order?.id
  if (!orderId) {
    const { data: newOrder, error: createOrderErr } = await supabase
      .from('orders')
      .insert({
        customer_id,
        destination_id: destination_id ?? null,
        source: 'manual',
        status: 'approved',
        order_date: jstTodayStr(),
        delivery_date,
        delivery_date_source: 'manual',
        approved_at: new Date().toISOString(),
      })
      .select('id')
      .single()
    if (createOrderErr) return NextResponse.json({ error: createOrderErr.message }, { status: 500 })
    orderId = newOrder.id
  }

  // 決定論的規格・コンテナ・シール補完
  const ruleSpec =
    (typeof rule?.spec === 'string' && rule.spec) ||
    (typeof rule?.label_spec === 'string' && rule.label_spec) ||
    ''
  const baseSpec =
    ruleSpec ||
    (isNsk
      ? destName.includes('北海道')
        ? '200g'
        : '200gUP'
      : product.name.includes('小松菜')
      ? '200g'
      : product.name.includes('青梗菜') || product.name.includes('チンゲン')
      ? '2〜3株'
      : '')
  const effectiveSpec =
    baseSpec && !baseSpec.includes('入数')
      ? `${baseSpec} (入数${defaultPpc})`
      : baseSpec || `入数${defaultPpc}`

  const destDefaultContainer = (destRes.data as { default_container_type?: string | null } | null)?.default_container_type ?? null
  const effectiveContainer = resolveContainerType({
    ruleContainer:
      (typeof rule?.container_type === 'string' && rule.container_type) ||
      (typeof rule?.default_container_type === 'string' ? rule.default_container_type : null),
    destDefaultContainer,
    clientName: custName,
    destination: destName,
    rawText: effectiveSpec,
  })

  const effectiveHasCard = determineHasCard({
    ruleHasCard: typeof rule?.has_card === 'boolean' ? rule.has_card : null,
    clientName: custName,
    destination: destName,
    rawText: effectiveSpec,
  })
  const effectiveHasSeal =
    typeof rule?.has_seal === 'boolean'
      ? rule.has_seal
      : isNsk
      ? !destName.includes('北海道') && !effectiveSpec.startsWith('200g (')
      : null

  const { data: item, error: itemErr } = await writeDroppingMissingColumns<Record<string, unknown>, { code?: string; message?: string }>(
    {
      order_id: orderId,
      product_id,
      product_name: product.name,
      quantity,
      quantity_raw: quantity_raw.trim() || String(quantity),
      unit: product.unit,
      unit_price: product.default_unit_price ?? 0,
      tax_rate: product.default_tax_rate,
      rule_id: typeof rule?.id === 'string' ? rule.id : null,
      confidence: 1.0,
      field_status: 'not_started',
      spec: effectiveSpec,
      container_type: effectiveContainer,
      has_card: effectiveHasCard,
      has_seal: effectiveHasSeal,
    },
    (p) => supabase.from('order_items').insert(p as never).select().single(),
  )
  if (itemErr || !item) return NextResponse.json({ error: itemErr?.message ?? 'insert failed' }, { status: 500 })

  await writeAuditAfterSuccess(
    supabase,
    {
      entityType: 'order_items',
      entityId: String(item.id),
      action: 'INSERT',
      oldValues: null,
      newValues: item,
      userId: user.id,
    },
    '[api/shipments/cell] 追加の監査ログ記録に失敗',
  )

  // 全品目「出荷日の前日に収穫・パック」（engineering.md §3）
  const harvestDate = shiftDateStr(delivery_date, -1)
  await runSideEffect(
    warnings,
    '[api/shipments/cell] harvest_tasks の生成に失敗',
    '数量は保存しましたが、収穫の予定に追加できませんでした。画面を読み込み直して確認してください',
    () =>
      supabase.from('harvest_tasks').insert({
        product_id,
        order_item_id: String(item.id),
        required_qty: quantity,
        task_date: harvestDate,
        status: 'not_started',
      }),
  )

  return NextResponse.json(withWarnings({ item }, warnings), { status: 201 })
}
