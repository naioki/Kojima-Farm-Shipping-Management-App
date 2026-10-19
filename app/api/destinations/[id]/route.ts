import 'server-only'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, getAuthedUser } from '@/lib/supabase/server'

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

/** 納入先の更新（略称・正式名・aliases・便名・出荷時間・有効/無効）。admin のみ（RLS）。 */
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

  const supabase = createClient()
  const { data, error } = await supabase
    .from('delivery_destinations')
    .update(patch)
    .eq('id', params.id)
    .select('id, code, full_name, aliases, is_active, departure_time, shipping_route_name, pack_sort_order, default_container_type')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ destination: data })
}

/** 納入先の削除。注文に紐付いている場合は FK で失敗するので無効化を案内する。 */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 })

  const supabase = createClient()
  const { error } = await supabase.from('delivery_destinations').delete().eq('id', params.id)
  if (error) {
    // 注文が参照している（FK）と削除不可 → 無効化を促す
    return NextResponse.json(
      { error: 'この納入先は注文に使われているため削除できません。無効化してください。' },
      { status: 409 },
    )
  }
  return NextResponse.json({ ok: true })
}
