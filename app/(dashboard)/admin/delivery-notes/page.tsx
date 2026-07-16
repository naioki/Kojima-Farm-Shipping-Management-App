import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { DeliveryNoteForm } from '@/components/admin/DeliveryNoteForm'
import { getSetting } from '@/lib/settings'
import { formatYen } from '@/lib/calculations/tax'
import { parseAmountMode, amountModeLabel } from '@/lib/delivery-notes/amount-mode'
import { formatJpDateShort } from '@/lib/dates'
import { requireAdmin } from '@/lib/auth/require-admin'

export const dynamic = 'force-dynamic'

/**
 * 納品書（出荷ごとの伝票）。取引先×納品日でその日の明細から伝票を生成・発行する。
 * 「発行して保存」した納品書は履歴として残り、後から再印刷・確認できる（発行時スナップショット）。
 */
export default async function DeliveryNotesPage() {
  const guard = await requireAdmin('納品書は管理者のみです。')
  if (guard) return guard

  const supabase = createClient()
  const [{ data: customers, error }, { data: notes }, amountModeSetting] = await Promise.all([
    supabase.from('customers').select('id, name').eq('is_active', true).order('name'),
    supabase
      .from('delivery_notes')
      .select('id, note_number, customer_name, delivery_date, amount_mode, total_amount, issued_at')
      .order('issued_at', { ascending: false })
      .limit(50),
    getSetting('DELIVERY_NOTE_AMOUNT_MODE'),
  ])
  if (error) return <ErrorState message={error.message} />
  const defaultMode = parseAmountMode(amountModeSetting)

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="font-display text-2xl font-bold text-ink">納品書</h1>

      <Card className="space-y-3">
        <h2 className="font-display text-base font-bold text-ink">納品書を発行</h2>
        <DeliveryNoteForm
          customers={(customers ?? []).map((c) => ({ id: c.id, name: c.name }))}
          defaultMode={defaultMode}
        />
        <p className="text-sm text-ink-faint">
          選んだ取引先・納品日のその日の明細をまとめて1枚の納品書にします。プレビューで「発行して保存」を押すと
          履歴に残り、後から再印刷・確認できます。金額表示（金額あり／後から手書き／金額なし）は発行ごとに
          切り替えでき、既定は設定で変更できます。
        </p>
      </Card>

      <div className="space-y-2">
        <h2 className="font-display text-base font-bold text-ink">発行済みの履歴</h2>
        {!notes?.length ? (
          <EmptyState
            title="まだ発行された納品書はありません"
            description="上のフォームでプレビューを開き「発行して保存」を押すと、ここに履歴が残ります。"
          />
        ) : (
          <div className="space-y-2">
            {notes.map((n) => (
              <Link key={n.id} href={`/admin/delivery-notes/${n.id}`}>
                <Card variant="elevated" interactive className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="num font-bold text-ink">{n.note_number}</p>
                    <p className="truncate text-sm text-ink-soft">
                      {n.customer_name}・納品 {formatJpDateShort(n.delivery_date)}
                      <span className="ml-2 rounded-full bg-bg-soft px-2 py-0.5 text-xs text-ink-faint">
                        {amountModeLabel(parseAmountMode(n.amount_mode))}
                      </span>
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    {n.amount_mode === 'full' && (
                      <span className="num font-bold tabular-nums text-ink">{formatYen(n.total_amount)}</span>
                    )}
                    <ChevronRight className="h-5 w-5 text-ink-faint" aria-hidden />
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
