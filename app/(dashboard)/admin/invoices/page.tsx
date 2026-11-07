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
import { fetchBilledOrderItemIds } from '@/lib/invoices/generate'
import type { InvoiceStatus } from '@/types/database'
import { requireAdmin } from '@/lib/auth/require-admin'

export const dynamic = 'force-dynamic'

const STATUS_LABEL: Record<InvoiceStatus, { label: string; cls: string }> = {
  draft: { label: '下書き', cls: 'bg-bg-soft text-ink-soft' },
  // 確定（未送付）は「次は送付」の注意色、送付済は藍、入金済は緑で見分ける
  finalized: { label: '確定・未送付', cls: 'bg-earth-100 text-earth-800' },
  sent: { label: '送付済', cls: 'bg-trust-50 text-trust-700' },
  paid: { label: '入金済', cls: 'bg-harvest-50 text-harvest-700' },
  void: { label: '無効', cls: 'border border-line-strong bg-bg-soft text-ink-soft' },
}

/**
 * 請求（月締め会計）。取引先×対象期間で請求書を作成・一覧する。
 * 納品書（出荷ごとの伝票）とは用途が異なるため別メニュー（/admin/delivery-notes）。
 */
export default async function InvoicesPage() {
  const guard = await requireAdmin('請求は管理者のみです。')
  if (guard) return guard

  const supabase = createAdminClient()
  const [{ data: invoices, error }, { count: pendingCount }, shippedRes] = await Promise.all([
    supabase
      .from('invoices')
      .select('id, invoice_number, customer_id, billing_month, total_amount, status, issue_date, due_date')
      .order('created_at', { ascending: false }),
    supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending_review'),
    // 出荷済み注文の明細（請求できる数量があるもの）。有効な請求書に載っていないものを「未請求」と数える
    supabase
      .from('order_items')
      .select('id, quantity, shipped_qty, billable_qty, orders!inner(status)')
      .eq('orders.status', 'shipped'),
  ])
  if (error) return <ErrorState message="請求書の一覧を読み込めませんでした。時間をおいて再度お試しください。" detail={error.message} />

  // 未請求の明細数は補助表示。失敗しても一覧は出し、件数は出さない（0件と誤表示しない）。
  let uninvoicedCount: number | null = null
  if (shippedRes.error) {
    console.error('[invoices] 出荷済み明細の取得に失敗:', shippedRes.error.message)
  } else {
    const billableIds = (shippedRes.data ?? [])
      .filter((r) => (Number(r.billable_qty ?? r.shipped_qty ?? r.quantity) || 0) > 0)
      .map((r) => r.id)
    const billed = await fetchBilledOrderItemIds(supabase, billableIds)
    if (billed.ok) uninvoicedCount = billableIds.filter((id) => !billed.ids.has(id)).length
    else console.error('[invoices] 請求済み明細の確認に失敗:', billed.message)
  }

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
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-warning bg-warning-bg px-3.5 py-2.5 text-sm text-ink">
          <div className="flex flex-col gap-1">
            {(pendingCount ?? 0) > 0 && (
              <span>
                未承認（確認待ち）の注文：<strong className="font-bold">{pendingCount}件</strong>
              </span>
            )}
            {(uninvoicedCount ?? 0) > 0 && (
              <span>
                出荷済みで、まだ請求書に載っていない明細：<strong className="font-bold">{uninvoicedCount}件</strong>
              </span>
            )}
          </div>
          {(pendingCount ?? 0) > 0 && (
            <Link
              href="/admin/approvals"
              className="inline-flex min-h-10 items-center whitespace-nowrap rounded-lg border border-warning bg-bg-card px-3 text-sm font-bold text-ink hover:bg-earth-50"
            >
              承認待ちを開く →
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
                <Card
                  variant="elevated"
                  interactive
                  className={`flex items-center justify-between gap-3 ${inv.status === 'void' ? 'opacity-60' : ''}`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <p className="num font-bold text-ink">{inv.invoice_number}</p>
                      <span className={`shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${s.cls}`}>
                        {s.label}
                      </span>
                      {rs === 'overdue' && (
                        <span className="shrink-0 whitespace-nowrap rounded-full bg-alert px-2 py-0.5 text-xs font-bold text-white">
                          期日超過
                        </span>
                      )}
                    </div>
                    <p className="truncate text-sm text-ink-soft" title={customerName.get(inv.customer_id) ?? undefined}>
                      {customerName.get(inv.customer_id) ?? '—'}・{formatJpMonth(inv.billing_month)}
                    </p>
                    {rs && due && (
                      <p className={`text-xs ${rs === 'overdue' ? 'font-bold text-alert' : 'text-ink-soft'}`}>
                        支払期日 {formatJpDateShort(due)}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span
                      className={`num whitespace-nowrap font-bold tabular-nums ${inv.status === 'void' ? 'text-ink-faint line-through' : 'text-ink'}`}
                    >
                      {formatYen(inv.total_amount)}
                    </span>
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
