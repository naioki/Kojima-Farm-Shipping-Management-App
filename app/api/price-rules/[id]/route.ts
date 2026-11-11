import 'server-only'
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminApi } from '@/lib/auth/api-guard'

export const runtime = 'nodejs'

/** 価格ルールの削除（管理者）。過去注文は order_items に凍結済みなので影響しない。 */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdminApi('管理者のみ操作できます')
  if (!guard.ok) return guard.response
  const supabase = createAdminClient()

  const { error } = await supabase.from('price_rules').delete().eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
