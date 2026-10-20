import { DashboardHeader, type DashboardHeaderProps } from './DashboardHeader'
import { ShipmentStatusCards } from './ShipmentStatusCards'
import { SalesTrendChart } from './SalesTrendChart'
import { QuickActionsGrid, type QuickAction } from './QuickActionsGrid'
import { RecentOrdersTable } from './RecentOrdersTable'
import { MonthlySummary } from './MonthlySummary'
import type { TodayShipmentStats, TrendPoint, RecentOrderRow, SummaryRow } from './types'

export interface AdminDashboardData {
  header: DashboardHeaderProps
  stats: TodayShipmentStats
  trend: TrendPoint[]
  alerts?: unknown
  actions: QuickAction[]
  recentOrders: RecentOrderRow[]
  summary: SummaryRow[]
}

/**
 * 経営ダッシュボードの構成（純表示）。
 * 赤い通知欄・アラートパネルを撤去し、出荷推移チャートをすっきりワイドに表示。
 */
export function AdminDashboard({ data }: { data: AdminDashboardData }) {
  return (
    <div className="space-y-5">
      <DashboardHeader {...data.header} />

      <section className="space-y-2.5">
        <h2 className="text-sm font-semibold text-ink-soft">本日の出荷状況</h2>
        <ShipmentStatusCards stats={data.stats} />
      </section>

      <div>
        <SalesTrendChart data={data.trend} />
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
