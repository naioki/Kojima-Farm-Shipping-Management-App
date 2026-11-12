import 'server-only'
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { writeAudit } from '@/lib/audit/log'
import { itemPricingSchema } from '@/types/database'
import { requireAdminApi } from '@/lib/auth/api-guard'

export const runtime = 'nodejs'

/**
 * 明細の価格確定（個別・管理者）。
 * 単価・税率・請求数量(billable_qty)を確定する。赤点（品質減）は billable_qty を下げ理由を残す。
 * 価格状態を provisional/confirmed に。変更は audit_log に記録（tax.md 7年）。
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdminApi('価格確定は管理者のみです')
  if (!guard.ok) return guard.response
  const user = guard.user

  const parsed = itemPricingSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? '入力値が不正です' }, { status: 400 })
  }
  const d = parsed.data
  const admin = createAdminClient()

  const { data: before, error: beforeErr } = await admin
    .from('order_items')
    .select('unit_price, tax_rate, billable_qty, price_status')
    .eq('id', params.id)
    .maybeSingle()
  // DBエラーを「明細が見つかりません」（404）に化けさせない。
  if (beforeErr) return NextResponse.json({ error: beforeErr.message }, { status: 500 })
  if (!before) return NextResponse.json({ error: '明細が見つかりません' }, { status: 404 })

  const { error } = await admin
    .from('order_items')
    .update({
      unit_price: d.unit_price,
      tax_rate: d.tax_rate,
      billable_qty: d.billable_qty ?? null,
      billable_reason: d.billable_reason ?? null,
      price_status: d.status,
      priced_at: new Date().toISOString(),
      priced_by: user.id,
    })
    .eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  try {
    await writeAudit(admin, {
      entityType: 'order_items',
      entityId: params.id,
      action: 'UPDATE',
      oldValues: { unit_price: before.unit_price, tax_rate: before.tax_rate, billable_qty: before.billable_qty, price_status: before.price_status },
      newValues: { unit_price: d.unit_price, tax_rate: d.tax_rate, billable_qty: d.billable_qty ?? null, price_status: d.status },
      userId: user.id,
    })
  } catch (e) {
    console.error('[pricing] audit failed', e)
  }

  return NextResponse.json({ ok: true })
}
