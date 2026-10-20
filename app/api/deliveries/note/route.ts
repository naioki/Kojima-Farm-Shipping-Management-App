import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthedUser } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'

const schema = z.object({
  delivery_date: z.string(),
  customer_id: z.string().uuid(),
  note: z.string().nullable(),
})

/**
 * 取引先の配送特記事項（空コンテナ持参・積み順等）の保存API。
 * deliveries レコードの note カラムを更新し、現場から即座に共有できるようにする。
 */
export async function POST(req: Request) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid', detail: parsed.error.flatten() }, { status: 400 })
  }

  const { delivery_date, customer_id, note } = parsed.data
  const admin = createAdminClient()

  // 該当日の取引先の全 deliveries レコードの note を一括更新
  const { error } = await admin
    .from('deliveries')
    .update({ note: note?.trim() || null })
    .eq('delivery_date', delivery_date)
    .eq('customer_id', customer_id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // もし deliveries レコードがまだ無い場合は作成
  const { data: count } = await admin
    .from('deliveries')
    .select('id', { count: 'exact', head: true })
    .eq('delivery_date', delivery_date)
    .eq('customer_id', customer_id)

  if (!count) {
    await admin.from('deliveries').insert({
      delivery_date,
      customer_id,
      destination_id: null,
      status: 'planned',
      note: note?.trim() || null,
    })
  }

  return NextResponse.json({ ok: true, note: note?.trim() || null })
}
