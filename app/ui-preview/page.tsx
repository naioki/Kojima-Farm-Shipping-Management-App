import { notFound } from 'next/navigation'
import { Sidebar } from '@/components/layouts/Sidebar'
import { AdminDashboard } from '@/components/dashboard/AdminDashboard'
import { SAMPLE_DASHBOARD } from '@/components/dashboard/sample-data'

export const dynamic = 'force-dynamic'

/**
 * UIプレビュー（開発限定・認証不要・DB非依存）。
 * モック画像のサンプルデータで経営ダッシュボードを描画し、ヘッドレスChromeで
 * before/after スクショを撮るための足場。本番ビルドでは 404（notFound）。
 */
export default function UiPreviewPage() {
  if (process.env.NODE_ENV === 'production') notFound()

  return (
    <div className="flex min-h-screen">
      <Sidebar role="admin" user={{ name: '小島 太郎', roleLabel: '経営者' }} />
      <main className="min-w-0 flex-1 p-8">
        <AdminDashboard data={SAMPLE_DASHBOARD} />
      </main>
    </div>
  )
}
