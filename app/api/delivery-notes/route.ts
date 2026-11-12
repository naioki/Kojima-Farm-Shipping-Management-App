import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { deliveryNoteCreateSchema } from '@/types/database'
import { sumInvoiceTotals, type TaxRate } from '@/lib/calculations/tax'
import { getSetting } from '@/lib/settings'
import { deliveryNoteMonthKey, formatDeliveryNoteNumber } from '@/lib/delivery-notes/number'
import { writeAudit } from '@/lib/audit/log'
import { isSameNoteSnapshot } from '@/lib/delivery-notes/snapshot'
import { reviseDeliveryNote } from '@/lib/delivery-notes/revise'
import { requireStaffApi } from '@/lib/auth/api-guard'

export const runtime = 'nodejs'

/**
 * 納品書を発行（スナップショット保存）。
 * - #40: status IN ('approved', 'shipped', 'invoiced') かつ実出荷数が1以上の明細のみを対象にし、キャンセル済注文や未承認注文の混入を防止。
 * - #41: 数量は billable_qty ?? shipped_qty ?? quantity の優先順で実出荷数を採用。
 */
export async function POST(req: Request) {
  const guard = await requireStaffApi()
  if (!guard.ok) return guard.response
  const user = guard.user

  const parsed = deliveryNoteCreateSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid', detail: parsed.error.flatten() }, { status: 400 })
  }
  const { customer_id, delivery_date, amount_mode, destination_id } = parsed.data
  const supabase = createAdminClient()

  const { data: customer, error: custErr } = await supabase
    .from('customers')
    .select('name')
    .eq('id', customer_id)
    .maybeSingle()
  if (custErr) return NextResponse.json({ error: custErr.message }, { status: 500 })
  if (!customer) return NextResponse.json({ error: 'unknown_customer' }, { status: 400 })

  let customerNameSnapshot = customer.name
  if (destination_id) {
    const { data: dest, error: destErr } = await supabase
      .from('delivery_destinations')
      .select('code, full_name')
      .eq('id', destination_id)
      .maybeSingle()
    if (destErr) console.error('[api/delivery-notes] 納入先名の取得に失敗:', destErr.message)
    if (dest) customerNameSnapshot = `${customer.name}＞${dest.code || dest.full_name}`
  }

  // #40 有効な確定注文のみに絞り込む（cancelled / pending_review を除外、かつ無償サンプル注文を通常納品書から除外）
  let ordersQuery = supabase
    .from('orders')
    .select('id, note, delivery_destinations(full_name, code)')
    .eq('customer_id', customer_id)
    .eq('delivery_date', delivery_date)
    .in('status', ['approved', 'shipped', 'invoiced'])
  if (destination_id) ordersQuery = ordersQuery.eq('destination_id', destination_id)
  const { data: orders, error: ordersErr } = await ordersQuery
  if (ordersErr) return NextResponse.json({ error: `対象注文の取得に失敗しました: ${ordersErr.message}` }, { status: 500 })
  const isAskingSampleDest = customerNameSnapshot.includes('サンプル')
  const filteredOrders = (orders ?? []).filter((o) => {
    if (isAskingSampleDest) return true
    const noteStr = (o as { note?: string | null }).note ?? ''
    const destObj = (o as { delivery_destinations?: { full_name?: string; code?: string } | null }).delivery_destinations
    const destStr = `${destObj?.full_name ?? ''} ${destObj?.code ?? ''}`
    return !noteStr.includes('サンプル') && !destStr.includes('サンプル')
  })
  const orderIds = filteredOrders.map((o) => o.id)

  const itemsRes = orderIds.length
    ? await supabase
        .from('order_items')
        .select('product_name, quantity, shipped_qty, billable_qty, unit, unit_price, tax_rate, subtotal')
        .in('order_id', orderIds)
        .order('product_name')
    : {
        data: [] as {
          product_name: string
          quantity: number
          shipped_qty?: number | null
          billable_qty?: number | null
          unit: string
          unit_price: number | null
          tax_rate: number
          subtotal: number | null
        }[],
        error: null,
      }
  if (itemsRes.error) return NextResponse.json({ error: `明細の取得に失敗しました: ${itemsRes.error.message}` }, { status: 500 })

  // #40 & #41 実出荷数（billable_qty ?? shipped_qty ?? quantity）を採用し、0以下の明細を除外
  const items = (itemsRes.data ?? [])
    .map((it) => {
      const effectiveQty = Number(it.billable_qty ?? it.shipped_qty ?? it.quantity) || 0
      const unitPrice = it.unit_price ?? 0
      return {
        ...it,
        quantity: effectiveQty,
        subtotal: it.unit_price != null ? effectiveQty * unitPrice : it.subtotal,
      }
    })
    .filter((it) => it.quantity > 0)

  if (items.length === 0) {
    return NextResponse.json({ error: 'no_items' }, { status: 400 })
  }

  const [issuerName, issuerAddress, issuerTel] = await Promise.all([
    getSetting('FARM_NAME'),
    getSetting('FARM_ADDRESS'),
    getSetting('FARM_TEL'),
  ])

  const t = sumInvoiceTotals(
    items.map((it) => ({ quantity: it.quantity, unitPrice: it.unit_price, taxRate: it.tax_rate as TaxRate })),
  )

  // 同じ取引先・納品日の直近の納品書がある場合:
  // - 内容（明細・金額・発行元）が完全に同じ → それを返す（再印刷。番号を増やさない）
  // - 内容が変わっている → 同じ番号の「訂正版」にする。旧内容は audit_log に丸ごと保存（lib/delivery-notes/revise.ts）
  const { data: existingNote, error: existingErr } = await supabase
    .from('delivery_notes')
    .select('id, note_number, amount_mode, issuer_name, issuer_address, issuer_tel, total_amount')
    .eq('customer_id', customer_id)
    .eq('delivery_date', delivery_date)
    .eq('customer_name', customerNameSnapshot)
    .order('issued_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (existingErr) return NextResponse.json({ error: `既存納品書の確認に失敗しました: ${existingErr.message}` }, { status: 500 })

  if (existingNote?.id) {
    const { data: existingItems, error: exItemsErr } = await supabase
      .from('delivery_note_items')
      .select('product_name, quantity, unit, unit_price, tax_rate')
      .eq('delivery_note_id', existingNote.id)
      .order('sort_order')
    if (exItemsErr) return NextResponse.json({ error: `既存納品書の明細取得に失敗しました: ${exItemsErr.message}` }, { status: 500 })

    const sameContent = isSameNoteSnapshot(
      { header: existingNote, items: existingItems ?? [] },
      {
        header: {
          amount_mode,
          issuer_name: issuerName ?? null,
          issuer_address: issuerAddress ?? null,
          issuer_tel: issuerTel ?? null,
          total_amount: t.total.toNumber(),
        },
        items,
      },
    )
    if (sameContent) {
      return NextResponse.json({ id: existingNote.id, note_number: existingNote.note_number, reused: true }, { status: 200 })
    }

    const rev = await reviseDeliveryNote(supabase, {
      noteId: existingNote.id,
      header: {
        amount_mode,
        issuer_name: issuerName ?? null,
        issuer_address: issuerAddress ?? null,
        issuer_tel: issuerTel ?? null,
        subtotal_8: t.reduced.subtotal.toNumber(),
        subtotal_10: t.standard.subtotal.toNumber(),
        total_amount: t.total.toNumber(),
      },
      items: items.map((it, i) => ({
        product_name: it.product_name,
        quantity: it.quantity,
        unit: it.unit,
        unit_price: Number(it.unit_price ?? 0),
        tax_rate: it.tax_rate,
        subtotal: Number(it.subtotal ?? 0),
        sort_order: i,
      })),
      userId: user.id,
    })
    if (!rev.ok) return NextResponse.json({ error: rev.message }, { status: 500 })
    return NextResponse.json(
      { id: existingNote.id, note_number: existingNote.note_number, revised: true, revision: rev.revision },
      { status: 200 },
    )
  }

  const monthKey = deliveryNoteMonthKey(delivery_date)
  const { data: seq, error: seqErr } = await supabase.rpc('get_next_delivery_note_number', { p_month: monthKey })
  if (seqErr) return NextResponse.json({ error: seqErr.message }, { status: 500 })
  const note_number = formatDeliveryNoteNumber(monthKey, seq as number)

  const { data: note, error: noteErr } = await supabase
    .from('delivery_notes')
    .insert({
      note_number,
      customer_id,
      customer_name: customerNameSnapshot,
      delivery_date,
      amount_mode,
      issuer_name: issuerName ?? null,
      issuer_address: issuerAddress ?? null,
      issuer_tel: issuerTel ?? null,
      subtotal_8: t.reduced.subtotal.toNumber(),
      subtotal_10: t.standard.subtotal.toNumber(),
      total_amount: t.total.toNumber(),
      issued_by: user.id,
    })
    .select('id, note_number')
    .single()
  if (noteErr || !note) return NextResponse.json({ error: noteErr?.message ?? 'insert_failed' }, { status: 500 })

  const itemRows = items.map((it, i) => ({
    delivery_note_id: note.id,
    product_name: it.product_name,
    quantity: it.quantity,
    unit: it.unit,
    unit_price: it.unit_price,
    tax_rate: it.tax_rate as TaxRate,
    subtotal: it.subtotal,
    sort_order: i,
  }))
  const { error: itemsErr } = await supabase.from('delivery_note_items').insert(itemRows)
  if (itemsErr) {
    // 巻き戻し（明細の無い納品書を残さない）
    const { error: rollbackErr } = await supabase.from('delivery_notes').delete().eq('id', note.id)
    if (rollbackErr) {
      console.error('[delivery-notes] 巻き戻し（納品書の削除）に失敗。明細の無い納品書が残っています:', note.id, rollbackErr.message)
      return NextResponse.json(
        {
          error: `納品書の明細を保存できませんでした: ${itemsErr.message}。作りかけの納品書（${note.note_number}）の一部が残っている可能性があります。納品書一覧で確認してください`,
        },
        { status: 500 },
      )
    }
    return NextResponse.json({ error: itemsErr.message }, { status: 500 })
  }

  await writeAudit(supabase, {
    entityType: 'delivery_notes',
    entityId: note.id,
    action: 'INSERT',
    oldValues: null,
    newValues: note,
    userId: user.id,
  })

  return NextResponse.json({ id: note.id, note_number: note.note_number }, { status: 201 })
}
