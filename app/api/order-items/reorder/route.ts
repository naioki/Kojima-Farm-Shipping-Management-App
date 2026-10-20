import { NextRequest, NextResponse } from 'next/server'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * 現場・管理者によるパック作業順（daily_pack_sort_order）更新API
 */
export async function POST(req: NextRequest) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  // 認証済みユーザーであれば並び順の更新を許可（社内スタッフ・管理者）
  const role = (user.app_metadata?.role as string) || (user.user_metadata?.role as string)
  if (role === 'portal') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const body = await req.json()
  const { items } = body as { items: Array<{ id: string; sortOrder: number }> }
  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: 'items array required' }, { status: 400 })
  }

  const admin = createAdminClient()
  // 順次更新（service role で RLS を安全にバイパス）
  const promises = items.map((it) =>
    admin
      .from('order_items')
      .update({ daily_pack_sort_order: it.sortOrder })
      .eq('id', it.id),
  )

  const results = await Promise.all(promises)
  const failed = results.find((r) => r.error)
  if (failed?.error) {
    console.error('[order-items/reorder] failed:', failed.error.message)
    return NextResponse.json({ error: failed.error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
