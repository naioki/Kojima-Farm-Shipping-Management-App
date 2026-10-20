import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { Card } from '@/components/ui/Card'
import { cn } from '@/lib/cn'
import { MatrixGrid } from '@/components/field/MatrixGrid'
import { FieldViewSwitch } from '@/components/field/FieldViewSwitch'
import { jstTodayStr, shiftDateStr } from '@/lib/dates'

export const dynamic = 'force-dynamic'

const PATH = '/field/matrix'
function weekDates(start: string): string[] {
  return Array.from({ length: 7 }, (_, i) => shiftDateStr(start, i))
}

/**
 * 週間マトリックス入力（Laravel版 画面3 / features.md §7-8）。
 * 行=取引先 × 列=日付(7日)。
 * 出荷実績・予定がある品目のみタブ表示し、余計な品目を省いて素早く把握・入力可能。
 */
export default async function MatrixPage({
  searchParams,
}: {
  searchParams: { week?: string; product?: string }
}) {
  const week = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.week ?? '') ? searchParams.week! : jstTodayStr()
  const dates = weekDates(week)
  const supabase = createClient()

  // 品目・取引先（行）
  const [{ data: products, error: prodErr }, { data: customers, error: custErr }] = await Promise.all([
    supabase.from('products').select('id, name, unit').eq('is_active', true).order('name'),
    supabase.from('customers').select('id, name').eq('is_active', true).order('name'),
  ])
  if (prodErr) return <ErrorState message={prodErr.message} />
  if (custErr) return <ErrorState message={custErr.message} />

  if (!products?.length) {
    return (
      <div className="mx-auto max-w-5xl space-y-4">
        <h1 className="font-display text-2xl font-bold text-ink">週間マトリックス</h1>
        <EmptyState title="商品が登録されていません" description="商品マスタを登録すると品目タブが表示されます。" />
      </div>
    )
  }

  // 当該週の注文（出荷日 in dates、キャンセル除外）
  const { data: orders, error: ordersErr } = await supabase
    .from('orders')
    .select('id, customer_id, delivery_date')
    .in('delivery_date', dates)
    .neq('status', 'cancelled')
  // 注文はマトリックスの本体。取得失敗を「空マトリックス」に化けさせない。
  if (ordersErr)
    return <ErrorState message="注文を読み込めませんでした。時間をおいて再度お試しください。" detail={ordersErr.message} />
  const orderIds = (orders ?? []).map((o) => o.id)
  const orderMeta = new Map((orders ?? []).map((o) => [o.id, o]))

  // 当該週の全品目明細を取得（出荷がある品目を自動判定）
  const allItemsRes = orderIds.length
    ? await supabase
        .from('order_items')
        .select('order_id, product_id, product_name, quantity')
        .in('order_id', orderIds)
    : { data: [] as { order_id: string; product_id: string | null; product_name: string | null; quantity: number }[], error: null }
  if (allItemsRes.error)
    return <ErrorState message="注文明細を読み込めませんでした。時間をおいて再度お試しください。" detail={allItemsRes.error.message} />
  const allWeekItems = allItemsRes.data ?? []

  const nameToProduct = new Map((products ?? []).map((p) => [p.name, p]))

  // 出荷実績（数量>0）がある品目ID一覧
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

  // 出荷がある品目のみを表示（URLで直接指定された品目があればそれも含める）
  const filteredProducts = products.filter(
    (p) => productIdsWithShipments.has(p.id) || p.id === searchParams.product,
  )

  // まだタブに表示されていない品目（「＋ 他の品目を追加」用）
  const otherProducts = products.filter((p) => !filteredProducts.some((fp) => fp.id === p.id))

  // 選択品目: 指定があればそれ、なければ出荷のある最初の品目、それもなければ全品目の先頭
  const selected =
    (searchParams.product ? products.find((p) => p.id === searchParams.product) : null) ??
    filteredProducts[0] ??
    products[0]!

  const items = allWeekItems.filter(
    (it) => it.product_id === selected.id || (!it.product_id && it.product_name === selected.name),
  )

  const initial: Record<string, number> = {}
  for (const it of items) {
    const o = orderMeta.get(it.order_id)
    if (o?.delivery_date) initial[`${o.customer_id}|${o.delivery_date}`] = it.quantity
  }

  // 選択品目の取引先別 P/C
  const { data: rules, error: rulesErr } = await supabase
    .from('customer_product_rules')
    .select('customer_id, packs_per_case')
    .eq('product_id', selected.id)
  // P/C は補助表示（端数計算の基準）。失敗しても本体は殺さず未設定扱いにする。
  if (rulesErr) console.error('[field/matrix] P/Cの読み込みに失敗:', rulesErr.message)
  const packsByCustomer: Record<string, number | null> = {}
  for (const r of rules ?? []) packsByCustomer[r.customer_id] = r.packs_per_case

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="font-display text-2xl font-bold text-ink">週間マトリックス</h1>
          <FieldViewSwitch active="week" date={week} />
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`${PATH}?week=${shiftDateStr(week, -7)}&product=${selected.id}`}
            className="h-10 rounded border border-line px-3 text-sm font-medium leading-10 text-ink-soft hover:bg-bg-soft"
          >
            ← 前週
          </Link>
          <Link
            href={`${PATH}?week=${jstTodayStr()}&product=${selected.id}`}
            className="h-10 rounded border border-line px-3 text-sm font-medium leading-10 text-ink-soft hover:bg-bg-soft"
          >
            今週
          </Link>
          <Link
            href={`${PATH}?week=${shiftDateStr(week, 7)}&product=${selected.id}`}
            className="h-10 rounded border border-line px-3 text-sm font-medium leading-10 text-ink-soft hover:bg-bg-soft"
          >
            翌週 →
          </Link>
        </div>
      </div>

      {/* 品目タブ（出荷がある品目のみ表示） */}
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
              {products.map((p) => (
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
          {/* key で品目・週ごとに再マウント。これがないとタブ/週を変えても
              MatrixGrid の入力 state が初回のまま据え置かれ、別品目に前の値が残る。 */}
          <MatrixGrid
            key={`${selected.id}:${week}`}
            productId={selected.id}
            productName={selected.name}
            productUnit={selected.unit}
            customers={customers.map((c) => ({ id: c.id, name: c.name }))}
            dates={dates}
            initial={initial}
            packsByCustomer={packsByCustomer}
          />
        </Card>
      )}
    </div>
  )
}
