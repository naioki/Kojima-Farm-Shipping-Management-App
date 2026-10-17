import { PrintCustomerFilter } from '@/components/field/PrintCustomerFilter'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { DateNav } from '@/components/field/DateNav'
import { jstTodayStr } from '@/lib/dates'
import { getStaffFeatures, canStaffUse } from '@/lib/field/features'

export const dynamic = 'force-dynamic'

const PATH = '/field/print'

/**
 * 現場向け 帳票印刷（フェーズ2A）。迷わないよう大ボタン2つだけを主動線にする。
 *   - 出荷表カード（コンテナ貼付・1明細1ページ）
 *   - 出荷ラベル（8分割・Cut and Stack・1ページ目に出荷一覧表）
 * 供給先は「取引先＞納入先」表記（例: ヨーク 東道野辺／寺崎）。
 * 品目をしぼった印刷は下の品目リストから（パック作業が品目単位のため）。
 * 解放は 設定 → 現場機能（STAFF_CAN_PRINT_DOCS）。admin は常に利用可。
 */
export default async function FieldPrintPage({
  searchParams,
}: {
  searchParams: { date?: string }
}) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.date ?? '') ? searchParams.date! : jstTodayStr()

  const user = await getAuthedUser()
  if (!user) return <ErrorState message="ログインが必要です" />
  const supabase = createClient()
  const { data: profile, error: profileErr } = await supabase.from('users').select('role').eq('id', user.id).maybeSingle()
  // ロール解決に失敗したら最小権限（staff）にフォールバック。無言にはしない。
  if (profileErr) console.error('[field/print] ロールの取得に失敗:', profileErr.message)
  const role = (profile?.role as 'admin' | 'staff') ?? 'staff'
  const features = await getStaffFeatures()
  if (!canStaffUse('printDocs', role, features)) {
    return <ErrorState message="帳票印刷は解放されていません（設定 → 現場機能の解放）" />
  }

  // この日の出荷対象の注文（品目別印刷・取引先しぼり込み用）
  const { data: orders, error: ordersErr } = await supabase
    .from('orders')
    .select('id, customer_id')
    .eq('delivery_date', date)
  if (ordersErr) return <ErrorState message={ordersErr.message} />
  const orderIds = (orders ?? []).map((o) => o.id)

  // この日に出荷がある取引先だけを列挙（取引先しぼり込みのチェックボックス用）。
  const customerIds = [...new Set((orders ?? []).map((o) => o.customer_id))]
  const { data: custRows, error: custErr } = customerIds.length
    ? await supabase.from('customers').select('id, name').in('id', customerIds).order('name')
    : { data: [], error: null }
  if (custErr) return <ErrorState message={custErr.message} />
  const customers = custRows ?? []
  const itemsRes = orderIds.length
    ? await supabase
        .from('order_items')
        .select('product_id, product_name')
        .in('order_id', orderIds)
        .order('product_name')
    : { data: [] as { product_id: string; product_name: string }[], error: null }
  // 品目一覧は印刷対象の絞り込みの本体。取得失敗を「品目なし」に化けさせない。
  if (itemsRes.error) return <ErrorState message="出荷品目を読み込めませんでした。時間をおいて再度お試しください。" detail={itemsRes.error.message} />
  const items = itemsRes.data ?? []
  const products = [...new Map(items.map((i) => [i.product_id, i.product_name])).entries()]

  // この日の印刷キュー状況（エージェントが拾ったかどうかを現場でも確認できるように）
  const { data: jobs, error: jobsErr } = await supabase
    .from('print_jobs')
    .select('id, doc_type, status, created_at')
    .eq('target_date', date)
    .order('created_at', { ascending: false })
    .limit(10)
  // キュー状況は補助表示。失敗しても本体（印刷ボタン）は殺さない。
  if (jobsErr) console.error('[field/print] 印刷キュー状況の取得に失敗:', jobsErr.message)

  const sheetHref = (product?: string) =>
    `/api/shipping-docs/sheet?date=${date}${product ? `&product=${product}` : ''}`
  const labelsHref = (product?: string) =>
    `/api/shipping-docs/labels?date=${date}${product ? `&product=${product}` : ''}`

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-bold text-ink">帳票を 印刷</h1>
        <DateNav date={date} basePath={PATH} />
      </div>

      {products.length === 0 ? (
        <EmptyState
          title="この日の出荷対象はありません"
          description="出荷一覧に注文が入ると、ここから出荷表とラベルを印刷できます。"
        />
      ) : (
        <>
          {/* 主動線: 取引先しぼり込み ＋ 大ボタン2つ ＋ 自動印刷（Issue#7） */}
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

          {/* 品目をしぼって印刷（パック作業は品目単位で進むため） */}
          <Card className="space-y-2">
            <h2 className="font-display text-base font-bold text-ink">品目だけ えらんで 印刷</h2>
            <ul className="divide-y divide-line">
              {products.map(([id, name]) => (
                <li key={id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="text-sm font-medium text-ink">{name}</span>
                  <span className="flex gap-2">
                    <a
                      href={sheetHref(id)}
                      target="_blank"
                      rel="noopener"
                      className="rounded border border-line px-3 py-1.5 text-sm text-ink-soft hover:bg-bg-soft"
                    >
                      出荷表
                    </a>
                    <a
                      href={labelsHref(id)}
                      target="_blank"
                      rel="noopener"
                      className="rounded border border-line px-3 py-1.5 text-sm text-ink-soft hover:bg-bg-soft"
                    >
                      ラベル
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
