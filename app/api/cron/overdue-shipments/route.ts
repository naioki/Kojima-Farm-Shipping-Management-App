import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSetting } from '@/lib/settings'
import { sendMultiChannelAlert } from '@/lib/notifications/multi-channel'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * 出発予定時刻（departure_time）を過ぎても未出荷の注文を検知し、
 * LINE / LINE WORKS / Discord / メールへ遅延アラートを通知するCronエンドポイント。
 */
export async function GET(req: NextRequest) {
  const overdueAlertSetting = await getSetting('OVERDUE_ALERT_ENABLED')
  const isEnabled = overdueAlertSetting !== 'off'

  const force = req.nextUrl.searchParams.get('force') === 'true'
  if (!isEnabled && !force) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'OVERDUE_ALERT_ENABLED is off' })
  }

  const supabase = createAdminClient()

  // 今日のJST日付を取得
  const now = new Date()
  const jstFormatter = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const parts = jstFormatter.formatToParts(now)
  const y = parts.find((p) => p.type === 'year')?.value
  const m = parts.find((p) => p.type === 'month')?.value
  const d = parts.find((p) => p.type === 'day')?.value
  const curHour = parts.find((p) => p.type === 'hour')?.value || '00'
  const curMin = parts.find((p) => p.type === 'minute')?.value || '00'

  const todayStr = `${y}-${m}-${d}`
  const curTimeStr = `${curHour}:${curMin}`

  // 今日の納品日、キャンセル以外の注文を取得
  const { data: orders, error: ordersErr } = await supabase
    .from('orders')
    .select(`
      id,
      customer_id,
      destination_id,
      delivery_date,
      customers (name),
      delivery_destinations (full_name, shipping_route_name, departure_time),
      order_items (
        id,
        product_name,
        quantity,
        field_status
      )
    `)
    .eq('delivery_date', todayStr)
    .neq('status', 'cancelled')

  if (ordersErr) {
    console.error('[cron/overdue-shipments] orders取得失敗:', ordersErr.message)
    return NextResponse.json({ ok: false, error: ordersErr.message }, { status: 500 })
  }

  const overdueList: Array<{
    customerName: string
    destinationName: string
    routeName: string
    departureTime: string
    unshippedItems: string[]
  }> = []

  for (const order of orders || []) {
    const dest = order.delivery_destinations as unknown as {
      full_name?: string
      shipping_route_name?: string | null
      departure_time?: string | null
    } | null

    const depTime = dest?.departure_time
    if (!depTime) continue // 出発予定時刻の設定がない場合はスキップ

    // 時間比較 (HH:mm)
    if (curTimeStr < depTime && !force) continue

    // 未出荷の明細があるかチェック
    type OrderItemLite = {
      id: string
      product_name: string
      quantity: number
      field_status: string
    }
    const itemsList = ((order.order_items ?? []) as unknown as OrderItemLite[])
    const unshipped = itemsList.filter((item) => item.field_status !== 'shipped')
    if (unshipped.length > 0) {
      const cust = order.customers as unknown as { name?: string } | null
      overdueList.push({
        customerName: cust?.name || '取引先不明',
        destinationName: dest?.full_name || '',
        routeName: dest?.shipping_route_name || '通常便',
        departureTime: depTime,
        unshippedItems: unshipped.map((it) => `${it.product_name} (${it.quantity})`),
      })
    }
  }

  if (overdueList.length === 0) {
    return NextResponse.json({ ok: true, overdueCount: 0, message: '遅延出荷はありません' })
  }

  // アラートメッセージ構築
  const lines: string[] = [
    `現在時刻: ${curTimeStr} (対象日: ${todayStr})`,
    `出発予定時刻を過ぎても未出荷の注文が ${overdueList.length} 件あります！`,
    '',
  ]

  for (const item of overdueList) {
    lines.push(`【${item.routeName} (予定: ${item.departureTime})】`)
    lines.push(`・${item.customerName} ${item.destinationName ? `(${item.destinationName})` : ''}`)
    lines.push(`  未出荷: ${item.unshippedItems.join(', ')}`)
  }

  const message = lines.join('\n')
  const host = req.headers.get('host') || 'localhost:3000'
  const protocol = req.headers.get('x-forwarded-proto') || 'https'
  const shipmentUrl = `${protocol}://${host}/field/shipments?date=${todayStr}`

  const results = await sendMultiChannelAlert({
    title: `🚨【出荷遅れ警告】未出荷の荷物があります（${overdueList.length}件）`,
    message,
    urgent: true,
    url: shipmentUrl,
  })

  return NextResponse.json({
    ok: true,
    overdueCount: overdueList.length,
    overdueList,
    results,
  })
}
