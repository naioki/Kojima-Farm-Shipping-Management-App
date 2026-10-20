import 'server-only'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthedUser } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { saveRouteOverride } from '@/lib/field/destination-routes-store'

export const runtime = 'nodejs'

const updateSchema = z.object({
  code: z.string().trim().min(1).nullish(),
  full_name: z.string().trim().min(1).optional(),
  aliases: z.array(z.string().trim().min(1)).optional(),
  is_active: z.boolean().optional(),
  departure_time: z.string().trim().nullish(),
  shipping_route_name: z.string().trim().nullish(),
  pack_sort_order: z.number().int().optional(),
  default_container_type: z.string().trim().nullish(),
})

/** 納入先の更新（略称・正式名・aliases・便名・出荷時間・有効/無効）。 */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 })

  const parsed = updateSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: '入力値が不正です', detail: parsed.error.flatten() }, { status: 400 })
  }

  const patch: Record<string, unknown> = {}
  if (parsed.data.code !== undefined) patch.code = parsed.data.code ?? null
  if (parsed.data.full_name !== undefined) patch.full_name = parsed.data.full_name
  if (parsed.data.aliases !== undefined) patch.aliases = parsed.data.aliases
  if (parsed.data.is_active !== undefined) patch.is_active = parsed.data.is_active
  if (parsed.data.departure_time !== undefined) patch.departure_time = parsed.data.departure_time ?? null
  if (parsed.data.shipping_route_name !== undefined) patch.shipping_route_name = parsed.data.shipping_route_name ?? null
  if (parsed.data.pack_sort_order !== undefined) patch.pack_sort_order = parsed.data.pack_sort_order
  if (parsed.data.default_container_type !== undefined) patch.default_container_type = parsed.data.default_container_type ?? null

  const admin = createAdminClient()
  let updRes = await admin
    .from('delivery_destinations')
    .update(patch)
    .eq('id', params.id)
    .select('id, code, full_name, aliases, is_active, departure_time, shipping_route_name, pack_sort_order, default_container_type')
    .single()

  if (updRes.error && updRes.error.code === '42703') {
    // 0026 未適用環境: 新規追加カラムを除外して更新
    const fallbackPatch: Record<string, unknown> = {}
    if (parsed.data.code !== undefined) fallbackPatch.code = parsed.data.code ?? null
    if (parsed.data.full_name !== undefined) fallbackPatch.full_name = parsed.data.full_name
    if (parsed.data.aliases !== undefined) fallbackPatch.aliases = parsed.data.aliases
    if (parsed.data.is_active !== undefined) fallbackPatch.is_active = parsed.data.is_active

    updRes = await admin
      .from('delivery_destinations')
      .update(fallbackPatch)
      .eq('id', params.id)
      .select('id, code, full_name, aliases, is_active')
      .single()
  }

  if (updRes.error) return NextResponse.json({ error: updRes.error.message }, { status: 500 })

  // departure_time や shipping_route_name が指定されている場合は app_settings の RouteOverride にも保存
  if (parsed.data.departure_time !== undefined || parsed.data.shipping_route_name !== undefined) {
    try {
      await saveRouteOverride(admin, [`dest:${params.id}`], {
        departureTime: parsed.data.departure_time ?? null,
        shippingRouteName: parsed.data.shipping_route_name ?? null,
      })
    } catch {}
  }

  return NextResponse.json({ destination: updRes.data })
}

/** 納入先の削除。注文に紐付いている場合もエラーで止めず、参照解除または非表示化を行う。 */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 })

  const admin = createAdminClient()
  const { error } = await admin.from('delivery_destinations').delete().eq('id', params.id)
  if (error) {
    // 外部キー参照がある場合は destination_id を null に外して再試行、それでも不可なら is_active=false に更新
    await Promise.allSettled([
      admin.from('orders').update({ destination_id: null }).eq('destination_id', params.id),
      admin.from('deliveries').update({ destination_id: null }).eq('destination_id', params.id),
    ])
    const retry = await admin.from('delivery_destinations').delete().eq('id', params.id)
    if (retry.error) {
      await admin.from('delivery_destinations').update({ is_active: false }).eq('id', params.id)
    }
  }
  return NextResponse.json({ ok: true })
}
