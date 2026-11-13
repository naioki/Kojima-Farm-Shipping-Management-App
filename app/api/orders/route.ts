import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { writeDroppingMissingColumns } from '@/lib/supabase/missing-column'
import { writeAudit } from '@/lib/audit/log'
import { jstTodayStr, shiftDateStr } from '@/lib/dates'
import {
  determineHasCard,
  formatQuantityCaseText,
  generateOrderKey,
  resolveContainerType,
} from '@/lib/pipeline/schemas'
import { purgeOldReceiptBase64 } from '@/lib/receipts/retention'
import { positiveNumber, resolvePacksPerCase, splitPacksForCustomer } from '@/lib/masters/packs-per-case'
import { requireStaffApi } from '@/lib/auth/api-guard'
import { noteSideEffectFailure, runSideEffect } from '@/lib/api/side-effects'
import { upsertHarvestTasks } from '@/lib/harvest/upsert-tasks'

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
  const guard = await requireStaffApi()
  if (!guard.ok) return guard.response
  const user = guard.user
  const admin = createAdminClient()

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
  const [custRes, destRes, rulesRes, packsRes, productsRes] = await Promise.all([
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
    // 入数の「品目の標準」用
    productIds.length > 0
      ? admin.from('products').select('id, container_capacity').in('id', productIds)
      : Promise.resolve({ data: [], error: null }),
  ])
  if (productsRes.error) console.error('[api/orders] 品目の標準入数の取得に失敗:', productsRes.error.message)

  const customerName = custRes.data?.name ?? ''
  const destinationName = destRes.data?.full_name || destRes.data?.code || ''
  const ruleByProduct = new Map<string, Record<string, unknown>>(
    ((rulesRes.data ?? []) as Record<string, unknown>[]).map((r) => [String(r.product_id), r]),
  )
  const packRows = (packsRes.data ?? []) as { id: string; product_id: string; customer_id: string | null; label: string; base_per_selling: number }[]
  const packById = new Map(packRows.map((p) => [p.id, p]))
  const capacityByProduct = new Map(
    ((productsRes.data ?? []) as { id: string; container_capacity: number | null }[]).map((p) => [p.id, p.container_capacity]),
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
    // 入数：画面で入力された入数 → 取引先別の設定 → 荷姿（明細 → 取引先専用 → 取引先共通）→ 品目の標準 → 20
    // （lib/masters/packs-per-case.ts。取引先名・規格の文字列からの推測はしない）
    const { customerPacks, sharedPacks } = splitPacksForCustomer(packRows, customer_id, it.product_id)
    const effectivePacks =
      positiveNumber(it.packs_per_case) ??
      resolvePacksPerCase({
        rule: rule ? { packs_per_case: rule.packs_per_case as number | null } : null,
        packConfig: pack ?? null,
        customerPacks,
        sharedPacks,
        product: { container_capacity: capacityByProduct.get(it.product_id) ?? null },
      }).value

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
  /**
   * 本体（注文・明細）の保存後の付随更新の失敗（lib/api/side-effects.ts）。
   * この応答の `warnings` は既に「数量の異常値（品目ID→比率）」として使われているため、
   * 文字列の警告は `side_effect_warnings` で返す。
   *
   * 2026-11 時点で POST /api/orders を呼ぶ画面はリポジトリに無い（注文の受付・追加フォームは
   * /api/shipments 等を使う）。読む側が無いことを承知で応答のキーは残す。将来の呼び出し元は応答 JSON を
   * そのまま `showResponseWarnings`（lib/client/show-warnings.ts）に渡せば、この警告が表示される
   * （`warnings` は配列でないので無視され、`side_effect_warnings` だけが出る）。
   */
  const sideEffectWarnings: string[] = []

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

    const { data: existingItems, error: existingItemsErr } = await admin
      .from('order_items')
      .select('*')
      .eq('order_id', merge_order_id)
    if (existingItemsErr) {
      // 読めないまま進むと合算すべき明細を新規追加してしまう（二重登録）。書き込み前なので 500 で止める
      console.error('[POST /api/orders] merge: 既存明細の読み込みに失敗', existingItemsErr.message)
      return NextResponse.json({ error: '合算先の明細を読み込めなかったため、登録しませんでした。もう一度お試しください' }, { status: 500 })
    }

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
      await runSideEffect(
        sideEffectWarnings,
        '[POST /api/orders] merge: orders の出荷時間・備考の更新に失敗',
        '明細は合算しましたが、出荷時間・備考の更新に失敗しました。注文の詳細で確認してください',
        () =>
          admin
            .from('orders')
            .update({
              ...(shipping_time ? { shipping_time } : {}),
              ...(combinedNote ? { note: combinedNote } : {}),
            })
            .eq('id', merge_order_id),
      )
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

    // 先に harvest_tasks を削除してから order_items を削除。
    // harvest_tasks.order_item_id は ON DELETE CASCADE なので、ここが失敗しても次の明細削除で消える（ログのみ）
    await runSideEffect(null, '[POST /api/orders] replace: 旧明細の harvest_tasks 削除に失敗（明細削除のカスケードで消える）', undefined, () =>
      admin.from('harvest_tasks').delete().in(
        'order_item_id',
        ((oldItems ?? []) as { id?: string }[]).map((x) => x.id).filter((x): x is string => Boolean(x)),
      ),
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
        // 巻き戻し（order_items は orders の ON DELETE CASCADE で一緒に消える）
        const { error: rollbackErr } = await admin.from('orders').delete().eq('id', order.id)
        if (rollbackErr) {
          console.error('[POST /api/orders] 巻き戻し（注文の削除）に失敗。注文が残っています:', order.id, rollbackErr.message)
          return NextResponse.json(
            {
              error: `明細の登録に失敗しました: ${itemsErr.message}。登録途中の注文の一部が残っている可能性があります。注文一覧で確認してください`,
              orderId: order.id,
            },
            { status: 500 },
          )
        }
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
      const PACKS_WARNING = '注文は登録しましたが、入り数(P/C)を規格マスタに保存できませんでした。必要なら取引先の設定で登録してください'
      if (!rule) {
        await runSideEffect(sideEffectWarnings, '[POST /api/orders] packs_per_case の規格登録に失敗', PACKS_WARNING, () =>
          admin.from('customer_product_rules').insert({
            customer_id,
            product_id: it.product_id,
            packs_per_case: it.packs_per_case,
          }),
        )
      } else if (rule.packs_per_case == null) {
        await runSideEffect(sideEffectWarnings, '[POST /api/orders] packs_per_case の規格更新に失敗', PACKS_WARNING, () =>
          admin
            .from('customer_product_rules')
            .update({ packs_per_case: it.packs_per_case })
            .eq('customer_id', customer_id)
            .eq('product_id', it.product_id),
        )
      }
    }
  }

  // アップロードされた原本ファイルがある場合、order_receipts にアーカイブして現場FAX原本と紐付ける
  if (original_file && orderId) {
    const savedOriginal = await runSideEffect(
      sideEffectWarnings,
      '[POST /api/orders] 原本ファイルの order_receipts 保存に失敗',
      '注文は登録しましたが、原本ファイルの保存に失敗しました。原本が必要なら取り込み直してください',
      () =>
        admin.from('order_receipts').insert({
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
        }),
    )
    if (savedOriginal) {
      purgeOldReceiptBase64(admin, 7).catch((e) => console.error('[api/orders] 古い受信画像の片付けに失敗:', e))
    }
  }

  // 全品目「出荷日の前日に収穫・パック」の原則に従い harvest_tasks を自動同期
  if (delivery_date && orderId) {
    const HARVEST_WARNING = '注文は登録しましたが、収穫・パックの作業一覧の更新に失敗しました。収穫一覧で確認してください'
    try {
      const { data: dbItems, error: dbItemsErr } = await admin
        .from('order_items')
        .select('id, product_id, quantity')
        .eq('order_id', orderId)
      if (dbItemsErr) {
        noteSideEffectFailure(sideEffectWarnings, '[POST /api/orders] harvest_tasks 同期用の明細読み込みに失敗', dbItemsErr, HARVEST_WARNING)
      }

      // 1明細1件: 既存タスクは数量・日付だけ更新し、無ければ作る。進捗（status・担当）は消さない（lib/harvest/upsert-tasks.ts）
      if (dbItems && dbItems.length > 0) {
        const harvestTaskDate = shiftDateStr(delivery_date, -1)
        const taskRows = dbItems
          .filter((it) => Boolean(it.product_id))
          .map((it) => ({
            product_id: it.product_id!,
            order_item_id: it.id,
            required_qty: Number(it.quantity),
            task_date: harvestTaskDate,
          }))

        if (taskRows.length > 0) {
          const { error: htErr } = await upsertHarvestTasks(admin, taskRows)
          if (htErr) noteSideEffectFailure(sideEffectWarnings, '[POST /api/orders] harvest_tasks 自動生成・更新エラー', htErr, HARVEST_WARNING)
        }
      }
    } catch (htEx) {
      noteSideEffectFailure(sideEffectWarnings, '[POST /api/orders] harvest_tasks 生成失敗 (続行)', htEx, HARVEST_WARNING)
    }
  }

  return NextResponse.json({
    orderId,
    replaced,
    merged,
    warnings,
    ...(sideEffectWarnings.length > 0 ? { side_effect_warnings: sideEffectWarnings } : {}),
  })
}
