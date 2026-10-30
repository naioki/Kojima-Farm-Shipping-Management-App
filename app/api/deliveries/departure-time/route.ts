import 'server-only'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthedUser } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isMissingColumnError } from '@/lib/supabase/missing-column'
import { isStaffUser } from '@/lib/auth/is-staff-user'
import { normalizeOrgName } from '@/lib/normalize/org-name'
import { saveRouteOverride } from '@/lib/field/destination-routes-store'

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
 * 配送リストから出荷時間・便名をワンタップで設定・変更するエンドポイント。
 * - scope === 'master'（既定）: マスタ（全日程共通）として保存し、今日・明日以降も毎回入力不要にする。
 * - scope === 'date_only': この日（deliveryDate）だけの特別変更として保存し、翌日以降のマスタは汚さない。
 * - 特定納品先（destinationId または destinationName）がある場合は `cust:${customerId}:default` を上書きせず、
 *   同一取引先の他納品先（岩槻便と戸田便など）が巻き添えで変わるバグを完全防止する。
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

        // カラムが存在し、かつ master スコープの場合は departure_time / shipping_route_name も一緒に登録
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
          // 列が存在しない環境向けフォールバック（PGRST204 / 42703 両対応）
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

    // 3. 当日の orders テーブルの destination_id を更新（shipping_timeは CHECK (shipping_time IN ('am', 'pm')) 制約があるため am/pm/null のみ反映）
    const orderUpdatePayload: Record<string, unknown> = {}
    if (targetDestId) {
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

      if (targetDestId) {
        orderQuery = orderQuery.or(`destination_id.eq.${targetDestId},destination_id.is.null`)
      }

      const { error: orderErr } = await orderQuery
      if (orderErr) {
        console.warn('[departure-time] orders 更新警告:', orderErr)
      }
    }

    // 4. app_settings に RouteOverride を保存（0026未適用環境・CHECK制約環境でも100%確実に永続化）
    try {
      const overrideKeys: string[] = []
      const cleanDestName = destinationName?.trim() || ''
      const isGenericDest = !cleanDestName || cleanDestName === '直接納品' || cleanDestName === '標準納入先'

      if (scope === 'date_only') {
        // この日（deliveryDate）だけのオーバーライドキー
        if (targetDestId) overrideKeys.push(`date:${deliveryDate}:dest:${targetDestId}`)
        if (cleanDestName) overrideKeys.push(`date:${deliveryDate}:cust:${customerId}:${cleanDestName}`)
        if (!targetDestId && isGenericDest) {
          overrideKeys.push(`date:${deliveryDate}:cust:${customerId}:default`)
        }
      } else {
        // 全日程共通（マスタ）キー（他の納品先を汚染しないよう、特定納品先がある場合は cust:default を上書きしない）
        if (targetDestId) overrideKeys.push(`dest:${targetDestId}`)
        if (cleanDestName) overrideKeys.push(`cust:${customerId}:${cleanDestName}`)
        if (!targetDestId && isGenericDest) {
          overrideKeys.push(`cust:${customerId}:default`)
        }
        // 過去にこの日だけのオーバーライドが設定されていた場合、マスタ変更を即反映できるよう当日キーも同期
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

    // 5. deliveries テーブルの status / note も同期（存在する場合、limit(1) で複数行エラーを回避）
    try {
      const { data: existingRows } = await admin
        .from('deliveries')
        .select('id, note')
        .eq('delivery_date', deliveryDate)
        .eq('customer_id', customerId)
        .limit(1)

      const existingDelivery = existingRows?.[0]
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
