import { createClient } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import { ErrorState } from '@/components/ui/States'
import { DeliveryNoteForm } from '@/components/admin/DeliveryNoteForm'
import { getSetting } from '@/lib/settings'
import { parseAmountMode } from '@/lib/delivery-notes/amount-mode'

export const dynamic = 'force-dynamic'

/**
 * 納品書（出荷ごとの伝票）。取引先×納品日でその日の明細から伝票を生成・印刷する。
 * 月締めの請求（/admin/invoices）とは用途が異なるため別メニュー。
 */
export default async function DeliveryNotesPage() {
  const supabase = createClient()
  const [{ data: customers, error }, amountModeSetting] = await Promise.all([
    supabase.from('customers').select('id, name').eq('is_active', true).order('name'),
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
          選んだ取引先・納品日のその日の明細をまとめて1枚の納品書にします。印刷から PDF 保存できます。
          金額表示（金額あり／後から手書き／金額なし）は発行ごとに切り替えでき、既定は設定で変更できます。
        </p>
      </Card>
    </div>
  )
}
