import Link from 'next/link'
import { Columns, Inbox, Sparkles } from 'lucide-react'
import { requireAdmin } from '@/lib/auth/require-admin'
import { getPendingOrders } from '@/lib/orders/pending'
import { getSetting } from '@/lib/settings'
import { resolveToggle } from '@/lib/settings-spec'
import { ErrorState } from '@/components/ui/States'
import { SplitApprovalView } from '@/components/admin/SplitApprovalView'
import { ApprovalPipelineToggle } from '@/components/admin/ApprovalPipelineToggle'

export const dynamic = 'force-dynamic'

/**
 * スプリットビュー人間承認画面（/admin/approvals）。
 * - 上部に管理者専用の「承認パイプライン ON/OFF（手動確認モード ⇔ 自動確定モード）」ワンクリック切替バーを配置
 * - 原本（FAX・メール）とAIの読み取り結果を並べる（スマホは明細を先に）
 * - 修正時の「💡 この修正を取引先ルールとして学習させる」ワンクリック保存機能を提供
 */
export default async function AdminApprovalsPage() {
  const guard = await requireAdmin('注文の承認は管理者のみです。')
  if (guard) return guard

  let pendingOrders
  let autoApproveRaw: string | null = null
  let thresholdRaw: string | null = null
  try {
    ;[pendingOrders, autoApproveRaw, thresholdRaw] = await Promise.all([
      getPendingOrders(),
      getSetting('AUTO_APPROVE_ENABLED'),
      getSetting('AUTO_APPROVE_THRESHOLD'),
    ])
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
              承認待ち
            </h1>
            <span className="whitespace-nowrap num rounded-full bg-earth-100 px-2.5 py-0.5 font-mono text-xs font-bold tabular-nums text-earth-800">
              承認待ち {pendingOrders.length} 件
            </span>
          </div>
          <p className="mt-1 text-sm text-ink-soft">
            届いた原本とAIの読み取り結果を見比べて、その場で数量・荷姿を直して承認できます。
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/admin/rules"
            className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-line-strong bg-bg-card px-3 text-xs font-medium text-ink hover:bg-bg-soft"
          >
            <Sparkles className="h-4 w-4 text-earth-700" aria-hidden />
            AI学習ルール
          </Link>
          <Link
            href="/admin/inbox"
            className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-line-strong bg-bg-card px-3 text-xs font-medium text-ink hover:bg-bg-soft"
          >
            <Inbox className="h-4 w-4 text-ink-soft" aria-hidden />
            読み取り失敗
          </Link>
        </div>
      </div>

      <SplitApprovalView orders={pendingOrders} />

      {/* 管理者専用：自動確定のON/OFF。注文を先に見せたいので、設定は一番下に置く */}
      <ApprovalPipelineToggle
        initialAutoApprove={resolveToggle(autoApproveRaw, 'on') === 'on'}
        initialThreshold={thresholdRaw?.trim() || '0.80'}
      />
    </div>
  )
}
