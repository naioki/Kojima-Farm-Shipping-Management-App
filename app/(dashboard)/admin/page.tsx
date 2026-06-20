import { AdminDashboard } from '@/components/dashboard/AdminDashboard'
import { getAdminDashboardData } from '@/lib/dashboard/admin-data'
import { ErrorState } from '@/components/ui/States'

export const dynamic = 'force-dynamic'

/**
 * 経営ダッシュボード（画面A）。データ取得は lib/dashboard/admin-data に集約し、
 * 表示は components/dashboard/AdminDashboard に委譲（見た目とデータの分離）。
 */
export default async function AdminHome() {
  try {
    const data = await getAdminDashboardData()
    return <AdminDashboard data={data} />
  } catch (e) {
    const message = e instanceof Error ? e.message : 'ダッシュボードの取得に失敗しました'
    return <ErrorState message={message} />
  }
}
