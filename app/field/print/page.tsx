import Link from 'next/link'
import { FileDown, Truck, Building2 } from 'lucide-react'
import { PrintCustomerFilter } from '@/components/field/PrintCustomerFilter'
import { getAuthedUser } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { Card } from '@/components/ui/Card'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { DateNav } from '@/components/field/DateNav'
import { FieldViewSwitch } from '@/components/field/FieldViewSwitch'
import { jstTodayStr, shiftDateStr } from '@/lib/dates'
import { getStaffFeatures, canStaffUse } from '@/lib/field/features'
import {
  isDriverDeliveryNoteCustomer,
  resolveDefaultIssuerPreset,
  resolveIssuerCompanyName,
} from '@/lib/delivery-notes/driver-note'

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
  const driverNoteCustomers = customers.filter((c) => isDriverDeliveryNoteCustomer(c.name))

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
          {/* 🚚 運転手渡し納品書（勘兵衛・オレンジファーム等）1タップ印刷パネル */}
          {driverNoteCustomers.length > 0 && (
            <div className="rounded-2xl border-2 border-harvest-600/30 bg-harvest-50/70 p-4 space-y-3 shadow-2xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-harvest-700 text-white shadow-2xs">
                    <Truck className="h-4 w-4" aria-hidden />
                  </span>
                  <div>
                    <h2 className="font-display text-sm sm:text-base font-black text-forest-900">
                      運転手渡し納品書（A4上下2連：納品書＋控）
                    </h2>
                    <p className="text-xs text-forest-900/80">
                      金額なし・箱数明記 ／ オレンジファームはFAX記載着日で自動印字
                    </p>
                  </div>
                </div>
                {driverNoteCustomers.length > 1 && (
                  <a
                    href={`/api/delivery-notes/pdf?customers=${driverNoteCustomers.map((c) => c.id).join(',')}&date=${date}&amount=none&layout=2up`}
                    target="_blank"
                    rel="noopener"
                    className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl bg-harvest-700 px-3.5 py-2 text-xs sm:text-sm font-black text-white shadow-sm hover:bg-forest-800 transition active:scale-95"
                  >
                    <FileDown className="h-4 w-4 shrink-0" />
                    <span>対象{driverNoteCustomers.length}社をまとめてA4印刷</span>
                  </a>
                )}
              </div>

              <div className="grid grid-cols-1 gap-2">
                {driverNoteCustomers.map((c) => {
                  const defaultPreset = resolveDefaultIssuerPreset(c.name)
                  const defaultIssuerLabel = resolveIssuerCompanyName(defaultPreset, '小島農園')
                  const altPreset = defaultPreset === 'iplus' ? 'kojima' : 'iplus'
                  const altIssuerLabel = altPreset === 'iplus' ? 'アイプラス名義' : '小島農園名義'
                  return (
                    <div
                      key={c.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-harvest-400 bg-white px-3.5 py-2.5 shadow-2xs"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-black text-sm text-ink">{c.name}</span>
                          <span className="whitespace-nowrap inline-flex items-center gap-1 rounded-md bg-harvest-100 border border-harvest-400 px-2 py-0.5 text-xs font-bold text-forest-900">
                            <Building2 className="h-3 w-3" />
                            既定：{defaultIssuerLabel}
                          </span>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <a
                          href={`/api/delivery-notes/pdf?customer=${c.id}&date=${date}&amount=none&issuer=${defaultPreset}&layout=2up`}
                          target="_blank"
                          rel="noopener"
                          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-harvest-700 px-3 text-xs font-black text-white hover:bg-forest-800 shadow-2xs transition active:scale-95"
                        >
                          <FileDown className="h-3.5 w-3.5" />
                          <span>納品書PDF（{defaultPreset === 'iplus' ? 'アイプラス' : '小島農園'}）</span>
                        </a>
                        <a
                          href={`/api/delivery-notes/pdf?customer=${c.id}&date=${date}&amount=none&issuer=${altPreset}&layout=2up`}
                          target="_blank"
                          rel="noopener"
                          className="inline-flex h-9 items-center gap-1 rounded-lg border border-line-strong bg-bg-soft px-2.5 text-xs font-bold text-ink-soft hover:bg-earth-50 hover:text-ink transition"
                          title={`発行元名義を「${altIssuerLabel}」に切り替えてPDFを開きます`}
                        >
                          <span>{altIssuerLabel}で開く</span>
                        </a>
                        {role === 'admin' && (
                          <Link
                            href={`/admin/delivery-notes/view?customer=${c.id}&date=${date}&amount=none&issuer=${defaultPreset}&layout=2up`}
                            className="inline-flex h-9 items-center rounded-lg border border-line px-2.5 text-xs font-bold text-trust-600 hover:bg-bg-soft"
                          >
                            プレビュー
                          </Link>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

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
