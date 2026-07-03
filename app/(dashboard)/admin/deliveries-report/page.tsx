import { BarChart3 } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { requireAdmin } from '@/lib/auth/require-admin'
import { jstTodayStr } from '@/lib/dates'
import type { DeliveryStatus } from '@/types/database'

export const dynamic = 'force-dynamic'

const PATH = '/admin/deliveries-report'
const dateRe = /^\d{4}-\d{2}-\d{2}$/

interface DestStat {
  label: string
  total: number
  delivered: number
  checked: number
  /** チェック→納品完了の平均分（両方記録がある配送のみ） */
  avgLeadMin: number | null
  /** もどす回数（誤タップ・やり直しのヒヤリハット指標） */
  reverts: number
}

/**
 * 配送実績（配送 Phase 2 最小版）。並行運用初日から動く運用サマリー：
 * 配送先別の件数・完了率・チェック→納品リードタイム・もどす回数。
 * 本格分析（クレーム傾向・納入先別の曜日パターン等）はデータ6ヶ月蓄積後に拡張する
 * （設計提案の方針。先に器だけ大きくしない）。
 */
export default async function DeliveriesReportPage({
  searchParams,
}: {
  searchParams: { from?: string; to?: string }
}) {
  const guard = await requireAdmin('配送実績は管理者のみです。')
  if (guard) return guard

  const today = jstTodayStr()
  const monthStart = `${today.slice(0, 7)}-01`
  const from = dateRe.test(searchParams.from ?? '') ? searchParams.from! : monthStart
  const to = dateRe.test(searchParams.to ?? '') ? searchParams.to! : today
  const supabase = createClient()

  const { data: rows, error } = await supabase
    .from('deliveries')
    .select('id, customer_id, destination_id, status, checked_at, delivered_at')
    .gte('delivery_date', from)
    .lte('delivery_date', to)
  if (error) return <ErrorState message={error.message} />

  const deliveries = rows ?? []
  const deliveryIds = deliveries.map((d) => d.id)

  // 表示名（取引先＞納入先）と revert イベント数
  const customerIds = [...new Set(deliveries.map((d) => d.customer_id))]
  const destinationIds = [...new Set(deliveries.map((d) => d.destination_id).filter(Boolean))] as string[]
  const [{ data: custRows }, { data: destRows }, { data: revertRows }] = await Promise.all([
    customerIds.length
      ? supabase.from('customers').select('id, name').in('id', customerIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    destinationIds.length
      ? supabase.from('delivery_destinations').select('id, code, full_name').in('id', destinationIds)
      : Promise.resolve({ data: [] as { id: string; code: string | null; full_name: string }[] }),
    deliveryIds.length
      ? supabase.from('delivery_events').select('delivery_id').eq('action', 'revert').in('delivery_id', deliveryIds)
      : Promise.resolve({ data: [] as { delivery_id: string }[] }),
  ])
  const customerName = new Map((custRows ?? []).map((c) => [c.id, c.name]))
  const destinationName = new Map((destRows ?? []).map((d) => [d.id, d.code || d.full_name]))
  const revertsByDelivery = new Map<string, number>()
  for (const r of revertRows ?? []) {
    revertsByDelivery.set(r.delivery_id, (revertsByDelivery.get(r.delivery_id) ?? 0) + 1)
  }

  // 配送先（取引先＞納入先）単位に集計
  const stats = new Map<string, DestStat & { leadSumMin: number; leadCount: number }>()
  for (const d of deliveries) {
    const key = `${d.customer_id}:${d.destination_id ?? ''}`
    let s = stats.get(key)
    if (!s) {
      const dest = d.destination_id ? destinationName.get(d.destination_id) : null
      s = {
        label: `${customerName.get(d.customer_id) ?? '—'}${dest ? `＞${dest}` : ''}`,
        total: 0,
        delivered: 0,
        checked: 0,
        avgLeadMin: null,
        reverts: 0,
        leadSumMin: 0,
        leadCount: 0,
      }
      stats.set(key, s)
    }
    s.total++
    const status = d.status as DeliveryStatus
    if (status === 'delivered') s.delivered++
    if (d.checked_at) s.checked++
    if (d.checked_at && d.delivered_at) {
      s.leadSumMin += (new Date(d.delivered_at).getTime() - new Date(d.checked_at).getTime()) / 60_000
      s.leadCount++
    }
    s.reverts += revertsByDelivery.get(d.id) ?? 0
  }
  const list = [...stats.values()]
    .map((s) => ({ ...s, avgLeadMin: s.leadCount > 0 ? Math.round(s.leadSumMin / s.leadCount) : null }))
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label, 'ja'))
  const totals = {
    total: deliveries.length,
    delivered: deliveries.filter((d) => d.status === 'delivered').length,
    reverts: [...revertsByDelivery.values()].reduce((a, b) => a + b, 0),
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 font-display text-2xl font-bold text-ink">
          <BarChart3 className="h-6 w-6 text-earth-600" aria-hidden />
          配送実績
        </h1>
        {/* 期間指定（GETフォーム。既定は今月1日〜今日） */}
        <form action={PATH} className="flex items-center gap-2 text-sm">
          <input
            type="date"
            name="from"
            defaultValue={from}
            aria-label="開始日"
            className="num h-10 rounded border border-line-strong bg-bg-card px-3 text-sm text-ink focus:border-trust-500 focus:outline-none focus:ring-2 focus:ring-trust-100"
          />
          <span className="text-ink-soft">〜</span>
          <input
            type="date"
            name="to"
            defaultValue={to}
            aria-label="終了日"
            className="num h-10 rounded border border-line-strong bg-bg-card px-3 text-sm text-ink focus:border-trust-500 focus:outline-none focus:ring-2 focus:ring-trust-100"
          />
          <button
            type="submit"
            className="h-10 rounded border border-line px-3 text-sm font-medium text-ink-soft hover:bg-bg-soft"
          >
            表示
          </button>
        </form>
      </div>

      {list.length === 0 ? (
        <EmptyState
          title="この期間の配送記録はありません"
          description="配送リストで「積込OK」「納品完了」を記録すると、ここに実績が集計されます。"
        />
      ) : (
        <>
          {/* 期間サマリー */}
          <div className="grid grid-cols-3 gap-3">
            <Card className="space-y-1 text-center">
              <p className="text-xs text-ink-soft">配送件数</p>
              <p className="num text-2xl font-bold tabular-nums text-ink">{totals.total}</p>
            </Card>
            <Card className="space-y-1 text-center">
              <p className="text-xs text-ink-soft">納品完了率</p>
              <p className="num text-2xl font-bold tabular-nums text-harvest-700">
                {totals.total > 0 ? Math.round((totals.delivered / totals.total) * 100) : 0}%
              </p>
            </Card>
            <Card className="space-y-1 text-center">
              <p className="text-xs text-ink-soft">もどす回数</p>
              <p className="num text-2xl font-bold tabular-nums text-ink">{totals.reverts}</p>
            </Card>
          </div>

          <Card>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-ink-soft">
                  <th className="py-1.5 pr-2 font-medium">配送先</th>
                  <th className="py-1.5 pr-2 text-right font-medium">件数</th>
                  <th className="py-1.5 pr-2 text-right font-medium">完了</th>
                  <th className="py-1.5 pr-2 text-right font-medium">チェック→納品</th>
                  <th className="py-1.5 text-right font-medium">もどす</th>
                </tr>
              </thead>
              <tbody>
                {list.map((s) => (
                  <tr key={s.label} className="border-b border-line last:border-0">
                    <td className="py-2 pr-2 font-medium text-ink">{s.label}</td>
                    <td className="num py-2 pr-2 text-right tabular-nums text-ink">{s.total}</td>
                    <td className="num py-2 pr-2 text-right tabular-nums text-ink">
                      {s.delivered}
                      <span className="ml-1 text-xs text-ink-soft">
                        ({s.total > 0 ? Math.round((s.delivered / s.total) * 100) : 0}%)
                      </span>
                    </td>
                    <td className="num py-2 pr-2 text-right tabular-nums text-ink">
                      {s.avgLeadMin != null ? `${s.avgLeadMin}分` : '—'}
                    </td>
                    <td className="num py-2 text-right tabular-nums text-ink">{s.reverts}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <p className="text-xs text-ink-soft">
            「もどす」はチェックのやり直し回数（ヒヤリハット指標）。多い配送先は荷姿・表示の見直し候補。
            クレーム傾向・曜日パターン等の本格分析はデータ蓄積後に追加する。
          </p>
        </>
      )}
    </div>
  )
}
