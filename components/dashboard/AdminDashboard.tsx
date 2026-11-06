import Link from 'next/link'
import { ArrowRight, PackageCheck } from 'lucide-react'
import { DashboardHeader, type DashboardHeaderProps } from './DashboardHeader'
import { ShipmentStatusCards } from './ShipmentStatusCards'
import { SalesTrendChart } from './SalesTrendChart'
import { QuickActionsGrid, type QuickAction } from './QuickActionsGrid'
import { RecentOrdersTable } from './RecentOrdersTable'
import { MonthlySummary } from './MonthlySummary'
import { AlertsPanel, type AlertItem } from './AlertsPanel'
import type { TodayShipmentStats, TomorrowPackStats, TrendPoint, RecentOrderRow, SummaryRow } from './types'

export interface AdminDashboardData {
  header: DashboardHeaderProps
  stats: TodayShipmentStats
  tomorrowPackStats?: TomorrowPackStats
  trend: TrendPoint[]
  alerts?: AlertItem[]
  actions: QuickAction[]
  recentOrders: RecentOrderRow[]
  summary: SummaryRow[]
}

/**
 * 経営ダッシュボード（#44 本日パック作業分［明日納品分］の箱数・パック数進捗コックピット ＆ #45 要対応アラートの表示）。
 */
export function AdminDashboard({ data }: { data: AdminDashboardData }) {
  const tp = data.tomorrowPackStats
  const activeAlerts = Array.isArray(data.alerts) ? data.alerts : []

  return (
    <div className="space-y-5">
      <DashboardHeader {...data.header} />

      {/* #45 未承認注文・OCR要確認などの重要アラートがある場合は最上部に明示 */}
      {activeAlerts.length > 0 && (
        <AlertsPanel alerts={activeAlerts} />
      )}

      {/* #44 本日パック作業（明日納品分）の箱数・パック数コックピット */}
      {tp && (
        <section className="rounded-2xl bg-forest-700 p-4 text-white shadow-md space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-harvest-500/30 text-harvest-100">
                <PackageCheck className="h-5 w-5" />
              </span>
              <div>
                <h2 className="text-sm sm:text-base font-black text-white">
                  🥬 本日パック作業（明日 {tp.deliveryDateLabel} 納品分）の進捗
                </h2>
                <p className="text-xs text-harvest-100 font-medium">
                  全 {tp.totalItems} 明細中 {tp.completedItems} 明細が完了
                </p>
              </div>
            </div>
            <Link
              href={`/field/shipments?date=${tp.deliveryDate}`}
              className="inline-flex items-center gap-1 rounded-xl bg-white px-3.5 py-2 text-xs font-black text-forest-900 shadow-xs hover:bg-harvest-50 transition"
            >
              <span>収穫・パックボードを開く</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 rounded-xl bg-black/25 border border-white/15 p-3 text-center">
            <div>
              <span className="block text-xs font-bold text-harvest-100">完成箱数 / 目標箱数</span>
              <span className="num text-2xl sm:text-3xl font-black text-white tabular-nums">
                {tp.completedBoxes.toLocaleString()}
                <small className="text-base font-bold text-white/50 mx-1">/</small>
                <span className="text-harvest-100">{tp.totalBoxes.toLocaleString()}</span>
                <small className="text-xs font-bold ml-1">箱</small>
              </span>
            </div>
            <div>
              <span className="block text-xs font-bold text-white/80">完成パック数 / 総パック数</span>
              <span className="num text-xl sm:text-2xl font-black text-white tabular-nums">
                {tp.completedPacks.toLocaleString()}
                <small className="text-sm font-bold text-white/50 mx-1">/</small>
                <span className="text-white/90">{tp.totalPacks.toLocaleString()}</span>
                <small className="text-xs font-bold ml-1">P</small>
              </span>
            </div>
            <div className="col-span-2 sm:col-span-1 flex flex-col justify-center">
              <div className="flex items-center justify-between text-xs font-black mb-1 px-1">
                <span className="text-harvest-100">
                  残り: あと {Math.max(0, tp.totalBoxes - tp.completedBoxes)} 箱
                </span>
                <span>{tp.progressPct}%</span>
              </div>
              <div className="h-2.5 w-full rounded-full bg-black/30 overflow-hidden p-0.5">
                <div
                  style={{ width: `${tp.progressPct}%` }}
                  className="h-full rounded-full bg-gradient-to-r from-harvest-400 to-harvest-400 transition-all"
                />
              </div>
            </div>
          </div>
        </section>
      )}

      <section className="space-y-2.5">
        <h2 className="text-sm font-semibold text-ink-soft">🚚 本日納品分の配送・出荷状況</h2>
        <ShipmentStatusCards stats={data.stats} />
      </section>

      {/* スマホ用の近道。PC では左メニューと同じ内容になるため出さない */}
      <div className="lg:hidden">
        <QuickActionsGrid actions={data.actions} />
      </div>

      {/* お金（今月の受注・出荷・請求・未請求）と最近の受注を、売上グラフより先に置く */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-1 lg:order-2">
          <MonthlySummary rows={data.summary} />
        </div>
        <div className="lg:col-span-2 lg:order-1">
          <RecentOrdersTable orders={data.recentOrders} />
        </div>
      </div>

      <div>
        <SalesTrendChart data={data.trend} />
      </div>

      <p className="text-right text-xs">
        <Link href="/admin/metrics" className="font-medium text-trust-600 hover:underline">
          評価指標（処理時間・ミス・紙の卒業）を見る →
        </Link>
      </p>
    </div>
  )
}
