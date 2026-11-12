import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { Card } from '@/components/ui/Card'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { LoadWarning } from '@/components/ui/LoadWarning'
import { GenerateInvoiceForm } from '@/components/admin/GenerateInvoiceForm'
import { InvoiceCsvExport } from '@/components/admin/InvoiceCsvExport'
import { formatYen } from '@/lib/calculations/tax'
import { formatJpMonth, formatJpDateShort, jstTodayStr } from '@/lib/dates'
import { dueDateOf, receivableState, summarizeReceivablesWithUndetermined } from '@/lib/invoices/receivables'
import { fetchBilledOrderItemIds } from '@/lib/invoices/generate'
import { paymentScheduleOf } from '@/lib/customers/settings'
import type { PaymentSchedule } from '@/lib/customers/payment-terms'
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
  const [{ data: invoices, error }, { count: pendingCount, error: pendingErr }, shippedRes] = await Promise.all([
    supabase
      .from('invoices')
      .select('id, invoice_number, customer_id, billing_month, period_end, total_amount, status, issue_date, due_date')
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

  // 未承認件数は補助表示。失敗しても一覧は出す（無言にはしない）。
  if (pendingErr) console.error('[invoices] 未承認件数の取得に失敗:', pendingErr.message)

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
    ? await supabase.from('customers').select('id, name, channel_identifiers').in('id', customerIds)
    : { data: [] as { id: string; name: string; channel_identifiers: unknown }[], error: null }
  // 取引先の解決は補助（名前・支払条件）。失敗しても一覧は出すが、既定の支払条件で期日超過を判定しない
  // （取引先ごとの支払条件と違う期日で「期日超過」と出すと、督促の誤りにつながる）。
  // 請求書に due_date があればそれで判定し、無い請求書は「判定できない」として警告帯で示す。
  if (custErr) console.error('[invoices] 取引先名の解決に失敗:', custErr.message)
  const termsUnavailable = Boolean(custErr)
  const customerName = new Map((custRows ?? []).map((c) => [c.id, c.name]))
  const termsByCustomer = new Map<string, PaymentSchedule>(
    (custRows ?? []).map((c) => [c.id, paymentScheduleOf(c.channel_identifiers)]),
  )
  const termsOf = (inv: { customer_id: string }) => termsByCustomer.get(inv.customer_id)
  const today = jstTodayStr()
  const ar = summarizeReceivablesWithUndetermined(invoices ?? [], today, termsOf, termsUnavailable)

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="font-display text-2xl font-bold text-ink">請求</h1>

      {custErr && (
        <LoadWarning
          message={
            ar.undeterminedCount > 0
              ? `取引先（名前・支払条件）を読み込めませんでした。支払期日の入っていない請求書${ar.undeterminedCount}件（${formatYen(ar.undeterminedAmount)}）は期日超過かどうか判定できないため、「支払期日超過」の合計に含めていません。時間をおいて再読み込みしてください。`
              : '取引先（名前・支払条件）を読み込めませんでした。請求書の一覧は表示できますが、取引先名が「—」になっています。時間をおいて再読み込みしてください。'
          }
          detail={`customers: ${custErr.message}`}
        />
      )}

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

      {/* 売掛金（入金待ち・期日超過）。期日は請求書の支払期日、無ければ取引先の支払条件から */}
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
          <p className="text-xs text-ink-faint">
            {ar.overdueCount}件（取引先の支払条件で判定）
            {ar.undeterminedCount > 0 && <span className="block font-bold text-ink-soft">ほか判定できない {ar.undeterminedCount}件</span>}
          </p>
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
            // 支払条件が読めず due_date も無い請求書は期日を判定しない（既定条件で「期日超過」と出さない）
            const undetermined = termsUnavailable && !inv.due_date
            const rs = undetermined ? null : receivableState(inv, today, termsOf(inv))
            const due = undetermined ? null : dueDateOf(inv, termsOf(inv))
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
                    {undetermined && (inv.status === 'finalized' || inv.status === 'sent') && (
                      <p className="text-xs text-ink-soft">支払期日 判定できません（取引先の支払条件を読み込めませんでした）</p>
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
