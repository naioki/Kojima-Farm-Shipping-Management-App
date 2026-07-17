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
 * 行=取引先 × 列=日付(7日)。品目タブで1品目ずつ表示し横スクロールを抑える。
 * セル入力＋スマートパース＋空欄削除＋CSV出力は MatrixGrid（クライアント）が担う。
 */
export default async function MatrixPage({
  searchParams,
}: {
  searchParams: { week?: string; product?: string }
}) {
  const week = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.week ?? '') ? searchParams.week! : jstTodayStr()
  const dates = weekDates(week)
  const supabase = createClient()

  // 品目タブ・取引先（行）
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

  const selected = products.find((p) => p.id === searchParams.product) ?? products[0]!

  // 当該週の注文（出荷日 in dates）→ 明細（選択品目）を取得して (取引先|日付)→総数 に展開
  const { data: orders, error: ordersErr } = await supabase
    .from('orders')
    .select('id, customer_id, delivery_date')
    .in('delivery_date', dates)
  // 注文はマトリックスの本体。取得失敗を「空マトリックス」に化けさせない。
  if (ordersErr)
    return <ErrorState message="注文を読み込めませんでした。時間をおいて再度お試しください。" detail={ordersErr.message} />
  const orderIds = (orders ?? []).map((o) => o.id)
  const orderMeta = new Map((orders ?? []).map((o) => [o.id, o]))

  const itemsRes = orderIds.length
    ? await supabase
        .from('order_items')
        .select('order_id, quantity')
        .eq('product_id', selected.id)
        .in('order_id', orderIds)
    : { data: [] as { order_id: string; quantity: number }[], error: null }
  if (itemsRes.error)
    return <ErrorState message="注文明細を読み込めませんでした。時間をおいて再度お試しください。" detail={itemsRes.error.message} />
  const items = itemsRes.data ?? []

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

      {/* 品目タブ（横スクロール回避・features.md §7） */}
      <div className="flex flex-wrap gap-1.5">
        {products.map((p) => {
          const active = p.id === selected.id
          return (
            <Link
              key={p.id}
              href={`${PATH}?week=${week}&product=${p.id}`}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
                active
                  ? 'border-earth-400 bg-earth-100 text-earth-800'
                  : 'border-line text-ink-soft hover:bg-bg-soft',
              )}
            >
              {p.name}
            </Link>
          )
        })}
      </div>

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
