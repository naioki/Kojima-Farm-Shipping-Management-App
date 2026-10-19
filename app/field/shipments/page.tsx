import Link from 'next/link'
import { CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/cn'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { ErrorState } from '@/components/ui/States'
import { formatQty } from '@/lib/calculations/format-qty'
import { jstTodayStr, shiftDateStr } from '@/lib/dates'
import { DateNav } from '@/components/field/DateNav'
import { FieldViewSwitch } from '@/components/field/FieldViewSwitch'
import { GuideTourLauncher } from '@/components/guide/GuideTourLauncher'
import { SHIPMENTS_TOUR } from '@/lib/guide/tours'
import { getStaffFeatures, canStaffUse } from '@/lib/field/features'
import { getSetting } from '@/lib/settings'
import { ProductSelectorTabs, type ProductTabItem } from '@/components/field/ProductSelectorTabs'
import { HarvestPulseSummary, type ContainerBreakdownItem, type SpecBreakdownItem } from '@/components/field/HarvestPulseSummary'
import { PackingAndShippingViews, type ShipmentItemData } from '@/components/field/PackingAndShippingViews'
import { ShipmentAddForm } from '@/components/field/ShipmentAddForm'
import type { SpecWarning, PackPhotoKind, FieldStatus } from '@/types/database'
import type { PackInstructionValues, PackInstructionPhoto } from '@/components/admin/PackInstructions'
import type { ReceiptOriginalInfo } from '@/lib/orders/pending'

type PackInstructionRow = {
  id: string
  base_per_selling: number
  selling_unit_label: string
  needs_manual_confirm: boolean
} & PackInstructionValues

export const dynamic = 'force-dynamic'

const PATH = '/field/shipments'

export default async function ShipmentsPage({
  searchParams,
}: {
  searchParams: { date?: string; product?: string }
}) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.date ?? '') ? searchParams.date! : jstTodayStr()
  const supabase = createClient()

  const user = await getAuthedUser()
  const { data: profile, error: profileErr } = user
    ? await supabase.from('users').select('role').eq('id', user.id).maybeSingle()
    : { data: null, error: null }
  if (profileErr) console.error('[field/shipments] ロールの取得に失敗:', profileErr.message)
  const role = (profile?.role as 'admin' | 'staff') ?? 'staff'
  const isAdmin = role === 'admin'
  const staffFeatures = await getStaffFeatures()
  const canReportSpec = canStaffUse('reportSpec', role, staffFeatures)

  // 通知設定
  const overdueAlertSetting = await getSetting('OVERDUE_ALERT_ENABLED')
  const isOverdueAlertOn = overdueAlertSetting !== 'off'

  // ① 全商品一覧の取得（品目タブ構築用）
  const { data: allProducts, error: prodErr } = await supabase
    .from('products')
    .select('id, name, unit, category')
    .eq('is_active', true)
    .order('category', { nullsFirst: false })
    .order('name')
  if (prodErr) return <ErrorState message={`商品の読み込みに失敗しました: ${prodErr.message}`} />

  // ② 当日の注文（キャンセル除外）＋ B案の未確定FAX件数の取得
  const [{ data: orders, error: ordersErr }, { count: pendingReceiptCount }] = await Promise.all([
    supabase
      .from('orders')
      .select('id, customer_id, destination_id, status')
      .eq('delivery_date', date)
      .neq('status', 'cancelled'),
    supabase
      .from('order_receipts')
      .select('id', { count: 'exact', head: true })
      .in('status', ['pending_review', 'unmatched', 'ai_failed']),
  ])
  if (ordersErr) return <ErrorState message={ordersErr.message} />

  const orderIds = (orders ?? []).map((o) => o.id)
  const orderToCustomer = new Map((orders ?? []).map((o) => [o.id, o.customer_id]))
  const orderToDestination = new Map((orders ?? []).map((o) => [o.id, o.destination_id]))

  // ③ 当日の明細取得（0026未適用DB環境にも安全にフォールバック）
  type RawOrderItemRow = {
    id: string
    order_id: string
    product_id: string
    product_name: string
    quantity: number
    unit: string
    field_status: FieldStatus
    version: number
    spec: string | null
    container_type: string | null
    has_card: boolean | null
    line_note: string | null
    shipped_qty: number | null
    field_note: string | null
    spec_warnings: SpecWarning[] | null
    pack_config_id: string | null
    rule_id: string | null
    is_flagged?: boolean | null
    bag_type?: string | null
    seal_text?: string | null
    has_seal?: boolean | null
    daily_pack_sort_order?: number | null
    snap_total_packs?: number | null
    is_manual_modified?: boolean | null
    is_new_addition?: boolean | null
  }
  let allItems: RawOrderItemRow[] = []
  if (orderIds.length) {
    const v5ItemsRes = await supabase
      .from('order_items')
      .select(`
        id, order_id, product_id, product_name, quantity, unit, field_status, version,
        spec, container_type, has_card, line_note, shipped_qty, field_note, spec_warnings,
        pack_config_id, rule_id, is_flagged, bag_type, seal_text, has_seal, daily_pack_sort_order,
        snap_total_packs, is_manual_modified, is_new_addition
      `)
      .in('order_id', orderIds)
      .order('product_name')
    if (v5ItemsRes.error) {
      const fallbackRes = await supabase
        .from('order_items')
        .select(`
          id, order_id, product_id, product_name, quantity, unit, field_status, version,
          spec, container_type, has_card, line_note, shipped_qty, field_note, spec_warnings,
          pack_config_id, rule_id, is_flagged
        `)
        .in('order_id', orderIds)
        .order('product_name')
      if (fallbackRes.error) {
        return <ErrorState message="出荷明細を読み込めませんでした。" detail={fallbackRes.error.message} />
      }
      allItems = (fallbackRes.data ?? []) as RawOrderItemRow[]
    } else {
      allItems = (v5ItemsRes.data ?? []) as RawOrderItemRow[]
    }
  }

  // ④ 品目ごとの件数集計＆タブ一覧生成
  const countByProduct = new Map<string, number>()
  for (const it of allItems) {
    countByProduct.set(it.product_id, (countByProduct.get(it.product_id) ?? 0) + 1)
  }

  // 注文がある品目を優先して並べ、残りの品目を後ろに配置（資材等は0件なら非表示）
  const productTabs: ProductTabItem[] = (allProducts ?? [])
    .filter((p) => !(p.category === '資材' && (countByProduct.get(p.id) ?? 0) === 0))
    .map((p) => ({
      id: p.id,
      name: p.name,
      count: countByProduct.get(p.id) ?? 0,
    }))
    .sort((a, b) => b.count - a.count)

  // 選択された品目（クエリ指定がなければ注文数が最大の品目、それもなければ先頭品目）
  const selectedProductId = searchParams.product && allProducts?.some((p) => p.id === searchParams.product)
    ? searchParams.product
    : productTabs[0]?.id || ''
  const selectedProduct = allProducts?.find((p) => p.id === selectedProductId)

  // ⑤ 選択された1品目の明細行に絞り込み（単一品目フォーカス）
  const items = allItems.filter((i) => i.product_id === selectedProductId)

  // ⑥ 納入先（出発便・時間・デフォルト作業順・コンテナ）取得（0026フォールバック付き）
  const destinationIds = [...new Set((orders ?? []).map((o) => o.destination_id).filter(Boolean))] as string[]
  const customerIds = [...new Set((orders ?? []).map((o) => o.customer_id))]
  const productIds = [...new Set(items.map((i) => i.product_id))]

  type DestRow = {
    id: string
    code: string | null
    full_name: string
    sort_order?: number
    pack_sort_order?: number | null
    shipping_route_name?: string | null
    departure_time?: string | null
    default_container_type?: string | null
  }

  const [custRes, prodCapRes, destRows] = await Promise.all([
    customerIds.length
      ? supabase.from('customers').select('id, name, display_color').in('id', customerIds)
      : Promise.resolve({ data: [], error: null }),
    productIds.length
      ? supabase.from('products').select('id, container_capacity').in('id', productIds)
      : Promise.resolve({ data: [], error: null }),
    (async (): Promise<DestRow[]> => {
      if (!destinationIds.length) return []
      const r1 = await supabase
        .from('delivery_destinations')
        .select('id, code, full_name, sort_order, pack_sort_order, shipping_route_name, departure_time, default_container_type')
        .in('id', destinationIds)
      if (!r1.error) return (r1.data ?? []) as DestRow[]
      const r2 = await supabase
        .from('delivery_destinations')
        .select('id, code, full_name, sort_order')
        .in('id', destinationIds)
      return (r2.data ?? []) as DestRow[]
    })(),
  ])

  const customerName = new Map((custRes.data ?? []).map((c) => [c.id, c.name]))
  const customerColor = new Map((custRes.data ?? []).map((c) => [c.id, c.display_color]))
  const capacityById = new Map((prodCapRes.data ?? []).map((p) => [p.id, p.container_capacity]))
  const destinationMap = new Map(destRows.map((d) => [d.id, d]))

  // 荷姿マスタ取得
  const packIds = [...new Set(items.map((i) => i.pack_config_id).filter(Boolean))] as string[]
  const { data: packRows, error: packErr } = packIds.length
    ? await supabase
        .from('pack_configs')
        .select(`
          id, base_per_selling, selling_unit_label, needs_manual_confirm, spec_note, has_card,
          has_seal, tape_color, label_spec, price_tag_required, returnable_container, quality_note,
          standing_notes, field_memo
        `)
        .in('id', packIds)
    : { data: [] as PackInstructionRow[], error: null }
  if (packErr) console.error('[field/shipments] pack_configs 取得失敗:', packErr.message)

  const packById = new Map((packRows ?? []).map((p) => [p.id, { base: Number(p.base_per_selling), unit: p.selling_unit_label }]))
  const needsConfirmByPack = new Map((packRows ?? []).map((p) => [p.id, p.needs_manual_confirm]))
  const packInstructionsById = new Map((packRows ?? []).map((p) => [p.id, p as PackInstructionValues]))

  // 受注原本取得
  const { data: receiptRows } = orderIds.length
    ? await supabase
        .from('order_receipts')
        .select('id, order_id, channel, r2_key, raw_payload, is_revision')
        .in('order_id', orderIds)
    : { data: [] }
  const receiptByOrder = new Map<string, ReceiptOriginalInfo>()
  for (const rr of receiptRows ?? []) {
    if (!rr.order_id) continue
    receiptByOrder.set(rr.order_id, {
      id: rr.id,
      channel: rr.channel,
      hasOriginal: Boolean(rr.r2_key || rr.raw_payload),
      emailText: null,
      isRevision: Boolean(rr.is_revision),
      parent: null,
    })
  }

  // 梱包マスタ（rule_id 紐付けだけでなく customer_id × product_id のペアでも確実に解決）
  const { data: ruleRows } = await supabase
    .from('customer_product_rules')
    .select('*')
  const ruleById = new Map((ruleRows ?? []).map((r) => [r.id as string, r as Record<string, unknown>]))
  const ruleByPair = new Map((ruleRows ?? []).map((r) => [`${r.customer_id}:${r.product_id}`, r as Record<string, unknown>]))

  // ⑦ 冷蔵庫コンテナ在庫の取得（当日＆前日持ち越し・テーブル未作成時もエラーにしない）
  const prevDate = new Date(date)
  prevDate.setDate(prevDate.getDate() - 1)
  const prevDateStr = prevDate.toISOString().split('T')[0]

  const [{ data: currentInv }, { data: prevInv }] = await Promise.all([
    supabase
      .from('daily_container_inventory')
      .select('stock_containers, carryover_to_next_day')
      .eq('target_date', date)
      .eq('product_id', selectedProductId)
      .maybeSingle(),
    supabase
      .from('daily_container_inventory')
      .select('carryover_to_next_day')
      .eq('target_date', prevDateStr)
      .eq('product_id', selectedProductId)
      .maybeSingle(),
  ])

  const prevCarryover = prevInv?.carryover_to_next_day ?? 0
  const initialStock = currentInv?.stock_containers ?? prevCarryover

  // ⑧ 選択中品目の集計（注文総箱数・総パック数・コンテナ内訳・規格内訳）
  let totalPacks = 0
  let totalBoxes = 0
  const containerCounts = new Map<string, number>()
  const specCounts = new Map<string, { packs: number; boxes: number }>()

  const shipmentItems: ShipmentItemData[] = items.map((it) => {
    const custId = orderToCustomer.get(it.order_id)
    const destId = orderToDestination.get(it.order_id)
    const dest = destId ? destinationMap.get(destId) : null
    const cName = custId ? customerName.get(custId) ?? '—' : '—'
    const dName = dest?.code?.trim() || dest?.full_name || cName
    const color = custId ? customerColor.get(custId) ?? null : null

    const pack = it.pack_config_id ? packById.get(it.pack_config_id) : null
    const rule = (it.rule_id ? ruleById.get(it.rule_id) : null) ?? (custId ? ruleByPair.get(`${custId}:${it.product_id}`) : null)
    const rulePacksPerCase = typeof rule?.packs_per_case === 'number' ? rule.packs_per_case : null
    const ruleLabelSpec = typeof rule?.label_spec === 'string' ? rule.label_spec : null
    const ruleTapeColor = typeof rule?.tape_color === 'string' ? rule.tape_color : null
    const rulePackingNotes = typeof rule?.packing_notes === 'string' ? rule.packing_notes : null
    const ruleBagType = typeof rule?.bag_type === 'string' ? rule.bag_type : null
    const ruleSealText = typeof rule?.seal_text === 'string' ? rule.seal_text : null
    const ruleHasSeal = typeof rule?.has_seal === 'boolean' ? rule.has_seal : null

    // 入数判定: pack_configs -> customer_product_rules -> 規格文字抽出(determineUnitCount) -> チンゲン菜標準20
    const explicitUnit = pack?.base || rulePacksPerCase || capacityById.get(it.product_id)
    const perCase = explicitUnit && explicitUnit > 0
      ? explicitUnit
      : (cName.includes('農業総合研究所') || cName.includes('NSK') || (it.spec ?? '').includes('24') ? 24 : 20)

    const qty = it.quantity
    totalPacks += qty

    // 箱数計算: ケース数 + (端数 > 0 ? 1 : 0)
    const cases = Math.floor(qty / perCase)
    const rem = qty % perCase
    const boxCount = cases + (rem > 0 ? 1 : 0)
    totalBoxes += boxCount

    // コンテナ集計
    const contType = it.container_type || dest?.default_container_type || (dName.includes('岩槻') ? '青コン' : dName.includes('戸田') ? '茶コン' : '通常コンテナ')
    containerCounts.set(contType, (containerCounts.get(contType) ?? 0) + boxCount)

    // 規格集計
    const specLabel = it.spec || ruleLabelSpec || '2〜3株 (標準)'
    const curSpec = specCounts.get(specLabel) ?? { packs: 0, boxes: 0 }
    curSpec.packs += qty
    curSpec.boxes += boxCount
    specCounts.set(specLabel, curSpec)

    return {
      itemId: it.id,
      customerName: cName,
      customerColor: color,
      destinationName: dName,
      quantityText: formatQty(qty, capacityById.get(it.product_id) ?? null, pack),
      orderedQty: qty,
      initialStatus: it.field_status,
      initialVersion: it.version,
      initialSpec: it.spec,
      initialContainer: contType,
      initialHasCard: it.has_card,
      initialLineNote: it.line_note,
      initialShippedQty: it.shipped_qty,
      initialFieldNote: it.field_note,
      specWarnings: it.spec_warnings,
      masterLabelSpec: ruleLabelSpec,
      masterTapeColor: ruleTapeColor,
      masterPackingNotes: rulePackingNotes,
      masterPacksPerCase: perCase,
      needsManualConfirm: Boolean(it.is_flagged) || (it.pack_config_id ? Boolean(needsConfirmByPack.get(it.pack_config_id)) : false),
      packInstructions: it.pack_config_id ? packInstructionsById.get(it.pack_config_id) : null,
      customerId: custId,
      productId: it.product_id,
      canEditRulesDirectly: isAdmin,
      canReportSpec,
      bagType: it.bag_type ?? ruleBagType,
      sealText: it.seal_text ?? ruleSealText,
      hasSeal: it.has_seal ?? ruleHasSeal,
      dailyPackSortOrder: it.daily_pack_sort_order,
      defaultPackSortOrder: dest?.pack_sort_order ?? 100,
      shippingRouteName: dest?.shipping_route_name,
      departureTime: dest?.departure_time,
      deliveryDate: date,
      showShippingButton: false,
      receipt: receiptByOrder.get(it.order_id) ?? null,
    }
  })

  const containerBreakdown: ContainerBreakdownItem[] = Array.from(containerCounts.entries()).map(([type, boxes]) => ({
    type,
    boxes,
  }))

  const specBreakdown: SpecBreakdownItem[] = Array.from(specCounts.entries()).map(([spec, data]) => ({
    spec,
    packs: data.packs,
    boxes: data.boxes,
  }))

  // 追加フォーム用
  const [
    { data: allCustomers },
    { data: rules },
    { data: allDestinations },
  ] = await Promise.all([
    supabase.from('customers').select('id, name').eq('is_active', true).order('name'),
    supabase.from('customer_product_rules').select('customer_id, product_id, packs_per_case'),
    supabase.from('delivery_destinations').select('id, customer_id, code, full_name').eq('is_active', true).order('sort_order'),
  ])
  const packsByPair: Record<string, number | null> = {}
  for (const r of rules ?? []) packsByPair[`${r.customer_id}:${r.product_id}`] = r.packs_per_case

  const unconfirmedCount = pendingReceiptCount ?? 0

  return (
    <div className="mx-auto max-w-2xl space-y-3.5 pb-10">
      {/* ナビゲーションバー */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h1 className="font-display text-xl font-black text-ink">当日出荷・収穫ボード</h1>
          <FieldViewSwitch active="day" date={date} />
          <GuideTourLauncher tour={SHIPMENTS_TOUR} />
        </div>
        <DateNav date={date} basePath={PATH} />
      </div>

      {/* 現場業務ナビゲーション（🥬 収穫・袋詰めボード ⇋ 🚚 全品目便別積込・配送） */}
      <div className="flex items-center justify-between rounded-xl bg-bg-soft p-1 border border-line text-xs font-bold">
        <div className="flex items-center gap-1">
          <span className="flex items-center gap-1.5 rounded-lg bg-forest-700 px-3 py-1.5 text-white shadow-xs">
            🥬 収穫・袋詰めボード
          </span>
          <Link
            href={`/field/deliveries?date=${date}`}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-ink-soft hover:text-ink hover:bg-white/60 transition"
          >
            🚚 便別積込・配送リスト
          </Link>
        </div>
        <Link
          href={`/field/deliveries?date=${date}`}
          className="text-[11px] text-ink-muted hover:text-forest-700 pr-2 transition"
        >
          全品目の便別積込へ →
        </Link>
      </div>

      {/* B案：判別不能・要確認の未確定FAXがある場合の最上部赤バナー */}
      {unconfirmedCount > 0 && (
        <a
          href={isAdmin ? '/admin/inbox' : '/field/approvals'}
          className="flex items-center justify-between gap-2 rounded-2xl border-2 border-red-500 bg-red-50 px-4 py-3 text-red-900 shadow-sm transition hover:bg-red-100"
        >
          <div className="flex items-center gap-2 text-sm font-black">
            <span>🚨 未確定・要確認のFAXが {unconfirmedCount} 件あります</span>
          </div>
          <span className="shrink-0 rounded-lg bg-red-600 px-3 py-1 text-xs font-bold text-white shadow-xs">
            タップして確認 →
          </span>
        </a>
      )}

      {/* ① 最上部：品目セレクタ（タブ） */}
      <ProductSelectorTabs
        products={productTabs}
        selectedProductId={selectedProductId}
        date={date}
      />

      {/* ② 収穫自動逆算サマリー（コンテナ在庫差引＋折りたたみ内訳） */}
      {selectedProduct && (
        <HarvestPulseSummary
          key={`pulse-${date}-${selectedProductId}`}
          productName={selectedProduct.name}
          productId={selectedProductId}
          date={date}
          totalPacks={totalPacks}
          totalBoxes={totalBoxes}
          initialStock={initialStock}
          prevCarryover={prevCarryover}
          containerBreakdown={containerBreakdown}
          specBreakdown={specBreakdown}
        />
      )}

      {/* ③ パック画面 / 出荷画面（切替表示） */}
      {shipmentItems.length > 0 ? (
        <PackingAndShippingViews
          key={`views-${date}-${selectedProductId}`}
          items={shipmentItems}
          date={date}
          isAdmin={isAdmin}
          overdueAlertEnabled={isOverdueAlertOn}
        />
      ) : (
        <div className="rounded-2xl border border-dashed border-line bg-white p-8 text-center text-ink-muted space-y-3">
          <p className="font-bold text-sm text-ink">この日の【{selectedProduct?.name || '選択品目'}】の出荷データはありません。</p>
          <p className="text-xs text-ink-faint">他の品目タブを選ぶか、翌日の出荷予定を確認できます。</p>
          <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
            <a
              href={`/field/shipments?date=${shiftDateStr(date, 1)}&product=${selectedProductId}`}
              className="inline-flex items-center gap-1 rounded-xl bg-forest-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-forest-700 shadow-xs"
            >
              翌日の予定を見る →
            </a>
            {isAdmin && (
              <a
                href="/admin/inbox"
                className="inline-flex items-center gap-1 rounded-xl border border-line bg-bg-soft px-3.5 py-2 text-xs font-bold text-ink hover:bg-slate-200"
              >
                受注ボックスを確認
              </a>
            )}
          </div>
        </div>
      )}

      {/* ④ スマート追加フォーム */}
      <ShipmentAddForm
        deliveryDate={date}
        customers={(allCustomers ?? []).map((c) => ({ id: c.id, name: c.name }))}
        products={(allProducts ?? []).map((p) => ({ id: p.id, name: p.name, unit: p.unit, category: p.category }))}
        destinations={(allDestinations ?? []).map((d) => ({
          id: d.id,
          customerId: d.customer_id,
          label: d.code?.trim() || d.full_name,
        }))}
        packsByPair={packsByPair}
      />
    </div>
  )
}
