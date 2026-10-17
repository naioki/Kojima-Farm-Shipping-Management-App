import { NextResponse } from 'next/server'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { writeAudit } from '@/lib/audit/log'
import { determineUndoEligibility } from '@/lib/orders/undo'

export const runtime = 'nodejs'

/**
 * 直近変更の Undo（features.md §6）。audit_log の最新 UPDATE を逆適用する。
 *   - 期限: 承認後24h（既定）。出荷済み・請求確定・他者編集中・期限切れは不可。
 *   - Undo 自体も audit_log に action='undo' で記録。Redo は実装しない。
 */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const supabase = createClient()

  const { data: item, error: itemErr } = await supabase
    .from('order_items')
    .select('*')
    .eq('id', params.id)
    .maybeSingle()
  // DBエラーを not_found（404）に化けさせない。
  if (itemErr) return NextResponse.json({ error: itemErr.message }, { status: 500 })
  if (!item) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  // 取り消す対象＝最新の UPDATE 監査
  const { data: lastChange, error: lastChangeErr } = await supabase
    .from('audit_log')
    .select('*')
    .eq('entity_type', 'order_items')
    .eq('entity_id', params.id)
    .eq('action', 'UPDATE')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  // DBエラーを nothing_to_undo（404）に化けさせない。
  if (lastChangeErr) return NextResponse.json({ error: lastChangeErr.message }, { status: 500 })
  if (!lastChange) return NextResponse.json({ error: 'nothing_to_undo' }, { status: 404 })

  // 請求確定の有無（この明細が確定済み請求書に載っていれば Undo 不可）
  const { data: invoiceRows, error: invoiceRowsErr } = await supabase
    .from('invoice_items')
    .select('invoices!inner(status)')
    .eq('order_item_id', params.id)
  // 確定請求チェックのDBエラーを「未確定」に化けさせない（確定済み請求のUndoを防ぐ）。
  if (invoiceRowsErr) return NextResponse.json({ error: invoiceRowsErr.message }, { status: 500 })
  // invoices!inner はネスト配列で返るため flat にして判定する
  const isInvoiceFinalized = (invoiceRows ?? [])
    .flatMap((row) => row.invoices)
    .some((iv) => ['finalized', 'sent', 'paid'].includes(iv.status))

  const eligibility = determineUndoEligibility({
    changeCreatedAt: new Date(lastChange.created_at),
    now: new Date(),
    isShipped: Boolean(item.shipped_at),
    isInvoiceFinalized,
    lockedByOther: false, // TODO: 編集ロック機構を入れたら反映
  })
  if (!eligibility.canUndo) {
    return NextResponse.json({ error: 'undo_not_allowed', reason: eligibility.reason }, { status: 409 })
  }

  // 旧値へ逆適用（生成列・version は除外）。version は楽観ロックのため +1 する。
  const old = lastChange.old_values as Record<string, unknown>
  const restorable = pick(old, [
    'quantity',
    'unit_price',
    'tax_rate',
    'fraction_note',
    'field_status',
    'shipped_qty',
    'shipped_at',
  ])

  const { data: reverted, error } = await supabase
    .from('order_items')
    .update({ ...restorable, version: item.version + 1 })
    .eq('id', params.id)
    .eq('version', item.version)
    .select()
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!reverted) return NextResponse.json({ error: 'conflict' }, { status: 409 })

  await writeAudit(supabase, {
    entityType: 'order_items',
    entityId: params.id,
    action: 'undo',
    oldValues: item,
    newValues: reverted,
    userId: user.id,
  })

  return NextResponse.json({ item: reverted })
}

function pick<T extends Record<string, unknown>>(obj: T, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of keys) if (k in obj) out[k] = obj[k]
  return out
}
