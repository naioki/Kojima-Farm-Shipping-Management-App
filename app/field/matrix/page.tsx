import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getAuthedUser } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { Card } from '@/components/ui/Card'
import { cn } from '@/lib/cn'
import { MatrixGrid, type MatrixDestinationItem } from '@/components/field/MatrixGrid'
import { FieldViewSwitch } from '@/components/field/FieldViewSwitch'
import { jstTodayStr, shiftDateStr } from '@/lib/dates'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const fetchCache = 'force-no-store'

const PATH = '/field/matrix'
function weekDates(start: string): string[] {
  return Array.from({ length: 7 }, (_, i) => shiftDateStr(start, i))
}

/**
 * 週の管理（週間出荷マトリックス）。
 * - #24: 取引先ごとの全体イメージ行 ＋ 1タップで納入先別内訳サブ行（4関東・5北海道・6関西、各センターなど）を折りたたみ展開＆個別編集。
 * - #26: 「📦 箱数表示 ⇄ 🥬 パック数表示」のワンタップ切替対応。
 * - #27: 日付ヘッダー1タップでその日の「収穫・パックボード」へ移動。
 * - #28: ?week= だけでなく ?date= パラメータも受け取り、見ていた日付を含む週間表をシームレスに表示。
 */
export default async function MatrixPage({
  searchParams,
}: {
  searchParams: { week?: string; date?: string; product?: string }
}) {
  const user = await getAuthedUser()
  if (!user) redirect('/login')

  const rawWeekOrDate = searchParams.week ?? searchParams.date ?? ''
  const week = /^\d{4}-\d{2}-\d{2}$/.test(rawWeekOrDate) ? rawWeekOrDate : jstTodayStr()
  const dates = weekDates(week)
  const supabase = createAdminClient()

  // 品目・取引先・納入先マスタを並列取得
  const [
    { data: products, error: prodErr },
    { data: customers, error: custErr },
    { data: destinations },
  ] = await Promise.all([
    supabase.from('products').select('id, name, unit, category, container_capacity').eq('is_active', true).order('name'),
    supabase.from('customers').select('id, name').eq('is_active', true).order('name'),
    supabase
      .from('delivery_destinations')
      .select('id, customer_id, code, full_name, sort_order')
      .eq('is_active', true)
      .order('sort_order'),
  ])
  if (prodErr) return <ErrorState message={prodErr.message} />
  if (custErr) return <ErrorState message={custErr.message} />

  if (!products?.length) {
    return (
      <div className="mx-auto max-w-5xl space-y-4">
        <h1 className="font-display text-2xl font-bold text-ink">週の管理（週間マトリックス）</h1>
        <EmptyState title="商品が登録されていません" description="商品マスタを登録すると品目タブが表示されます。" />
      </div>
    )
  }

  // 当該週の承認済み注文（destination_id も取得して納入先別内訳に対応する #24, #25）
  const { data: orders, error: ordersErr } = await supabase
    .from('orders')
    .select('id, customer_id, destination_id, delivery_date')
    .in('delivery_date', dates)
    .in('status', ['approved', 'shipped', 'invoiced'])
  if (ordersErr)
    return <ErrorState message="注文を読み込めませんでした。時間をおいて再度お試しください。" detail={ordersErr.message} />
  const orderIds = (orders ?? []).map((o) => o.id)
  const orderMeta = new Map((orders ?? []).map((o) => [o.id, o]))

  // 当該週の全品目明細を取得
  const allItemsRes = orderIds.length
    ? await supabase
        .from('order_items')
        .select('order_id, product_id, product_name, quantity')
        .in('order_id', orderIds)
    : { data: [] as { order_id: string; product_id: string | null; product_name: string | null; quantity: number }[], error: null }
  if (allItemsRes.error)
    return <ErrorState message="注文明細を読み込めませんでした。時間をおいて再度お試しください。" detail={allItemsRes.error.message} />
  const allWeekItems = allItemsRes.data ?? []

  const nonMaterialProducts = products.filter((p) => p.category !== '資材')
  const nameToProduct = new Map(products.map((p) => [p.name, p]))

  const productIdsWithShipments = new Set<string>()
  for (const it of allWeekItems) {
    if (Number(it.quantity) > 0) {
      if (it.product_id) {
        productIdsWithShipments.add(it.product_id)
      } else if (it.product_name) {
        const p = nameToProduct.get(it.product_name)
        if (p) productIdsWithShipments.add(p.id)
      }
    }
  }

  const filteredProducts = nonMaterialProducts.filter(
    (p) => productIdsWithShipments.has(p.id) || p.id === searchParams.product,
  )

  const selected =
    (searchParams.product ? products.find((p) => p.id === searchParams.product) : null) ??
    filteredProducts[0] ??
    nonMaterialProducts[0] ??
    products[0]!

  const items = allWeekItems.filter(
    (it) =>
      it.product_id === selected.id ||
      (!it.product_id && it.product_name === selected.name) ||
      (!it.product_id &&
        ((it.product_name?.includes('チンゲン') && selected.name.includes('青梗菜')) ||
          (it.product_name?.includes('青梗菜') && selected.name.includes('チンゲン')))),
  )

  // 親（取引先合計）と 子（納入先別内訳）の両方の初期値を集計
  const initial: Record<string, number> = {}
  const initialByDest: Record<string, number> = {}
  for (const it of items) {
    const qty = Number(it.quantity) || 0
    if (qty <= 0) continue
    const o = orderMeta.get(it.order_id)
    if (o?.delivery_date) {
      const cellKey = `${o.customer_id}|${o.delivery_date}`
      initial[cellKey] = (initial[cellKey] ?? 0) + qty
      const destKey = `${o.customer_id}|${o.destination_id ?? '__direct__'}|${o.delivery_date}`
      initialByDest[destKey] = (initialByDest[destKey] ?? 0) + qty
    }
  }

  // 選択品目の取引先別 P/C
  const { data: rules, error: rulesErr } = await supabase
    .from('customer_product_rules')
    .select('customer_id, packs_per_case')
    .eq('product_id', selected.id)
  if (rulesErr) console.error('[field/matrix] P/Cの読み込みに失敗:', rulesErr.message)
  const packsByCustomer: Record<string, number | null> = {}
  for (const r of rules ?? []) packsByCustomer[r.customer_id] = r.packs_per_case
  for (const c of customers ?? []) {
    if (!packsByCustomer[c.id]) {
      if (c.name.includes('農業総合研究所') || c.name.toUpperCase().includes('NSK')) {
        packsByCustomer[c.id] = 24
      } else {
        packsByCustomer[c.id] = selected.container_capacity ?? 20
      }
    }
  }

  const destinationsByCustomer: Record<string, MatrixDestinationItem[]> = {}
  for (const d of destinations ?? []) {
    if (!d.customer_id) continue
    const list = destinationsByCustomer[d.customer_id] ?? []
    list.push({
      id: d.id,
      customerId: d.customer_id,
      label: d.code?.trim() || d.full_name,
    })
    destinationsByCustomer[d.customer_id] = list
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 pb-20">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 flex-wrap">
          <h1 className="hidden sm:block font-display text-lg sm:text-xl font-black text-ink">週の管理</h1>
          <FieldViewSwitch active="week" date={week} product={selected.id} />
        </div>
        <div className="flex items-center gap-1.5">
          <Link
            href={`${PATH}?week=${shiftDateStr(week, -7)}&product=${selected.id}`}
            className="h-10 rounded-xl border border-line bg-white px-3 text-xs sm:text-sm font-bold leading-10 text-ink-soft hover:bg-bg-soft"
          >
            ← 前週
          </Link>
          <Link
            href={`${PATH}?week=${jstTodayStr()}&product=${selected.id}`}
            className="h-10 rounded-xl border border-forest-300 bg-forest-50 px-3 text-xs sm:text-sm font-black leading-10 text-forest-900 hover:bg-forest-100"
          >
            今日〜1週間
          </Link>
          <Link
            href={`${PATH}?week=${shiftDateStr(week, 7)}&product=${selected.id}`}
            className="h-10 rounded-xl border border-line bg-white px-3 text-xs sm:text-sm font-bold leading-10 text-ink-soft hover:bg-bg-soft"
          >
            翌週 →
          </Link>
        </div>
      </div>

      {/* 品目タブ */}
      {filteredProducts.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          {filteredProducts.map((p) => {
            const active = p.id === selected.id
            return (
              <Link
                key={p.id}
                href={`${PATH}?week=${week}&product=${p.id}`}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'rounded-full border px-4 py-2 text-sm font-black transition-all flex items-center gap-2',
                  active
                    ? 'border-forest-600 bg-forest-600 text-white shadow-sm'
                    : 'border-line bg-white text-ink-soft hover:bg-bg-soft hover:text-ink',
                )}
              >
                <span>{p.name}</span>
              </Link>
            )
          })}
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-bg-soft p-3">
          <span className="text-xs font-medium text-ink-muted">
            この週（{dates[0]} 〜 {dates[6]}）に出荷実績・予定のある品目はありません。
          </span>
          <form method="get" action={PATH} className="flex items-center gap-1">
            <input type="hidden" name="week" value={week} />
            <select
              name="product"
              onChange={(e) => {
                if (e.target.value) e.target.form?.submit()
              }}
              defaultValue=""
              className="h-8 rounded-lg border border-line bg-white px-2.5 text-xs font-semibold text-ink hover:bg-bg-card focus:outline-none"
            >
              <option value="" disabled>
                品目を選択して予定を入力...
              </option>
              {nonMaterialProducts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </form>
        </div>
      )}

      {!customers?.length ? (
        <EmptyState title="取引先が登録されていません" description="取引先設定で登録すると行が表示されます。" />
      ) : (
        <Card>
          <MatrixGrid
            key={`${selected.id}:${week}`}
            productId={selected.id}
            productName={selected.name}
            productUnit={selected.unit}
            customers={customers.map((c) => ({ id: c.id, name: c.name }))}
            destinationsByCustomer={destinationsByCustomer}
            dates={dates}
            initial={initial}
            initialByDest={initialByDest}
            packsByCustomer={packsByCustomer}
          />
        </Card>
      )}
    </div>
  )
}
