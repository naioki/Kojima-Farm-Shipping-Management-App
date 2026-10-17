import Link from 'next/link'
import { Columns, Inbox, Sparkles } from 'lucide-react'
import { requireAdmin } from '@/lib/auth/require-admin'
import { getPendingOrders } from '@/lib/orders/pending'
import { ErrorState } from '@/components/ui/States'
import { SplitApprovalView } from '@/components/admin/SplitApprovalView'

export const dynamic = 'force-dynamic'

/**
 * スプリットビュー人間承認画面（/admin/approvals）。
 * 左側にGoogle Drive / 原本ストレージ保存のFAX原本PDF/画像プレビュー、右側に確信度色分け付きの編集テーブルを並べ、
 * 修正時の「💡 この修正を取引先ルールとして学習させる」ワンクリック保存機能を提供する。
 */
export default async function AdminApprovalsPage() {
  const guard = await requireAdmin('注文の承認は管理者のみです。')
  if (guard) return guard

  let pendingOrders
  try {
    pendingOrders = await getPendingOrders()
  } catch (e) {
    return (
      <ErrorState
        message="承認待ちの注文を読み込めませんでした。時間をおいて再度お試しください。"
        detail={e instanceof Error ? e.message : String(e)}
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Columns className="h-6 w-6 text-earth-700" aria-hidden />
            <h1 className="font-display text-2xl font-bold text-ink">
              スプリットビュー注文承認
            </h1>
            <span className="num rounded-full bg-earth-100 px-2.5 py-0.5 font-mono text-xs font-bold tabular-nums text-earth-800">
              承認待ち {pendingOrders.length} 件
            </span>
          </div>
          <p className="mt-1 text-sm text-ink-soft">
            左側のFAX原本（PDF/画像）と右側のAI抽出明細を左右比較しながら、その場で数量・荷姿を微修正して承認できます。
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/admin/rules"
            className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-line-strong bg-bg-card px-3 text-xs font-medium text-ink hover:bg-bg-soft"
          >
            <Sparkles className="h-4 w-4 text-earth-700" aria-hidden />
            AI学習ルール管理
          </Link>
          <Link
            href="/admin/inbox"
            className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-line-strong bg-bg-card px-3 text-xs font-medium text-ink hover:bg-bg-soft"
          >
            <Inbox className="h-4 w-4 text-ink-soft" aria-hidden />
            受注ボックス一覧
          </Link>
        </div>
      </div>

      <SplitApprovalView orders={pendingOrders} />
    </div>
  )
}
