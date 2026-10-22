import { NextRequest, NextResponse } from 'next/server'
import { getAuthedUser } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'

export interface ViewerTargetItem {
  id: string
  customerName: string
  destinationName: string
  productName: string
  quantity: number
  unit: string
  spec: string
  container: string
  boxCount: number
}

export interface ViewerReceiptTab {
  id: string
  name: string
  receivedAt?: string
  isCurrent: boolean
}

/**
 * GET /api/field/viewer-meta?receiptId=...&date=YYYY-MM-DD
 *
 * 原本ビューアー上部に表示する「照合ハイライト帯」と「同日FAX切替タブ」のメタデータを返す。
 */
export async function GET(req: NextRequest) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const receiptId = searchParams.get('receiptId')
  const date = searchParams.get('date') || ''

  if (!receiptId) {
    return NextResponse.json({ error: 'receiptId is required' }, { status: 400 })
  }

  const admin = createAdminClient()

  // ① 取引先・納入先マスタを取得
  const [custRes, destRes] = await Promise.all([
    admin.from('customers').select('id, name'),
    admin.from('delivery_destinations').select('id, customer_id, code, full_name'),
  ])
  const customerNameMap = new Map((custRes.data ?? []).map((c) => [c.id, c.name]))
  const destMap = new Map((destRes.data ?? []).map((d) => [d.id, d.code || d.full_name]))

  // ② 指定日の有効な注文（キャンセル除外）
  let dayOrders: { id: string; customer_id: string; destination_id: string | null }[] = []
  if (date) {
    const { data: oData } = await admin
      .from('orders')
      .select('id, customer_id, destination_id')
      .eq('delivery_date', date)
      .neq('status', 'cancelled')
    dayOrders = oData ?? []
  }
  const dayOrderIds = dayOrders.map((o) => o.id)
  const orderCustMap = new Map(dayOrders.map((o) => [o.id, o.customer_id]))
  const orderDestMap = new Map(dayOrders.map((o) => [o.id, o.destination_id]))

  // ③ 当日に関連する全FAX（切替タブ構築用）
  const receiptsList: ViewerReceiptTab[] = []
  const seenReceiptIds = new Set<string>()

  if (dayOrderIds.length > 0) {
    // 注文に直接紐づく受信、または同日・同取引先の受信を取得
    const validOrderIds = dayOrderIds.filter(Boolean)
    const validCustomerIds = [...new Set(dayOrders.map((o) => o.customer_id).filter(Boolean))]

    const orClauses: string[] = []
    if (validOrderIds.length > 0) orClauses.push(`order_id.in.(${validOrderIds.join(',')})`)
    if (validCustomerIds.length > 0) orClauses.push(`customer_id.in.(${validCustomerIds.join(',')})`)

    const { data: dayReceiptRows } = orClauses.length > 0
      ? await admin
          .from('order_receipts')
          .select('id, customer_id, order_id, r2_key, raw_payload, received_at')
          .or(orClauses.join(','))
          .order('received_at', { ascending: false })
          .limit(30)
      : { data: [] }

    for (const r of dayReceiptRows ?? []) {
      const p = (r.raw_payload ?? {}) as Record<string, unknown>
      const slip = (p['slip_data'] ?? {}) as Record<string, unknown>
      const rawUrl =
        (typeof p['source_file_url'] === 'string' && p['source_file_url'].trim()) ||
        (typeof p['drive_url'] === 'string' && p['drive_url'].trim()) ||
        (typeof p['file_url'] === 'string' && p['file_url'].trim()) ||
        (typeof slip['source_file_url'] === 'string' && slip['source_file_url'].trim()) ||
        (typeof r.r2_key === 'string' && r.r2_key.trim()) ||
        null
      const hasFile = Boolean(rawUrl || (typeof p['file_base64'] === 'string' && p['file_base64'].trim()))

      if (!hasFile) continue
      if (seenReceiptIds.has(r.id)) continue

      // このFAXが指定日（date）の注文を含んでいるか確認
      const cOrderIds = Array.isArray(p['created_order_ids']) ? (p['created_order_ids'] as string[]) : []
      const parsedOrders = Array.isArray(p['parsed_orders'])
        ? (p['parsed_orders'] as Array<{ delivery_date?: string }>)
        : []
      const matchesDirectOrder = r.order_id && dayOrderIds.includes(r.order_id)
      const matchesCreatedOrder = cOrderIds.some((cid) => dayOrderIds.includes(cid))
      const matchesParsedDate = parsedOrders.some((po) => po.delivery_date === date)

      if (matchesDirectOrder || matchesCreatedOrder || matchesParsedDate || r.id === receiptId) {
        seenReceiptIds.add(r.id)
        const cName = r.customer_id ? customerNameMap.get(r.customer_id) ?? 'FAX' : 'FAX'
        let shortTime = ''
        if (r.received_at) {
          try {
            const d = new Date(r.received_at)
            shortTime = ` (${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')})`
          } catch {}
        }
        receiptsList.push({
          id: r.id,
          name: `${cName}${shortTime}`,
          isCurrent: r.id === receiptId,
        })
      }
    }
  }

  // もし現在の receiptId がまだ含まれていなければ追加
  if (!seenReceiptIds.has(receiptId)) {
    const { data: curReceipt } = await admin
      .from('order_receipts')
      .select('id, customer_id, received_at')
      .eq('id', receiptId)
      .maybeSingle()
    if (curReceipt) {
      const cName = curReceipt.customer_id ? customerNameMap.get(curReceipt.customer_id) ?? 'FAX' : 'FAX'
      receiptsList.unshift({
        id: curReceipt.id,
        name: cName,
        isCurrent: true,
      })
    }
  }

  // ④ 現在の receiptId に紐づき、かつ指定日（date）に出荷される明細行（ハイライト対象）
  const targetItems: ViewerTargetItem[] = []

  const { data: receiptData } = await admin
    .from('order_receipts')
    .select('id, customer_id, order_id, raw_payload')
    .eq('id', receiptId)
    .maybeSingle()

  if (receiptData) {
    const payload = (receiptData.raw_payload ?? {}) as Record<string, unknown>
    const createdOrderIds = Array.isArray(payload['created_order_ids'])
      ? (payload['created_order_ids'] as string[])
      : []
    const candOrderIds = [...new Set([receiptData.order_id, ...createdOrderIds].filter(Boolean))] as string[]

    // 当日の注文に絞り込み
    const matchingOrderIds = dayOrders.length > 0
      ? candOrderIds.filter((oid) => dayOrderIds.includes(oid))
      : candOrderIds

    if (matchingOrderIds.length > 0) {
      const { data: itemRows } = await admin
        .from('order_items')
        .select('id, order_id, product_name, quantity, unit, spec, container_type')
        .in('order_id', matchingOrderIds)
        .order('product_name')

      for (const it of itemRows ?? []) {
        const cId = orderCustMap.get(it.order_id) ?? receiptData.customer_id
        const dId = orderDestMap.get(it.order_id)
        const cName = cId ? customerNameMap.get(cId) ?? '—' : '—'
        const dName = dId ? destMap.get(dId) ?? cName : cName

        const qty = Number(it.quantity) || 0
        const perCase = cName.includes('農業総合研究所') || cName.includes('NSK') || (it.spec ?? '').includes('24') ? 24 : 20
        const boxCount = Math.floor(qty / perCase) + (qty % perCase > 0 ? 1 : 0)

        targetItems.push({
          id: it.id,
          customerName: cName,
          destinationName: dName,
          productName: it.product_name ?? 'チンゲン菜',
          quantity: qty,
          unit: it.unit ?? 'P',
          spec: it.spec ?? '2〜3株 (標準)',
          container: it.container_type || (dName.includes('岩槻') ? '青コン' : dName.includes('戸田') ? '茶コン' : '通常コンテナ'),
          boxCount,
        })
      }
    } else {
      // 注文レコードが見当たらない場合は parsed_orders から当日該当分を抽出
      const parsedOrders = Array.isArray(payload['parsed_orders'])
        ? (payload['parsed_orders'] as Array<{
            customer_name?: string
            destination_name?: string
            delivery_date?: string
            items?: Array<{
              product_name?: string
              raw_name?: string
              quantity?: number | string
              unit?: string
              spec?: string
              container_type?: string
              box_count?: number
            }>
          }>)
        : []

      for (const po of parsedOrders) {
        if (date && po.delivery_date !== date) continue
        const cName = po.customer_name || (receiptData.customer_id ? customerNameMap.get(receiptData.customer_id) ?? '—' : '—')
        const dName = po.destination_name || cName

        for (const it of po.items ?? []) {
          const qty = Number(it.quantity) || 0
          const perCase = cName.includes('農業総合研究所') || cName.includes('NSK') || (it.spec ?? '').includes('24') ? 24 : 20
          const boxCount = it.box_count != null ? Number(it.box_count) : Math.floor(qty / perCase) + (qty % perCase > 0 ? 1 : 0)

          targetItems.push({
            id: `parsed-${targetItems.length}`,
            customerName: cName,
            destinationName: dName,
            productName: it.product_name || it.raw_name || 'チンゲン菜',
            quantity: qty,
            unit: it.unit || 'P',
            spec: it.spec || '2〜3株 (標準)',
            container: it.container_type || '通常コンテナ',
            boxCount,
          })
        }
      }
    }
  }

  return NextResponse.json({
    ok: true,
    receipts: receiptsList,
    targetItems,
  })
}
