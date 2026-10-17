import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { getSetting } from '@/lib/settings'
import { parseThreshold } from '@/lib/ingestion/auto-approve'
import { toGoogleDrivePreviewUrl, toGoogleDriveViewUrl } from '@/lib/pipeline/schemas'

/**
 * 承認待ち（pending_review）注文の取得（管理者/スタッフ承認画面で共有）。
 * 各注文に「スタッフが承認できるか（高確信・取引先一致・納品日確定）」および
 * Kojima-FAX が Google Drive に保存した原本URL（previewUrl / originalUrl）を付与する。
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
  quantityRaw?: string | null
  unit: string
  spec?: string | null
  containerType?: string | null
  lineNote?: string | null
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

/** 承認画面で原本（Kojima-FAX が Google Drive に保存した FAX PDF・メール本文）を比較表示するための情報。 */
export interface ReceiptOriginalInfo {
  id: string
  channel: string
  /** Google Drive 原本URL等があるか */
  hasOriginal: boolean
  /** iframe 埋め込み用 Google Drive プレビューURL (`/preview`) */
  previewUrl?: string | null
  /** 別タブ閲覧用 Google Drive URL (`/view`) */
  originalUrl?: string | null
  /** テキストメールまたは受信メタデータ本文 */
  emailText: string | null
  /** 「同じFAXに追記して再送」された差分受信か */
  isRevision: boolean
  /** 再送の場合の元受信（無ければ null） */
  parent: {
    id: string
    hasOriginal: boolean
    previewUrl?: string | null
    originalUrl?: string | null
    emailText: string | null
  } | null
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
  /** 伝票No・特記事項・数量変更メモ・要確認理由など（orders.note） */
  notes?: string | null
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

function extractDriveUrls(r2Key: string | null, raw: unknown): { previewUrl: string | null; originalUrl: string | null } {
  const payload = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const candidate =
    (typeof payload['source_file_url'] === 'string' && payload['source_file_url']) ||
    r2Key ||
    null
  return {
    previewUrl: toGoogleDrivePreviewUrl(candidate),
    originalUrl: toGoogleDriveViewUrl(candidate),
  }
}

export async function getPendingOrders(): Promise<PendingOrder[]> {
  const supabase = createClient()
  const threshold = parseThreshold(await getSetting('AUTO_APPROVE_THRESHOLD'))

  // orders テーブルの備考列は `note`（単数形: 0001_base_schema.sql 準拠）
  const { data: orders, error: ordersErr } = await supabase
    .from('orders')
    .select('id, source, delivery_date, customer_id, destination_id, note')
    .eq('status', 'pending_review')
    .order('created_at', { ascending: true })
  if (ordersErr) throw new Error(`承認待ち注文の取得に失敗しました: ${ordersErr.message}`)

  if (!orders || orders.length === 0) return []

  const orderIds = orders.map((o) => o.id)
  const customerIds = [...new Set(orders.map((o) => o.customer_id).filter(Boolean))] as string[]

  const [itemsRes, custsRes, destsRes] = await Promise.all([
    supabase
      .from('order_items')
      .select(
        'id, order_id, product_id, product_name, quantity, quantity_raw, unit, spec, container_type, line_note, confidence, version, pack_config_id',
      )
      .in('order_id', orderIds),
    customerIds.length
      ? supabase.from('customers').select('id, name, display_color').in('id', customerIds)
      : Promise.resolve({ data: [] as { id: string; name: string; display_color: string | null }[], error: null }),
    customerIds.length
      ? supabase
          .from('delivery_destinations')
          .select('id, customer_id, code, full_name')
          .eq('is_active', true)
          .in('customer_id', customerIds)
          .order('sort_order')
          .order('full_name')
      : Promise.resolve({
          data: [] as { id: string; customer_id: string; code: string | null; full_name: string }[],
          error: null,
        }),
  ])
  if (itemsRes.error) throw new Error(`承認待ち明細の取得に失敗しました: ${itemsRes.error.message}`)
  const items = itemsRes.data
  if (custsRes.error) console.error('[pending] 取引先名の解決に失敗:', custsRes.error.message)
  if (destsRes.error) console.error('[pending] 納入先の解決に失敗:', destsRes.error.message)
  const custs = custsRes.data
  const destRows = destsRes.data

  const productIds = [...new Set((items ?? []).map((it) => it.product_id).filter(Boolean))] as string[]
  const { data: packConfigs, error: packErr } = productIds.length
    ? await supabase
        .from('pack_configs')
        .select('id, product_id, customer_id, label')
        .eq('is_active', true)
        .in('product_id', productIds)
    : { data: [] as { id: string; product_id: string; customer_id: string | null; label: string }[], error: null }
  if (packErr) throw new Error(`荷姿マスタの取得に失敗しました: ${packErr.message}`)

  const { data: receiptRows, error: receiptErr } = await supabase
    .from('order_receipts')
    .select('id, order_id, channel, r2_key, raw_payload, is_revision, parent_id')
    .in('order_id', orderIds)
  if (receiptErr) console.error('[pending] 受信原本の取得に失敗:', receiptErr.message)

  const parentIds = [...new Set((receiptRows ?? []).map((r) => r.parent_id).filter(Boolean))] as string[]
  const { data: parentRows, error: parentErr } = parentIds.length
    ? await supabase.from('order_receipts').select('id, r2_key, raw_payload').in('id', parentIds)
    : { data: [] as { id: string; r2_key: string | null; raw_payload: unknown }[], error: null }
  if (parentErr) console.error('[pending] 元受信（再送親）の取得に失敗:', parentErr.message)
  const parentById = new Map((parentRows ?? []).map((p) => [p.id, p]))

  const emailTextOf = (raw: unknown): string | null => {
    if (!raw || typeof raw !== 'object') return null
    const text = (raw as { text?: unknown }).text
    return typeof text === 'string' && text.trim() ? text : null
  }

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

  return orders
    .map((o) => {
      const rawItems = itemsByOrder.get(o.id) ?? []
      if (rawItems.length === 0) return null
      const orderItems: PendingOrderItem[] = rawItems.map((it) => ({
        id: it.id,
        productId: it.product_id,
        productName: it.product_name,
        quantity: Number(it.quantity),
        quantityRaw: (it as { quantity_raw?: string | null }).quantity_raw ?? null,
        unit: it.unit,
        spec: (it as { spec?: string | null }).spec ?? null,
        containerType: (it as { container_type?: string | null }).container_type ?? null,
        lineNote: (it as { line_note?: string | null }).line_note ?? null,
        confidence: it.confidence != null ? Number(it.confidence) : null,
        version: Number(it.version ?? 1),
        packConfigId: it.pack_config_id,
        packConfigOptions: (packConfigs ?? [])
          .filter(
            (pc) =>
              pc.product_id === it.product_id &&
              (pc.customer_id === o.customer_id || pc.customer_id === null),
          )
          .map((pc) => ({ id: pc.id, label: pc.label })),
      }))
      const confidences = orderItems.map((i) => i.confidence)
      const minConfidence = confidences.length
        ? confidences.reduce<number | null>((min, c) => {
            if (c == null) return null
            if (min == null) return min
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
        ? (() => {
            const urls = extractDriveUrls(rr.r2_key, rr.raw_payload)
            return {
              id: rr.id,
              channel: rr.channel,
              hasOriginal: Boolean(urls.previewUrl || rr.r2_key),
              previewUrl: urls.previewUrl,
              originalUrl: urls.originalUrl,
              emailText: emailTextOf(rr.raw_payload),
              isRevision: Boolean(rr.is_revision),
              parent:
                rr.parent_id && parentById.has(rr.parent_id)
                  ? (() => {
                      const p = parentById.get(rr.parent_id)!
                      const pUrls = extractDriveUrls(p.r2_key, p.raw_payload)
                      return {
                        id: p.id,
                        hasOriginal: Boolean(pUrls.previewUrl || p.r2_key),
                        previewUrl: pUrls.previewUrl,
                        originalUrl: pUrls.originalUrl,
                        emailText: emailTextOf(p.raw_payload),
                      }
                    })()
                  : null,
            }
          })()
        : null

      return {
        id: o.id,
        source: o.source,
        deliveryDate: o.delivery_date,
        customerId: o.customer_id,
        customerName: o.customer_id ? (custName.get(o.customer_id) ?? '（不明な取引先）') : '取引先 未紐付け',
        customerColor: o.customer_id ? (custColor.get(o.customer_id) ?? null) : null,
        destinationName: o.destination_id ? (destLabelById.get(o.destination_id) ?? null) : null,
        notes: (o as { note?: string | null }).note ?? null,
        items: orderItems,
        minConfidence,
        needsDeliveryDate,
        needsDestination,
        destinationOptions,
        staffApprovable,
        receipt,
      }
    })
    .filter((o): o is PendingOrder => o !== null)
}
