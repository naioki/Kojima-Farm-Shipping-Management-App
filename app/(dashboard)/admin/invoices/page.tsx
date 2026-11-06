import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { Card } from '@/components/ui/Card'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { GenerateInvoiceForm } from '@/components/admin/GenerateInvoiceForm'
import { InvoiceCsvExport } from '@/components/admin/InvoiceCsvExport'
import { formatYen } from '@/lib/calculations/tax'
import { formatJpMonth, formatJpDateShort, jstTodayStr } from '@/lib/dates'
import { dueDateOf, receivableState, summarizeReceivables } from '@/lib/invoices/receivables'
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
 * 請求（月締め会計）。取引先×対象期間で請求書を作成・一覧する。
 * 納品書（出荷ごとの伝票）とは用途が異なるため別メニュー（/admin/delivery-notes）。
 */
export default async function InvoicesPage() {
  const guard = await requireAdmin('請求は管理者のみです。')
  if (guard) return guard

  const supabase = createAdminClient()
  const [{ data: invoices, error }, { count: pendingCount }, { count: uninvoicedCount }] = await Promise.all([
    supabase
      .from('invoices')
      .select('id, invoice_number, customer_id, billing_month, total_amount, status, issue_date, due_date')
      .order('created_at', { ascending: false }),
    supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending_review'),
    supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .in('status', ['approved', 'shipped']),
  ])
  if (error) return <ErrorState message="請求書の一覧を読み込めませんでした。時間をおいて再度お試しください。" detail={error.message} />

  const customerIds = [...new Set((invoices ?? []).map((i) => i.customer_id))]
  const { data: custRows, error: custErr } = customerIds.length
    ? await supabase.from('customers').select('id, name').in('id', customerIds)
    : { data: [] as { id: string; name: string }[], error: null }
  if (custErr) console.error('[invoices] 取引先名の解決に失敗:', custErr.message)
  const customerName = new Map((custRows ?? []).map((c) => [c.id, c.name]))
  const today = jstTodayStr()
  const ar = summarizeReceivables(invoices ?? [], today)

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="font-display text-2xl font-bold text-ink">請求</h1>

      {((pendingCount ?? 0) > 0 || (uninvoicedCount ?? 0) > 0) && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-warning bg-warning-bg px-3.5 py-2.5 text-xs font-bold text-earth-900">
          <div className="flex flex-wrap items-center gap-3">
            {(pendingCount ?? 0) > 0 && (
              <span>
                ⚠️ 未承認（確認待ち）の注文：<strong className="font-black underline">{pendingCount}件</strong>
              </span>
            )}
            {(uninvoicedCount ?? 0) > 0 && (
              <span>
                📋 未請求の確定・出荷済注文：<strong className="font-black">{uninvoicedCount}件</strong>
              </span>
            )}
          </div>
          {(pendingCount ?? 0) > 0 && (
            <Link
              href="/admin/orders?status=pending_review"
              className="rounded-lg bg-warning px-2.5 py-1 text-xs font-black text-white hover:bg-warning"
            >
              未承認を確認 →
            </Link>
          )}
        </div>
      )}

      {/* 売掛金（入金待ち・期日超過）。期日は請求書の支払期日、無ければ請求月の翌月末 */}
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <p className="text-xs text-ink-soft">入金待ち</p>
          <p className="num text-xl font-bold tabular-nums text-ink">{formatYen(ar.unpaidAmount)}</p>
          <p className="text-xs text-ink-faint">{ar.unpaidCount}件</p>
        </Card>
        <Card className={ar.overdueCount > 0 ? 'border-alert' : undefined}>
          <p className="text-xs text-ink-soft">うち支払期日超過</p>
          <p className={`num text-xl font-bold tabular-nums ${ar.overdueCount > 0 ? 'text-alert' : 'text-ink'}`}>
            {formatYen(ar.overdueAmount)}
          </p>
          <p className="text-xs text-ink-faint">{ar.overdueCount}件（翌月末払いとして判定）</p>
        </Card>
      </div>

      <Card className="space-y-4">
        <div>
          <h2 className="font-display text-base font-bold text-ink">請求書を作成</h2>
          <p className="text-xs text-ink-soft mt-0.5">
            対象期間を指定すると、出荷実績のある取引先のみが自動抽出されます。
          </p>
        </div>
        <GenerateInvoiceForm />
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
            const rs = receivableState(inv, today)
            const due = dueDateOf(inv)
            return (
              <Link key={inv.id} href={`/admin/invoices/${inv.id}`}>
                <Card variant="elevated" interactive className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="num font-bold text-ink">{inv.invoice_number}</p>
                    <p className="truncate text-sm text-ink-soft">
                      {customerName.get(inv.customer_id) ?? '—'}・{formatJpMonth(inv.billing_month)}
                      {rs && due && <>・期日 {formatJpDateShort(due)}</>}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="num font-bold tabular-nums text-ink">{formatYen(inv.total_amount)}</span>
                    {rs === 'overdue' && (
                      <span className="rounded-full bg-alert px-2 py-0.5 text-xs font-bold text-white">期日超過</span>
                    )}
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
