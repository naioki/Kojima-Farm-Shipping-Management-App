import 'server-only'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { normalizeOrgName } from '@/lib/normalize/org-name'

export const runtime = 'nodejs'

const bodySchema = z.object({
  deliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  customerId: z.string().uuid(),
  destinationId: z.string().uuid().nullish(),
  destinationName: z.string().trim().nullish(),
  departureTime: z.string().trim().nullish(),
  shippingRouteName: z.string().trim().nullish(),
})

/**
 * 配送リストから出荷時間・便名をワンタップで設定・変更するエンドポイント。
 * destinationId があればその納入先を更新。
 * destinationId が無くても取引先・納入先名から自動で登録・紐付けして時間を設定する。
 */
export async function POST(req: Request) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 })

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: '入力値が不正です', detail: parsed.error.flatten() }, { status: 400 })
  }

  const { deliveryDate, customerId, destinationId, destinationName, departureTime, shippingRouteName } = parsed.data
  const supabase = createClient()

  const cleanTime = departureTime?.trim() || null
  const cleanRoute = shippingRouteName?.trim() || null

  try {
    let targetDestId = destinationId

    if (targetDestId) {
      // 既存納入先の出荷時間・便名を更新
      const { error: updErr } = await supabase
        .from('delivery_destinations')
        .update({
          departure_time: cleanTime,
          shipping_route_name: cleanRoute,
        })
        .eq('id', targetDestId)
      if (updErr) throw updErr
    } else {
      // 納入先マスタ未登録の場合、自動で納入先を作成して紐付け
      const destFullName = destinationName?.trim() || '標準納入先'
      const norm = normalizeOrgName(destFullName)

      // 同一取引先配下の既存を検索
      const { data: siblings } = await supabase
        .from('delivery_destinations')
        .select('id, full_name')
        .eq('customer_id', customerId)

      const existing = (siblings ?? []).find((d) => normalizeOrgName(d.full_name) === norm)
      if (existing) {
        targetDestId = existing.id
        await supabase
          .from('delivery_destinations')
          .update({
            departure_time: cleanTime,
            shipping_route_name: cleanRoute,
          })
          .eq('id', targetDestId)
      } else {
        const { data: newDest, error: insErr } = await supabase
          .from('delivery_destinations')
          .insert({
            customer_id: customerId,
            code: destinationName?.trim() || null,
            full_name: destFullName,
            departure_time: cleanTime,
            shipping_route_name: cleanRoute,
          })
          .select('id')
          .single()
        if (insErr) throw insErr
        targetDestId = newDest.id
      }

      // 当日の対象注文の destination_id を更新
      if (targetDestId) {
        await supabase
          .from('orders')
          .update({ destination_id: targetDestId })
          .eq('delivery_date', deliveryDate)
          .eq('customer_id', customerId)
          .is('destination_id', null)
      }
    }

    return NextResponse.json({
      ok: true,
      destinationId: targetDestId,
      departureTime: cleanTime,
      shippingRouteName: cleanRoute,
    })
  } catch (e) {
    console.error('[departure-time] 出荷時間の設定に失敗:', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : '出荷時間の設定に失敗しました' },
      { status: 500 },
    )
  }
}
