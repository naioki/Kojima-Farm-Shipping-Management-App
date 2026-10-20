import 'server-only'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthedUser } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizeOrgName } from '@/lib/normalize/org-name'

export const runtime = 'nodejs'

const bodySchema = z.object({
  deliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  customerId: z.string().min(1),
  destinationId: z.string().nullish().transform((v) => {
    if (!v) return null
    const trimmed = v.trim()
    if (!trimmed || trimmed.startsWith('name:')) return null
    return trimmed
  }),
  destinationName: z.string().trim().nullish(),
  departureTime: z.string().trim().nullish(),
  shippingRouteName: z.string().trim().nullish(),
})

/**
 * 配送リストから出荷時間・便名をワンタップで設定・変更するエンドポイント。
 * destinationId があればその納入先および当日の注文を更新。
 * destinationId が無くても取引先・納入先名から自動で登録・紐付けして時間を設定する。
 * DBに departure_time カラムが存在しない環境でも orders.shipping_time に確実に保存する。
 */
export async function POST(req: Request) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 })

  const jsonBody = await req.json().catch(() => null)
  const parsed = bodySchema.safeParse(jsonBody)
  if (!parsed.success) {
    return NextResponse.json(
      { error: '入力値が不正です', detail: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const { deliveryDate, customerId, destinationId, destinationName, departureTime, shippingRouteName } = parsed.data
  const admin = createAdminClient()

  const cleanTime = departureTime?.trim() || null
  const cleanRoute = shippingRouteName?.trim() || null

  try {
    let targetDestId = destinationId

    // 1. 納入先IDの特定・作成
    if (!targetDestId) {
      const destFullName = destinationName?.trim() || '標準納入先'
      const norm = normalizeOrgName(destFullName)

      // 同一取引先配下の既存を検索
      const { data: siblings } = await admin
        .from('delivery_destinations')
        .select('id, full_name')
        .eq('customer_id', customerId)

      const existing = (siblings ?? []).find((d) => normalizeOrgName(d.full_name) === norm)
      if (existing) {
        targetDestId = existing.id
      } else {
        const basePayload = {
          customer_id: customerId,
          code: destinationName?.trim() || null,
          full_name: destFullName,
        }

        // カラムが存在する場合は departure_time / shipping_route_name も一緒に登録
        let insRes = await admin
          .from('delivery_destinations')
          .insert({
            ...basePayload,
            departure_time: cleanTime,
            shipping_route_name: cleanRoute,
          })
          .select('id')
          .maybeSingle()

        if (insRes.error && insRes.error.code === '42703') {
          // 列が存在しない環境向けフォールバック
          insRes = await admin
            .from('delivery_destinations')
            .insert(basePayload)
            .select('id')
            .maybeSingle()
        }

        if (insRes.error) {
          console.warn('[departure-time] delivery_destinations 作成エラー (フォールバック続行):', insRes.error)
        } else if (insRes.data?.id) {
          targetDestId = insRes.data.id
        }
      }
    }

    // 2. delivery_destinations のマスタ更新（列が存在する場合）
    if (targetDestId) {
      const { error: updErr } = await admin
        .from('delivery_destinations')
        .update({
          departure_time: cleanTime,
          shipping_route_name: cleanRoute,
        })
        .eq('id', targetDestId)

      if (updErr && updErr.code !== '42703') {
        console.warn('[departure-time] delivery_destinations 更新エラー (フォールバック続行):', updErr)
      }
    }

    // 3. 当日の orders テーブルの shipping_time および destination_id を更新（確実な時間反映）
    const orderUpdatePayload: Record<string, unknown> = {
      shipping_time: cleanTime,
    }
    if (targetDestId) {
      orderUpdatePayload.destination_id = targetDestId
    }

    let orderQuery = admin
      .from('orders')
      .update(orderUpdatePayload)
      .eq('delivery_date', deliveryDate)
      .eq('customer_id', customerId)
      .neq('status', 'cancelled')

    if (targetDestId) {
      orderQuery = orderQuery.or(`destination_id.eq.${targetDestId},destination_id.is.null`)
    }

    const { error: orderErr } = await orderQuery
    if (orderErr) {
      console.warn('[departure-time] orders 更新警告:', orderErr)
    }

    // 4. deliveries テーブルの status / note も同期（存在する場合）
    try {
      const { data: existingDelivery } = await admin
        .from('deliveries')
        .select('id, note')
        .eq('delivery_date', deliveryDate)
        .eq('customer_id', customerId)
        .maybeSingle()

      if (existingDelivery) {
        let note = existingDelivery.note || ''
        if (cleanRoute && !note.includes(cleanRoute)) {
          note = note ? `${note} / ${cleanRoute}` : cleanRoute
        }
        await admin
          .from('deliveries')
          .update({ note: note || null })
          .eq('id', existingDelivery.id)
      }
    } catch {
      // deliveries テーブルの更新は補助的なので失敗しても握りつぶす
    }

    return NextResponse.json({
      ok: true,
      destinationId: targetDestId,
      departureTime: cleanTime,
      shippingRouteName: cleanRoute,
    })
  } catch (e: unknown) {
    const errMsg = e instanceof Error ? e.message : (e as { message?: string })?.message || '出荷時間の設定に失敗しました'
    console.error('[departure-time] 出荷時間の設定に失敗:', errMsg, e)
    return NextResponse.json(
      { error: errMsg },
      { status: 500 },
    )
  }
}
