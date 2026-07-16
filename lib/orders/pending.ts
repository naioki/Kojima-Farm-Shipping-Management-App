import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { getSetting } from '@/lib/settings'
import { parseThreshold } from '@/lib/ingestion/auto-approve'

/**
 * 承認待ち（pending_review）注文の取得（管理者/スタッフ承認画面で共有）。
 * 各注文に「スタッフが承認できるか（高確信・取引先一致・納品日確定）」を付与する。
 */
export interface PackConfigOption {
  id: string
  label: string
}

export interface PendingOrderItem {
  id: string
  productId: string | null
  productName: string
  quantity: number
  unit: string
  confidence: number | null
  /** 楽観ロック用。編集（数量変更）の PATCH に必要。 */
  version: number
  /** 荷姿マスタ確定済みID（未確定は null） */
  packConfigId: string | null
  /** この商品×取引先で選べる荷姿（0件＝マスタ未登録なのでゲート対象外） */
  packConfigOptions: PackConfigOption[]
}

export interface DestinationOption {
  id: string
  label: string
}

/** 承認画面で原本（FAX画像/PDF・メール本文）を比較表示するための最小情報。 */
export interface ReceiptOriginalInfo {
  id: string
  channel: string
  /** R2に画像/PDFがあるか（FAXはほぼ常にtrue。テキストのみのメールはfalse） */
  hasOriginal: boolean
  /** テキストメールの本文（原本画像が無い場合の表示用） */
  emailText: string | null
  /** 「同じFAXに追記して再送」された差分受信か */
  isRevision: boolean
  /** 再送の場合の元受信（無ければ null） */
  parent: { id: string; hasOriginal: boolean; emailText: string | null } | null
}

export interface PendingOrder {
  id: string
  source: string
  deliveryDate: string | null
  customerId: string | null
  customerName: string
  customerColor: string | null
  /** 確定済み納入先の表示名（未確定・納入先なしの取引先は null）。取引先＞納入先の表記に使う。 */
  destinationName: string | null
  items: PendingOrderItem[]
  /** 最低確信度（null は確信度なし＝要注意） */
  minConfidence: number | null
  /** 納品日が未確定（承認時に入力が必要） */
  needsDeliveryDate: boolean
  /** 納入先未確定（取引先に納入先が登録されているのに未選択。承認時に選択が必要） */
  needsDestination: boolean
  /** 選べる納入先（取引先に登録がなければ0件） */
  destinationOptions: DestinationOption[]
  /** スタッフでも承認できるか（高確信・取引先一致・納品日確定） */
  staffApprovable: boolean
  /** 受信原本（手動入力・ポータル注文は null＝原本なし） */
  receipt: ReceiptOriginalInfo | null
}

/** 要確認の理由（やさしい日本語のバッジ／注意喚起に使う・admin/field 共通）。 */
export function pendingReasons(o: PendingOrder): string[] {
  const r: string[] = []
  if (!o.customerId) r.push('取引先 みとうろく')
  if (o.needsDeliveryDate) r.push('のうひん日 みてい')
  if (o.needsDestination) r.push('のうにゅうさき みてい')
  if (o.items.some((it) => it.packConfigOptions.length > 0 && !it.packConfigId)) r.push('荷姿 みてい')
  if (o.minConfidence == null || o.minConfidence < 0.7) r.push('AI じしんなし')
  return r
}

