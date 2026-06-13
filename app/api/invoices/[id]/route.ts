import { NextResponse } from 'next/server'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { invoiceStatusPatchSchema } from '@/types/database'
import { writeAudit } from '@/lib/audit/log'

export const runtime = 'nodejs'

/**
 * 請求書ステータス更新（draft→finalized など）。admin のみ（RLS）。
 * 変更は audit_log に記録（tax.md：請求変更は7年保存）。
 */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const parsed = invoiceStatusPatchSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid', detail: parsed.error.flatten() }, { status: 400 })
  }
  const supabase = createClient()

  const { data: current } = await supabase
    .from('invoices')
    .select('id, status')
    .eq('id', params.id)
    .maybeSingle()
  if (!current) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const { data: updated, error } = await supabase
    .from('invoices')
    .update({ status: parsed.data.status })
    .eq('id', params.id)
    .select('id, status')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await writeAudit(supabase, {
    entityType: 'invoices',
    entityId: params.id,
    action: 'UPDATE',
    oldValues: { status: current.status },
    newValues: { status: updated.status },
    userId: user.id,
  })

  return NextResponse.json({ invoice: updated })
}
