import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * 納品書の「訂正版」発行（同じ番号のまま内容を差し替える）。
 *
 * 発行済み帳票の内容を失わないよう、差し替える前に旧スナップショット（ヘッダー＋全明細）を
 * audit_log に丸ごと保存する。履歴が保存できなければ差し替えない（履歴なしの上書きを禁止）。
 * 明細の差し替えに失敗したら旧明細・旧ヘッダーに戻す。
 */
export interface NoteHeaderUpdate {
  amount_mode: string
  issuer_name: string | null
  issuer_address: string | null
  issuer_tel: string | null
  subtotal_8: number
  subtotal_10: number
  total_amount: number
}
export interface NoteItemRow {
  product_name: string
  quantity: number
  unit: string
  unit_price: number
  tax_rate: number
  subtotal: number
  sort_order: number
}

export async function reviseDeliveryNote(
  supabase: SupabaseClient,
  params: { noteId: string; header: NoteHeaderUpdate; items: NoteItemRow[]; userId: string | null },
): Promise<{ ok: true; revision: number } | { ok: false; message: string }> {
  const { noteId, header, items, userId } = params

  const [oldHeaderRes, oldItemsRes, prevRevRes] = await Promise.all([
    supabase.from('delivery_notes').select('*').eq('id', noteId).maybeSingle(),
    supabase
      .from('delivery_note_items')
      .select('product_name, quantity, unit, unit_price, tax_rate, subtotal, sort_order')
      .eq('delivery_note_id', noteId)
      .order('sort_order'),
    supabase
      .from('audit_log')
      .select('id', { count: 'exact', head: true })
      .eq('entity_type', 'delivery_notes')
      .eq('entity_id', noteId)
      .eq('action', 'UPDATE'),
  ])
  if (oldHeaderRes.error || !oldHeaderRes.data) {
    return { ok: false, message: `訂正元の納品書の取得に失敗しました: ${oldHeaderRes.error?.message ?? 'not_found'}` }
  }
  if (oldItemsRes.error) return { ok: false, message: `訂正元の明細の取得に失敗しました: ${oldItemsRes.error.message}` }
  if (prevRevRes.error) return { ok: false, message: `訂正履歴の確認に失敗しました: ${prevRevRes.error.message}` }

  const oldHeader = oldHeaderRes.data as Record<string, unknown>
  const oldItems = (oldItemsRes.data ?? []) as NoteItemRow[]
  const revision = (prevRevRes.count ?? 0) + 1 // 1 = 第1訂正

  // 1) 旧内容を履歴に保存（失敗したら差し替えない）
  const { error: auditErr } = await supabase.from('audit_log').insert({
    entity_type: 'delivery_notes',
    entity_id: noteId,
    action: 'UPDATE',
    changed_fields: ['items', ...Object.keys(header).filter((k) => oldHeader[k] !== (header as unknown as Record<string, unknown>)[k])],
    old_values: { ...oldHeader, items: oldItems },
    new_values: { ...header, items, revision, note: `訂正版（第${revision}訂正）` },
    user_id: userId,
  })
  if (auditErr) return { ok: false, message: `訂正履歴の保存に失敗したため訂正を中止しました: ${auditErr.message}` }

  // 2) ヘッダー差し替え
  const { error: hdrErr } = await supabase
    .from('delivery_notes')
    .update({ ...header, issued_at: new Date().toISOString(), issued_by: userId })
    .eq('id', noteId)
  if (hdrErr) return { ok: false, message: `納品書の訂正に失敗しました: ${hdrErr.message}` }

  // 3) 明細差し替え（失敗時は旧明細・旧ヘッダーへ戻す）
  const restore = async () => {
    await supabase.from('delivery_note_items').delete().eq('delivery_note_id', noteId)
    if (oldItems.length) {
      await supabase.from('delivery_note_items').insert(oldItems.map((it) => ({ ...it, delivery_note_id: noteId })))
    }
    const restoreHeader: Record<string, unknown> = {}
    for (const k of [...Object.keys(header), 'issued_at', 'issued_by']) restoreHeader[k] = oldHeader[k]
    await supabase.from('delivery_notes').update(restoreHeader).eq('id', noteId)
  }
  const { error: delErr } = await supabase.from('delivery_note_items').delete().eq('delivery_note_id', noteId)
  if (delErr) {
    await restore()
    return { ok: false, message: `納品書明細の訂正に失敗しました: ${delErr.message}` }
  }
  const { error: insErr } = await supabase
    .from('delivery_note_items')
    .insert(items.map((it) => ({ ...it, delivery_note_id: noteId })))
  if (insErr) {
    await restore()
    return { ok: false, message: `納品書明細の訂正に失敗したため元に戻しました: ${insErr.message}` }
  }

  return { ok: true, revision }
}
