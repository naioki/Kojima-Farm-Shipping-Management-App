import { NextResponse } from 'next/server'
import { requireAdminApi } from '@/lib/auth/api-guard'
import { canTransitionInvoice } from '@/lib/invoices/receivables'
import { createAdminClient } from '@/lib/supabase/admin'
import { invoiceStatusPatchSchema } from '@/types/database'
import { writeAudit } from '@/lib/audit/log'

export const runtime = 'nodejs'

/**
 * 請求書ステータス更新（draft→finalized→sent→paid など）。管理者のみ。
 * 許される遷移は lib/invoices/receivables の canTransitionInvoice（無効は戻せない等）。
 * 変更は audit_log に記録（tax.md：請求変更は7年保存）。
 */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdminApi()
  if (!guard.ok) return guard.response
  const user = guard.user

  const parsed = invoiceStatusPatchSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid', detail: parsed.error.flatten() }, { status: 400 })
  }
  const supabase = createAdminClient()

  const { data: current, error: currentErr } = await supabase
    .from('invoices')
    .select('id, status')
    .eq('id', params.id)
    .maybeSingle()
  // DBエラーを not_found（404）に化けさせない。
  if (currentErr) return NextResponse.json({ error: currentErr.message }, { status: 500 })
  if (!current) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (!canTransitionInvoice(current.status, parsed.data.status)) {
    return NextResponse.json({ error: `この請求書は「${current.status}」から「${parsed.data.status}」に変更できません` }, { status: 409 })
  }

  // 同時操作で二重に変わらないよう、読んだ時点の状態のときだけ更新する
  const { data: updated, error } = await supabase
    .from('invoices')
    .update({ status: parsed.data.status })
    .eq('id', params.id)
    .eq('status', current.status)
    .select('id, status')
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!updated) return NextResponse.json({ error: '他の操作で状態が変わりました。再読み込みしてください' }, { status: 409 })

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

/**
 * 請求書の削除（admin のみ）。下書きのときだけ。
 * 誤作成した下書きの取り消し・再作成用。invoice_items はカスケード削除。
 * 確定後は取引先に出た帳票なので消さず「無効」にする（PATCH status=void。番号と履歴が残る: tax.md）。
 */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdminApi()
  if (!guard.ok) return guard.response
  const user = guard.user
  const supabase = createAdminClient()

  const { data: current, error: currentErr } = await supabase
    .from('invoices')
    .select('id, invoice_number, customer_id, billing_month, total_amount, status')
    .eq('id', params.id)
    .maybeSingle()
  if (currentErr) return NextResponse.json({ error: currentErr.message }, { status: 500 })
  if (!current) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (current.status !== 'draft') {
    return NextResponse.json(
      { error: '確定済みの請求書は削除できません。「無効にする」を使ってください（番号と履歴を残すため）' },
      { status: 409 },
    )
  }

  const admin = createAdminClient()
  // 読んだ時点で下書きだったものだけ消す（同時に確定された場合は消さない）
  const { data: deleted, error: delErr } = await admin
    .from('invoices')
    .delete()
    .eq('id', params.id)
    .eq('status', 'draft')
    .select('id')

  if (delErr) {
    return NextResponse.json({ error: delErr.message }, { status: 500 })
  }
  if (!deleted || deleted.length === 0) {
    return NextResponse.json({ error: '他の操作で状態が変わりました。再読み込みしてください' }, { status: 409 })
  }

  await writeAudit(admin, {
    entityType: 'invoices',
    entityId: params.id,
    action: 'DELETE',
    oldValues: current,
    newValues: null,
    userId: user.id,
  })

  return NextResponse.json({ ok: true, deletedId: params.id })
}
