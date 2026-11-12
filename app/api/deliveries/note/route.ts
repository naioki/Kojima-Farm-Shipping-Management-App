import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireStaffApi } from '@/lib/auth/api-guard'

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
  const guard = await requireStaffApi('forbidden')
  if (!guard.ok) return guard.response

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
  const { count, error: countErr } = await admin
    .from('deliveries')
    .select('id', { count: 'exact', head: true })
    .eq('delivery_date', delivery_date)
    .eq('customer_id', customer_id)
  if (countErr) {
    // 件数が分からないまま作ると配送レコードが二重になるので作らない
    console.error('[deliveries/note] deliveries の件数確認に失敗:', countErr.message)
    return NextResponse.json({ error: 'メモを保存できたか確認できませんでした。もう一度お試しください' }, { status: 500 })
  }

  if (!count) {
    // レコードが無い日は、ここで作るのがメモの保存そのもの（本体）
    const { error: insErr } = await admin.from('deliveries').insert({
      delivery_date,
      customer_id,
      destination_id: null,
      status: 'planned',
      note: note?.trim() || null,
    })
    if (insErr) {
      console.error('[deliveries/note] deliveries の作成に失敗:', insErr.message)
      return NextResponse.json({ error: 'メモを保存できませんでした。もう一度お試しください' }, { status: 500 })
    }
  }

  return NextResponse.json({ ok: true, note: note?.trim() || null })
}
