import Link from 'next/link'
import { ChevronLeft, FileDown } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { ErrorState } from '@/components/ui/States'
import { PrintButton } from '@/components/admin/PrintButton'
import { DeliveryNoteDocument } from '@/components/admin/DeliveryNoteDocument'
import { parseAmountMode } from '@/lib/delivery-notes/amount-mode'
import { formatJpDateTime } from '@/lib/dates'
import { requireAdmin } from '@/lib/auth/require-admin'

export const dynamic = 'force-dynamic'

/**
 * 保存済み納品書 詳細（発行時スナップショット）。
 * 元注文を編集しても、ここは当時の内容のまま。再印刷・PDF・確認に使う。
 */
export default async function SavedDeliveryNotePage({ params }: { params: { id: string } }) {
  const guard = await requireAdmin('納品書は管理者のみです。')
  if (guard) return guard

  const supabase = createClient()

  const { data: note, error } = await supabase
    .from('delivery_notes')
    .select('*')
    .eq('id', params.id)
    .maybeSingle()
  if (error) return <ErrorState message={error.message} />
  if (!note) return <ErrorState title="納品書が見つかりません" message="削除されたか、IDが不正です。" />

  // 明細は納品書の本体。取得失敗を「明細なし」に化けさせない。
  const { data: items, error: itemsErr } = await supabase
    .from('delivery_note_items')
    .select('product_name, quantity, unit, unit_price, tax_rate, subtotal')
    .eq('delivery_note_id', params.id)
    .order('sort_order')
  if (itemsErr)
    return <ErrorState message="納品書の明細を読み込めませんでした。時間をおいて再度お試しください。" detail={itemsErr.message} />

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href="/admin/delivery-notes" className="inline-flex items-center gap-1 text-sm text-trust-600 hover:underline">
          <ChevronLeft className="h-4 w-4" aria-hidden />
          納品書
        </Link>
        <div className="flex items-center gap-2">
          <a
            href={`/api/delivery-notes/${note.id}/pdf`}
            target="_blank"
            rel="noopener"
            className="inline-flex h-8 items-center gap-1.5 rounded border border-line-strong bg-bg-card px-3 text-sm font-medium text-earth-700 hover:bg-earth-50"
          >
            <FileDown className="h-4 w-4" aria-hidden />
            PDF
          </a>
          <PrintButton />
        </div>
      </div>

      <p className="text-sm text-ink-faint print:hidden">
        発行日時: <span className="num">{formatJpDateTime(note.issued_at)}</span>
        （発行時のスナップショット。元注文を編集してもこの内容は変わりません）
      </p>

      <DeliveryNoteDocument
        noteNumber={note.note_number}
        customerName={note.customer_name}
        date={note.delivery_date}
        issuer={{ name: note.issuer_name, address: note.issuer_address, tel: note.issuer_tel }}
        items={items ?? []}
        totals={{ subtotal8: note.subtotal_8, subtotal10: note.subtotal_10, total: note.total_amount }}
        mode={parseAmountMode(note.amount_mode)}
      />
    </div>
  )
}
