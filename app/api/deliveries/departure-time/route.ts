import 'server-only'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthedUser } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isMissingColumnError } from '@/lib/supabase/missing-column'
import { isStaffUser } from '@/lib/auth/is-staff-user'
import { normalizeOrgName } from '@/lib/normalize/org-name'
import { saveRouteOverride } from '@/lib/field/destination-routes-store'
import { cleanShippingRouteName } from '@/lib/field/shipment-sort'

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
  /** 'master' = 全日程共通（今後ずっと引き継ぐ） / 'date_only' = この日（deliveryDate）だけ一時変更 */
  scope: z.enum(['master', 'date_only']).optional().default('master'),
})

/**
 * 配送リストから出荷時間・便名をワンタップで設定・変更するエンドポイント（v5.1.10 修正版）。
 * - 【#12 解消】deliveries.note に便名（NSK便・和郷園便等）を追記して特記事項バナーに重複表示させていた処理を削除。
 * - 【#13 解消】特定納品先（destinationId）が既に指定されている場合は、その納品先の注文のみを更新し、destination_id IS NULL の別注文を巻き添えにしない。
 */
export async function POST(req: Request) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 })
  if (!(await isStaffUser(user.id))) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 })
  }

  const jsonBody = await req.json().catch(() => null)
  const parsed = bodySchema.safeParse(jsonBody)
  if (!parsed.success) {
    return NextResponse.json(
      { error: '入力値が不正です', detail: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const { deliveryDate, customerId, destinationId, destinationName, departureTime, shippingRouteName, scope } = parsed.data
  const admin = createAdminClient()

  const cleanTime = departureTime?.trim() || null
  const cleanRoute = cleanShippingRouteName(shippingRouteName) || null

  try {
    let targetDestId = destinationId
    const wasExplicitDestId = Boolean(destinationId)

    // 1. 納入先IDの特定・作成
    if (!targetDestId) {
      const destFullName = destinationName?.trim() || '標準納入先'
      const norm = normalizeOrgName(destFullName)

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

        let insRes = await admin
          .from('delivery_destinations')
          .insert(
            scope === 'master'
              ? {
                  ...basePayload,
                  departure_time: cleanTime,
                  shipping_route_name: cleanRoute,
                }
              : basePayload,
          )
          .select('id')
          .maybeSingle()

        if (insRes.error && isMissingColumnError(insRes.error)) {
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

    // 2. delivery_destinations のマスタ更新（scope === 'master' の場合のみ）
    if (targetDestId && scope === 'master') {
      const { error: updErr } = await admin
        .from('delivery_destinations')
        .update({
          departure_time: cleanTime,
          shipping_route_name: cleanRoute,
        })
        .eq('id', targetDestId)

      if (updErr && !isMissingColumnError(updErr)) {
        console.warn('[departure-time] delivery_destinations 更新エラー (フォールバック続行):', updErr)
      }
    }

    // 3. 当日の orders テーブル更新（#13 特定 destinationId が指定されていた場合は該当注文のみ更新し、別注文の巻き添えを防止）
    const orderUpdatePayload: Record<string, unknown> = {}
    if (targetDestId && !wasExplicitDestId) {
      orderUpdatePayload.destination_id = targetDestId
    }
    if (cleanTime === 'am' || cleanTime === 'pm' || cleanTime === null) {
      orderUpdatePayload.shipping_time = cleanTime
    }

    if (Object.keys(orderUpdatePayload).length > 0) {
      let orderQuery = admin
        .from('orders')
        .update(orderUpdatePayload)
        .eq('delivery_date', deliveryDate)
        .eq('customer_id', customerId)
        .neq('status', 'cancelled')

      if (wasExplicitDestId && targetDestId) {
        orderQuery = orderQuery.eq('destination_id', targetDestId)
      } else if (targetDestId) {
        orderQuery = orderQuery.is('destination_id', null)
      }

      const { error: orderErr } = await orderQuery
      if (orderErr) {
        console.warn('[departure-time] orders 更新警告:', orderErr)
      }
    }

    // 4. app_settings に RouteOverride を保存
    try {
      const overrideKeys: string[] = []
      const cleanDestName = destinationName?.trim() || ''
      const isGenericDest = !cleanDestName || cleanDestName === '直接納品' || cleanDestName === '標準納入先'

      if (scope === 'date_only') {
        if (targetDestId) overrideKeys.push(`date:${deliveryDate}:dest:${targetDestId}`)
        if (cleanDestName) overrideKeys.push(`date:${deliveryDate}:cust:${customerId}:${cleanDestName}`)
        if (!targetDestId && isGenericDest) {
          overrideKeys.push(`date:${deliveryDate}:cust:${customerId}:default`)
        }
      } else {
        if (targetDestId) overrideKeys.push(`dest:${targetDestId}`)
        if (cleanDestName) overrideKeys.push(`cust:${customerId}:${cleanDestName}`)
        if (!targetDestId && isGenericDest) {
          overrideKeys.push(`cust:${customerId}:default`)
        }
        if (targetDestId) overrideKeys.push(`date:${deliveryDate}:dest:${targetDestId}`)
        if (cleanDestName) overrideKeys.push(`date:${deliveryDate}:cust:${customerId}:${cleanDestName}`)
      }

      await saveRouteOverride(admin, overrideKeys, {
        departureTime: cleanTime,
        shippingRouteName: cleanRoute,
      })
    } catch (saveErr) {
      console.warn('[departure-time] saveRouteOverride エラー:', saveErr)
    }

    return NextResponse.json({
      ok: true,
      destinationId: targetDestId,
      departureTime: cleanTime,
      shippingRouteName: cleanRoute,
      scope,
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
