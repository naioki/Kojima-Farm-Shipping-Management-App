import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { GenerateInvoiceForm } from '@/components/admin/GenerateInvoiceForm'
import { BulkInvoiceForm } from '@/components/admin/BulkInvoiceForm'
import { InvoiceCsvExport } from '@/components/admin/InvoiceCsvExport'
import { formatYen } from '@/lib/calculations/tax'
import { formatJpMonth } from '@/lib/dates'
import type { InvoiceStatus } from '@/types/database'
import { requireAdmin } from '@/lib/auth/require-admin'

export const dynamic = 'force-dynamic'

const STATUS_LABEL: Record<InvoiceStatus, { label: string; cls: string }> = {
  draft: { label: '下書き', cls: 'bg-bg-soft text-ink-soft' },
  finalized: { label: '確定', cls: 'bg-trust-50 text-trust-700' },
  sent: { label: '送付済', cls: 'bg-trust-50 text-trust-700' },
  paid: { label: '入金済', cls: 'bg-harvest-50 text-harvest-700' },
  void: { label: '無効', cls: 'bg-bg-soft text-ink-faint' },
}

/**
 * 請求（月締め会計）。取引先×対象月で請求書を作成・一覧する。
 * 納品書（出荷ごとの伝票）とは用途が異なるため別メニュー（/admin/delivery-notes）。
 */
export default async function InvoicesPage() {
  const guard = await requireAdmin('請求は管理者のみです。')
  if (guard) return guard

  const supabase = createClient()
  const { data: invoices, error } = await supabase
    .from('invoices')
    .select('id, invoice_number, customer_id, billing_month, total_amount, status, issue_date')
    .order('created_at', { ascending: false })
  if (error) return <ErrorState message={error.message} />

  const customerIds = [...new Set((invoices ?? []).map((i) => i.customer_id))]
  const { data: custRows } = customerIds.length
    ? await supabase.from('customers').select('id, name').in('id', customerIds)
    : { data: [] as { id: string; name: string }[] }
  const customerName = new Map((custRows ?? []).map((c) => [c.id, c.name]))

  const { data: activeCustomers } = await supabase
    .from('customers')
    .select('id, name')
    .eq('is_active', true)
    .order('name')

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="font-display text-2xl font-bold text-ink">請求</h1>

      <Card className="space-y-3">
        <h2 className="font-display text-base font-bold text-ink">請求書を作成</h2>
        <GenerateInvoiceForm customers={(activeCustomers ?? []).map((c) => ({ id: c.id, name: c.name }))} />
        <p className="text-sm text-ink-faint">
          対象期間（開始日〜終了日）の承認/出荷済み明細を税率別に集計し、欠番なしで採番します（インボイス制度対応・tax.md）。
        </p>
        <div className="border-t border-line pt-3">
          <p className="mb-2 text-sm font-medium text-ink">月次一括（全取引先まとめて）</p>
          <BulkInvoiceForm />
          <p className="mt-2 text-sm text-ink-faint">
            対象明細が無い取引先・同期間で作成済みの取引先は自動スキップします。
          </p>
        </div>
        <div className="border-t border-line pt-3">
          <p className="mb-2 text-sm font-medium text-ink">会計ソフト取り込み（CSV）</p>
          <InvoiceCsvExport />
          <p className="mt-2 text-sm text-ink-faint">
            発行日が期間内の全請求書の明細を1ファイルに出力します（UTF-8 BOM・税率別）。マネーフォワード / freee の取り込みウィザードで列を対応づけてください。各請求書の詳細からは1件ずつの CSV も出せます。
          </p>
        </div>
      </Card>

      {!invoices?.length ? (
        <EmptyState title="請求書はまだありません" description="上のフォームから作成してください。" />
      ) : (
        <div className="space-y-2">
          {invoices.map((inv) => {
            const s = STATUS_LABEL[inv.status as InvoiceStatus]
            return (
              <Link key={inv.id} href={`/admin/invoices/${inv.id}`}>
                <Card variant="elevated" interactive className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="num font-bold text-ink">{inv.invoice_number}</p>
                    <p className="truncate text-sm text-ink-soft">
                      {customerName.get(inv.customer_id) ?? '—'}・{formatJpMonth(inv.billing_month)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="num font-bold tabular-nums text-ink">{formatYen(inv.total_amount)}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${s.cls}`}>{s.label}</span>
                    <ChevronRight className="h-5 w-5 text-ink-faint" aria-hidden />
                  </div>
                </Card>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
