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

/** 納入先の削除。過去の注文履歴を壊さず、実績0件なら物理削除、実績ありなら is_active=false（アーカイブ）に更新する。 */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 })

  const admin = createAdminClient()

  // 過去の注文・配送実績を確認（履歴保護）
  const [ord, del] = await Promise.all([
    admin.from('orders').select('id', { count: 'exact', head: true }).eq('destination_id', params.id),
    admin.from('deliveries').select('id', { count: 'exact', head: true }).eq('destination_id', params.id),
  ])

  if ((ord.count ?? 0) === 0 && (del.count ?? 0) === 0) {
    // 実績0件なら物理削除を試行
    const { error: delErr } = await admin.from('delivery_destinations').delete().eq('id', params.id)
    if (!delErr) {
      return NextResponse.json({ deleted: true, mode: 'physical', ok: true })
    }
  }

  // 過去実績がある場合（またはFK保護が働いた場合）は、過去注文の destination_id を壊さずに is_active: false に更新して安全にアーカイブ
  const { error: archErr } = await admin
    .from('delivery_destinations')
    .update({ is_active: false })
    .eq('id', params.id)

  if (archErr) return NextResponse.json({ error: archErr.message }, { status: 500 })

  return NextResponse.json({ deleted: true, mode: 'archived', ok: true })
}