export async function getPendingOrders(): Promise<PendingOrder[]> {
  const supabase = createClient()
  const threshold = parseThreshold(await getSetting('AUTO_APPROVE_THRESHOLD'))

  const { data: orders } = await supabase
    .from('orders')
    .select('id, source, delivery_date, customer_id, destination_id')
    .eq('status', 'pending_review')
    .order('created_at', { ascending: true })

  if (!orders || orders.length === 0) return []

  const orderIds = orders.map((o) => o.id)
  const customerIds = [...new Set(orders.map((o) => o.customer_id).filter(Boolean))] as string[]

  const [{ data: items }, { data: custs }, { data: destRows }] = await Promise.all([
    supabase
      .from('order_items')
      .select('id, order_id, product_id, product_name, quantity, unit, confidence, version, pack_config_id')
      .in('order_id', orderIds),
    customerIds.length
      ? supabase.from('customers').select('id, name, display_color').in('id', customerIds)
      : Promise.resolve({ data: [] as { id: string; name: string; display_color: string | null }[] }),
    customerIds.length
      ? supabase.from('delivery_destinations').select('id, customer_id, code, full_name').eq('is_active', true).in('customer_id', customerIds)
      : Promise.resolve({ data: [] as { id: string; customer_id: string; code: string | null; full_name: string }[] }),
  ])

  const productIds = [...new Set((items ?? []).map((it) => it.product_id).filter(Boolean))] as string[]
  const { data: packConfigs } = productIds.length
    ? await supabase
        .from('pack_configs')
        .select('id, product_id, customer_id, label')
        .eq('is_active', true)
        .in('product_id', productIds)
    : { data: [] as { id: string; product_id: string; customer_id: string | null; label: string }[] }

  // 受信原本（承認画面での比較表示用）。手動入力・ポータル注文は receipt が無い。
  const { data: receiptRows } = await supabase
    .from('order_receipts')
    .select('id, order_id, channel, r2_key, raw_payload, is_revision, parent_id')
    .in('order_id', orderIds)

  const parentIds = [...new Set((receiptRows ?? []).map((r) => r.parent_id).filter(Boolean))] as string[]
  const { data: parentRows } = parentIds.length
    ? await supabase.from('order_receipts').select('id, r2_key, raw_payload').in('id', parentIds)
    : { data: [] as { id: string; r2_key: string | null; raw_payload: unknown }[] }
  const parentById = new Map((parentRows ?? []).map((p) => [p.id, p]))

  const emailTextOf = (raw: unknown): string | null => {
    if (!raw || typeof raw !== 'object') return null
    const text = (raw as { text?: unknown }).text
    return typeof text === 'string' && text.trim() ? text : null
  }

  // 1注文につき受信は1件想定（process-receipt.ts が受信ごとに新規orderを作る）。複数あれば最新を使う。
  const receiptByOrder = new Map<string, NonNullable<typeof receiptRows>[number]>()
  for (const r of receiptRows ?? []) {
    if (!receiptByOrder.has(r.order_id)) receiptByOrder.set(r.order_id, r)
  }

  const custName = new Map((custs ?? []).map((c) => [c.id, c.name]))
  const custColor = new Map((custs ?? []).map((c) => [c.id, c.display_color]))
  const destLabelById = new Map((destRows ?? []).map((d) => [d.id, d.code || d.full_name]))
  const destByCustomer = new Map<string, DestinationOption[]>()
  for (const d of destRows ?? []) {
    const arr = destByCustomer.get(d.customer_id) ?? []
    arr.push({ id: d.id, label: d.code || d.full_name })
    destByCustomer.set(d.customer_id, arr)
  }

  type ItemRow = NonNullable<typeof items>[number]
  const itemsByOrder = new Map<string, ItemRow[]>()
  for (const it of items ?? []) {
    const arr = itemsByOrder.get(it.order_id) ?? []
    arr.push(it)
    itemsByOrder.set(it.order_id, arr)
  }

  return orders.map((o) => {
    const rawItems = itemsByOrder.get(o.id) ?? []
    if (rawItems.length === 0) return null // 明細ゼロの空注文は承認画面に出さない
    const orderItems: PendingOrderItem[] = rawItems.map((it) => ({
      id: it.id,
      productId: it.product_id,
      productName: it.product_name,
      quantity: Number(it.quantity),
      unit: it.unit,
      confidence: it.confidence != null ? Number(it.confidence) : null,
      version: Number(it.version ?? 1),
      packConfigId: it.pack_config_id,
      packConfigOptions: (packConfigs ?? [])
        .filter((pc) => pc.product_id === it.product_id && (pc.customer_id === o.customer_id || pc.customer_id === null))
        .map((pc) => ({ id: pc.id, label: pc.label })),
    }))
    const confidences = orderItems.map((i) => i.confidence)
    const minConfidence = confidences.length
      ? confidences.reduce<number | null>((min, c) => {
          if (c == null) return null
          if (min == null) return min // 一度 null を見たら null（未採点あり）
          return Math.min(min, c)
        }, 1)
      : null
    const needsDeliveryDate = !o.delivery_date
    const destinationOptions = o.customer_id ? destByCustomer.get(o.customer_id) ?? [] : []
    const needsDestination = !o.destination_id && destinationOptions.length > 0
    const needsPackConfig = orderItems.some((it) => it.packConfigOptions.length > 0 && !it.packConfigId)
    const allConfident = orderItems.length > 0 && minConfidence != null && minConfidence >= threshold
    const staffApprovable =
      Boolean(o.customer_id) && !needsDeliveryDate && !needsDestination && !needsPackConfig && allConfident

    const rr = receiptByOrder.get(o.id)
    const receipt: ReceiptOriginalInfo | null = rr
      ? {
          id: rr.id,
          channel: rr.channel,
          hasOriginal: Boolean(rr.r2_key),
          emailText: emailTextOf(rr.raw_payload),
          isRevision: Boolean(rr.is_revision),
          parent:
            rr.parent_id && parentById.has(rr.parent_id)
              ? (() => {
                  const p = parentById.get(rr.parent_id)!
                  return { id: p.id, hasOriginal: Boolean(p.r2_key), emailText: emailTextOf(p.raw_payload) }
                })()
              : null,
        }
      : null

    return {
      id: o.id,
      source: o.source,
      deliveryDate: o.delivery_date,
      customerId: o.customer_id,
      customerName: o.customer_id ? (custName.get(o.customer_id) ?? '（不明な取引先）') : '取引先 未紐付け',
      customerColor: o.customer_id ? (custColor.get(o.customer_id) ?? null) : null,
      destinationName: o.destination_id ? (destLabelById.get(o.destination_id) ?? null) : null,
      items: orderItems,
      minConfidence,
      needsDeliveryDate,
      needsDestination,
      destinationOptions,
      staffApprovable,
      receipt,
    }
  }).filter((o): o is PendingOrder => o !== null)
}
