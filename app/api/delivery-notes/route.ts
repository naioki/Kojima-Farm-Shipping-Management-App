import { NextResponse } from 'next/server'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { deliveryNoteCreateSchema } from '@/types/database'
import { sumInvoiceTotals, type TaxRate } from '@/lib/calculations/tax'
import { getSetting } from '@/lib/settings'
import { deliveryNoteMonthKey, formatDeliveryNoteNumber } from '@/lib/delivery-notes/number'
import { writeAudit } from '@/lib/audit/log'

export const runtime = 'nodejs'

/**
 * 納品書を発行（スナップショット保存）。取引先×納品日のその日の明細を凍結して履歴に残す。
 *   - 明細・取引先名・自社情報・金額モード・税率別合計を delivery_notes に保存
 *   - 以後、元注文(order_items)を編集しても保存済み納品書は不変（再印刷・確認用）
 *   - 番号は月別連番 D{YYYYMM}-{seq}（参照用・欠番許容）
 */
export async function POST(req: Request) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const parsed = deliveryNoteCreateSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid', detail: parsed.error.flatten() }, { status: 400 })
  }
  const { customer_id, delivery_date, amount_mode, destination_id } = parsed.data
  const supabase = createClient()

  // 取引先（名前スナップショット用）
  const { data: customer, error: custErr } = await supabase
    .from('customers')
    .select('name')
    .eq('id', customer_id)
    .maybeSingle()
  if (custErr) return NextResponse.json({ error: custErr.message }, { status: 500 })
  if (!customer) return NextResponse.json({ error: 'unknown_customer' }, { status: 400 })

  // 納入先で絞り込み中は「取引先＞納入先」をスナップショット名にする（表示は常にこのルール）。
  // delivery_notes に専用列を追加せず、既存の customer_name スナップショットに含める。
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

  // その日の明細（orders→order_items）。納入先で絞り込み中はその納入先の注文だけを対象にする
  // （表示のプレビューと発行内容がズレないように・複数納入先混在時の事故防止）。
  let ordersQuery = supabase.from('orders').select('id').eq('customer_id', customer_id).eq('delivery_date', delivery_date)
  if (destination_id) ordersQuery = ordersQuery.eq('destination_id', destination_id)
  const { data: orders, error: ordersErr } = await ordersQuery
  // 発行スナップショットの元データ。取得失敗を「明細なし」に化けさせない（誤った空伝票の凍結を防ぐ）。
  if (ordersErr) return NextResponse.json({ error: `対象注文の取得に失敗しました: ${ordersErr.message}` }, { status: 500 })
  const orderIds = (orders ?? []).map((o) => o.id)
  const itemsRes = orderIds.length
    ? await supabase
        .from('order_items')
        .select('product_name, quantity, unit, unit_price, tax_rate, subtotal')
        .in('order_id', orderIds)
        .order('product_name')
    : { data: [] as { product_name: string; quantity: number; unit: string; unit_price: number | null; tax_rate: number; subtotal: number | null }[], error: null }
  if (itemsRes.error) return NextResponse.json({ error: `明細の取得に失敗しました: ${itemsRes.error.message}` }, { status: 500 })
  const items = itemsRes.data ?? []
  if (items.length === 0) {
    return NextResponse.json({ error: 'no_items' }, { status: 400 })
  }

  // 自社情報スナップショット
  const [issuerName, issuerAddress, issuerTel] = await Promise.all([
    getSetting('FARM_NAME'),
    getSetting('FARM_ADDRESS'),
    getSetting('FARM_TEL'),
  ])

  const t = sumInvoiceTotals(
    items.map((it) => ({ quantity: it.quantity, unitPrice: it.unit_price, taxRate: it.tax_rate as TaxRate })),
  )

  // 採番（月別連番）
  const monthKey = deliveryNoteMonthKey(delivery_date)
  const { data: seq, error: seqErr } = await supabase.rpc('get_next_delivery_note_number', { p_month: monthKey })
  if (seqErr) return NextResponse.json({ error: seqErr.message }, { status: 500 })
  const note_number = formatDeliveryNoteNumber(monthKey, seq as number)

  // ヘッダー作成
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
  if (noteErr) return NextResponse.json({ error: noteErr.message }, { status: 500 })

  // 明細スナップショット
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
    // ヘッダーだけ残らないよう後始末
    await supabase.from('delivery_notes').delete().eq('id', note.id)
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
