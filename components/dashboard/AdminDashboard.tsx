import { DashboardHeader, type DashboardHeaderProps } from './DashboardHeader'
import { ShipmentStatusCards } from './ShipmentStatusCards'
import { SalesTrendChart } from './SalesTrendChart'
import { AlertsPanel, type AlertItem } from './AlertsPanel'
import { QuickActionsGrid, type QuickAction } from './QuickActionsGrid'
import { RecentOrdersTable } from './RecentOrdersTable'
import { MonthlySummary } from './MonthlySummary'
import type { TodayShipmentStats, TrendPoint, RecentOrderRow, SummaryRow } from './types'

export interface AdminDashboardData {
  header: DashboardHeaderProps
  stats: TodayShipmentStats
  trend: TrendPoint[]
  alerts: AlertItem[]
  actions: QuickAction[]
  recentOrders: RecentOrderRow[]
  summary: SummaryRow[]
}

/**
 * 経営ダッシュボードの構成（純表示）。データ取得とは分離し、
 * /admin（実データ）と /ui-preview（サンプル）が同じ見た目を共有する。
 */
export function AdminDashboard({ data }: { data: AdminDashboardData }) {
  return (
    <div className="space-y-5">
      <DashboardHeader {...data.header} />

      <section className="space-y-2.5">
        <h2 className="text-sm font-semibold text-ink-soft">本日の出荷状況</h2>
        <ShipmentStatusCards stats={data.stats} />
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <SalesTrendChart data={data.trend} />
        </div>
        <div className="lg:col-span-1">
          <AlertsPanel alerts={data.alerts} />
        </div>
      </div>

      <QuickActionsGrid actions={data.actions} />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <RecentOrdersTable orders={data.recentOrders} />
        </div>
        <div className="lg:col-span-1">
          <MonthlySummary rows={data.summary} />
        </div>
      </div>
    </div>
  )
}
