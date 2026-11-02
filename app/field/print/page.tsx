import { PrintCustomerFilter } from '@/components/field/PrintCustomerFilter'
import { getAuthedUser } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { Card } from '@/components/ui/Card'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { DateNav } from '@/components/field/DateNav'
import { FieldViewSwitch } from '@/components/field/FieldViewSwitch'
import { jstTodayStr, shiftDateStr } from '@/lib/dates'
import { getStaffFeatures, canStaffUse } from '@/lib/field/features'

export const dynamic = 'force-dynamic'

const PATH = '/field/print'

/**
 * 現場向け 帳票印刷。
 * - #29: デフォルト日付を収穫・パックボードや積込リストと完全統一（明日納品分＝本日パック作業分）。
 * - #30: キャンセル済（cancelled）や承認前（pending_review）、数量0の明細を厳密に除外。
 */
export default async function FieldPrintPage({
  searchParams,
}: {
  searchParams: { date?: string; product?: string }
}) {
  const defaultDate = shiftDateStr(jstTodayStr(), 1)
  const date = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.date ?? '') ? searchParams.date! : defaultDate
  const selectedProduct = searchParams.product ?? null

  const user = await getAuthedUser()
  if (!user) return <ErrorState message="ログインが必要です" />
  const supabase = createAdminClient()
  const { data: profile, error: profileErr } = await supabase.from('users').select('role').eq('id', user.id).maybeSingle()
  if (profileErr) console.error('[field/print] ロールの取得に失敗:', profileErr.message)
  const role = (profile?.role as 'admin' | 'staff') ?? 'staff'
  const features = await getStaffFeatures()
  if (!canStaffUse('printDocs', role, features)) {
    return <ErrorState message="帳票印刷は解放されていません（設定 → 現場機能の解放）" />
  }

  // #30 有効な確定注文（approved / shipped / invoiced）のみ抽出
  const { data: orders, error: ordersErr } = await supabase
    .from('orders')
    .select('id, customer_id')
    .eq('delivery_date', date)
    .in('status', ['approved', 'shipped', 'invoiced'])
  if (ordersErr) return <ErrorState message={ordersErr.message} />
  const orderIds = (orders ?? []).map((o) => o.id)

  // #30 数量 > 0 の明細のみ対象
  const itemsRes = orderIds.length
    ? await supabase
        .from('order_items')
        .select('order_id, product_id, product_name, quantity')
        .in('order_id', orderIds)
        .gt('quantity', 0)
        .order('product_name')
    : { data: [] as { order_id: string; product_id: string; product_name: string; quantity: number }[], error: null }
  if (itemsRes.error) return <ErrorState message="出荷品目を読み込めませんでした。時間をおいて再度お試しください。" detail={itemsRes.error.message} />
  const items = itemsRes.data ?? []

  // 有効な明細が存在する注文の取引先のみ列挙
  const activeOrderIds = new Set(items.map((i) => i.order_id))
  const customerIds = [...new Set((orders ?? []).filter((o) => activeOrderIds.has(o.id)).map((o) => o.customer_id))]
  const { data: custRows, error: custErr } = customerIds.length
    ? await supabase.from('customers').select('id, name').in('id', customerIds).order('name')
    : { data: [], error: null }
  if (custErr) return <ErrorState message={custErr.message} />
  const customers = custRows ?? []

  const products = [...new Map(items.map((i) => [i.product_id, i.product_name])).entries()]

  const { data: jobs, error: jobsErr } = await supabase
    .from('print_jobs')
    .select('id, doc_type, status, created_at')
    .eq('target_date', date)
    .order('created_at', { ascending: false })
    .limit(10)
  if (jobsErr) console.error('[field/print] 印刷キュー状況の取得に失敗:', jobsErr.message)

  const sheetHref = (product?: string) =>
    `/api/shipping-docs/sheet?date=${date}${product ? `&product=${product}` : ''}`
  const labelsHref = (product?: string) =>
    `/api/shipping-docs/labels?date=${date}${product ? `&product=${product}` : ''}`

  return (
    <div className="mx-auto max-w-2xl space-y-4 pb-20">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="hidden sm:block font-display text-lg sm:text-xl font-black text-ink">帳票・ラベル印刷</h1>
          <FieldViewSwitch active="day" date={date} product={selectedProduct} />
        </div>
        <DateNav date={date} basePath={PATH} defaultDate={defaultDate} defaultLabel="明日納品（本日作業）" product={selectedProduct} />
      </div>

      {products.length === 0 ? (
        <EmptyState
          title="この日の出荷対象はありません"
          description="承認済みの出荷注文が入ると、ここから出荷表とラベルを印刷できます。"
        />
      ) : (
        <>
          <PrintCustomerFilter date={date} customers={customers} />

          {(jobs ?? []).length > 0 && (
            <Card className="space-y-1">
              <h2 className="font-display text-sm font-bold text-ink">きょうの 印刷キュー</h2>
              <ul className="divide-y divide-line text-sm">
                {(jobs ?? []).map((j) => (
                  <li key={j.id} className="flex items-center justify-between py-1.5">
                    <span className="text-ink">{j.doc_type === 'sheet' ? '出荷表' : 'ラベル'}</span>
                    <span
                      className={
                        j.status === 'printed'
                          ? 'text-harvest-500 font-medium'
                          : j.status === 'failed'
                            ? 'text-alert font-medium'
                            : 'text-ink-soft'
                      }
                    >
                      {j.status === 'pending' && 'じゅんばん待ち'}
                      {j.status === 'processing' && '印刷中…'}
                      {j.status === 'printed' && '印刷ずみ'}
                      {j.status === 'failed' && 'しっぱい（管理者に連絡）'}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card className="space-y-2">
            <h2 className="font-display text-base font-bold text-ink">品目だけ えらんで 印刷</h2>
            <ul className="divide-y divide-line">
              {products.map(([id, name]) => (
                <li key={id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="text-sm font-bold text-ink">{name}</span>
                  <span className="flex gap-2">
                    <a
                      href={sheetHref(id)}
                      target="_blank"
                      rel="noopener"
                      className="rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-bold text-ink hover:bg-bg-soft"
                    >
                      出荷表 PDF
                    </a>
                    <a
                      href={labelsHref(id)}
                      target="_blank"
                      rel="noopener"
                      className="rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-bold text-ink hover:bg-bg-soft"
                    >
                      ラベル PDF
                    </a>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </div>
  )
}
