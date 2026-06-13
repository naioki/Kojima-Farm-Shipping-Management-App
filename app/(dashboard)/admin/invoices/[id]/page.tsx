import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { ErrorState } from '@/components/ui/States'
import { InvoiceActions } from '@/components/admin/InvoiceActions'
import { getSetting } from '@/lib/settings'
import { formatYen } from '@/lib/calculations/tax'
import type { InvoiceStatus } from '@/types/database'

export const dynamic = 'force-dynamic'

const STATUS_JP: Record<InvoiceStatus, string> = {
  draft: '下書き',
  finalized: '確定',
  sent: '送付済',
  paid: '入金済',
  void: '無効',
}

/**
 * 請求書 詳細（印刷可能・インボイス制度対応）。
 * 発行者（自社）情報は設定（FARM_*）から、税率別合計は invoices の保持値から表示。
 * ブラウザ印刷で PDF 保存できる（サイドバー等は print:hidden）。
 */
export default async function InvoiceDetailPage({ params }: { params: { id: string } }) {
  const supabase = createClient()

  const { data: invoice, error } = await supabase
    .from('invoices')
    .select('*')
    .eq('id', params.id)
    .maybeSingle()
  if (error) return <ErrorState message={error.message} />
  if (!invoice) return <ErrorState title="請求書が見つかりません" message="削除されたか、IDが不正です。" />

  const [{ data: items }, { data: customer }, farmName, farmReg, farmAddr, farmTel, farmPay] =
    await Promise.all([
      supabase
        .from('invoice_items')
        .select('product_name, quantity, unit, unit_price, tax_rate, subtotal, tax_amount, line_total')
        .eq('invoice_id', params.id),
      supabase.from('customers').select('name, payment_terms').eq('id', invoice.customer_id).maybeSingle(),
      getSetting('FARM_NAME'),
      getSetting('FARM_INVOICE_REG_NUM'),
      getSetting('FARM_ADDRESS'),
      getSetting('FARM_TEL'),
      getSetting('FARM_PAYMENT_INFO'),
    ])

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between gap-3 print:hidden">
        <Link href="/admin/invoices" className="inline-flex items-center gap-1 text-sm text-trust-600 hover:underline">
          <ChevronLeft className="h-4 w-4" aria-hidden />
          請求一覧
        </Link>
        <InvoiceActions invoiceId={invoice.id} status={invoice.status as InvoiceStatus} />
      </div>

      {/* 印刷対象（書類本体） */}
      <article className="space-y-6 rounded-lg border border-line bg-bg-card p-8 print:border-0 print:p-0">
        <header className="flex items-start justify-between">
          <div>
            <h1 className="font-display text-2xl font-bold text-ink">請求書</h1>
            <p className="mt-1 text-sm text-ink-soft">
              ステータス: {STATUS_JP[invoice.status as InvoiceStatus]}
            </p>
          </div>
          <div className="text-right text-sm">
            <p className="num font-bold text-ink">{invoice.invoice_number}</p>
            {invoice.issue_date && <p className="text-ink-soft">発行日: {invoice.issue_date}</p>}
            <p className="text-ink-soft">
              {invoice.period_start && invoice.period_end
                ? `対象期間: ${invoice.period_start} 〜 ${invoice.period_end}`
                : `対象月: ${invoice.billing_month}`}
            </p>
          </div>
        </header>

        <div className="flex items-end justify-between gap-6">
          <div>
            <p className="border-b border-ink pb-1 text-lg font-bold text-ink">{customer?.name ?? '—'} 御中</p>
            {customer?.payment_terms && (
              <p className="mt-2 text-sm text-ink-soft">お支払条件: {customer.payment_terms}</p>
            )}
          </div>
          <div className="text-right text-sm text-ink-soft">
            <p className="font-bold text-ink">{farmName ?? '小島農園'}</p>
            {farmReg && <p>登録番号: {farmReg}</p>}
            {farmAddr && <p>{farmAddr}</p>}
            {farmTel && <p>TEL: {farmTel}</p>}
          </div>
        </div>

        <div className="rounded bg-bg-soft px-4 py-3 print:bg-transparent">
          <p className="text-sm text-ink-soft">ご請求金額（税込）</p>
          <p className="num text-3xl font-bold tabular-nums text-earth-700">{formatYen(invoice.total_amount)}</p>
        </div>

        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line-strong text-left text-ink-soft">
              <th className="py-2 font-medium">品目</th>
              <th className="num py-2 text-right font-medium">数量</th>
              <th className="num py-2 text-right font-medium">単価</th>
              <th className="num py-2 text-right font-medium">税抜金額</th>
              <th className="py-2 text-center font-medium">税率</th>
            </tr>
          </thead>
          <tbody>
            {(items ?? []).map((it, i) => (
              <tr key={i} className="border-b border-line">
                <td className="py-1.5 text-ink">{it.product_name}</td>
                <td className="num py-1.5 text-right tabular-nums text-ink">
                  {it.quantity}
                  <span className="ml-0.5 text-xs text-ink-faint">{it.unit}</span>
                </td>
                <td className="num py-1.5 text-right tabular-nums text-ink-soft">{formatYen(it.unit_price)}</td>
                <td className="num py-1.5 text-right tabular-nums text-ink">{formatYen(it.subtotal)}</td>
                <td className="py-1.5 text-center text-ink-soft">
                  {it.tax_rate}%{it.tax_rate === 8 ? ' ※' : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* 税率別合計（インボイス制度・tax.md） */}
        <div className="ml-auto w-full max-w-xs space-y-1 text-sm">
          <Row label="8%対象 税抜" value={formatYen(invoice.subtotal_8)} />
          <Row label="消費税 8%" value={formatYen(invoice.tax_8)} />
          <Row label="10%対象 税抜" value={formatYen(invoice.subtotal_10)} />
          <Row label="消費税 10%" value={formatYen(invoice.tax_10)} />
          <div className="mt-1 border-t border-ink pt-1">
            <Row label="合計（税込）" value={formatYen(invoice.total_amount)} strong />
          </div>
        </div>

        <div className="border-t border-line pt-3 text-sm text-ink-soft">
          <p className="font-medium text-ink">お振込先</p>
          <p className="whitespace-pre-wrap">{farmPay ?? '（設定 → 発行者情報 で振込先を登録してください）'}</p>
        </div>
        <p className="text-xs text-ink-faint">※ は軽減税率（8%）対象品目です。</p>
      </article>
    </div>
  )
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className={strong ? 'font-bold text-ink' : 'text-ink-soft'}>{label}</span>
      <span className={`num tabular-nums ${strong ? 'text-lg font-bold text-ink' : 'text-ink'}`}>{value}</span>
    </div>
  )
}
