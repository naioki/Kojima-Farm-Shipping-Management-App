import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ScanLine, ChevronRight, CheckSquare } from 'lucide-react'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { InboxFilterChips } from '@/components/admin/InboxFilterChips'
import { InboxReceiptCard } from '@/components/admin/InboxReceiptCard'
import { ApprovedOrderCard } from '@/components/admin/ApprovedOrderCard'
import { requireAdmin } from '@/lib/auth/require-admin'
import { getInboxData, normalizeFilter } from '@/lib/orders/inbox'

export const dynamic = 'force-dynamic'

/**
 * 受信ボックス（FAX・メールの受信状況と、読み取り失敗・取引先不明の処理）。
 * 承認は「承認待ち」（/admin/approvals）に一本化した（オーナーの実運用に合わせ、入口の重複を解消）。
 * ここでは注文を承認しない。承認待ちがあれば件数と導線だけを出す。
 *  - 受信（order_receipts）は InboxReceiptCard（読み取り・再解析・却下）
 *  - 「今日承認済み」は実績の確認用（読み取り専用）
 */
export default async function InboxPage({
  searchParams,
}: {
  searchParams: { filter?: string; status?: string }
}) {
  const guard = await requireAdmin('受信ボックスは管理者のみです。')
  if (guard) return guard

  // 旧リンク（?filter=pending）は承認待ち画面へ
  if (searchParams.filter === 'pending') redirect('/admin/approvals')
  const filter = normalizeFilter(searchParams.filter, searchParams.status)

  let data
  try {
    data = await getInboxData()
  } catch (e) {
    return (
      <ErrorState
        message="受信ボックスを読み込めませんでした。時間をおいて再度お試しください。"
        detail={e instanceof Error ? e.message : String(e)}
      />
    )
  }
  const { receipts, approvedOrders, counts } = data

  const showParsing = filter === 'all' || filter === 'parsing'
  const showReview = filter === 'all' || filter === 'review'
  const showApproved = filter === 'approved'

  const parsingReceipts = receipts.filter((r) => r.status === 'pending_ai')
  const reviewReceipts = receipts.filter((r) => r.status === 'ai_failed' || r.status === 'unmatched')
  // 対応が必要なもの（失敗・取引先不明）を先に出す
  const visibleReceipts = [...(showReview ? reviewReceipts : []), ...(showParsing ? parsingReceipts : [])]

  const nothingToShow = visibleReceipts.length === 0 && (!showApproved || approvedOrders.length === 0)

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">読み取り失敗</h1>
        <p className="mt-1 text-sm text-ink-soft">
          届いたFAX・メールの読み取り状況です。読み取りに失敗したもの・取引先が分からないものをここで直します。承認は「承認待ち」で行います。
        </p>
      </div>

      {/* 承認待ちへの導線（承認はこの画面では行わない） */}
      {counts.pending > 0 && (
        <Link
          href="/admin/approvals"
          className="flex items-center gap-3 rounded-xl border border-trust-100 bg-trust-50/80 p-3.5 shadow-sm hover:bg-trust-50 focus:outline-none focus:ring-2 focus:ring-trust-500"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-trust-600 text-white">
            <CheckSquare className="h-5 w-5" aria-hidden />
          </span>
          <span className="text-sm font-bold text-trust-700">
            承認待ちの注文が <span className="num">{counts.pending}</span> 件あります。原本と見比べて承認する
          </span>
          <ChevronRight className="ml-auto h-4 w-4 text-trust-700" aria-hidden />
        </Link>
      )}

      <InboxFilterChips active={filter === 'pending' ? 'all' : filter} counts={counts} />

      {/* 手動でファイルを読み取る（AI 読み取りは「注文の受付」に一本化。ここは導線のみ） */}
      <Link
        href="/admin/orders/new"
        className="flex items-center gap-2 rounded-lg border border-line bg-bg-card px-4 py-3 text-sm font-medium text-ink hover:bg-bg-soft"
      >
        <ScanLine className="h-4 w-4 text-earth-700" aria-hidden />
        手動でファイルを読み取る（FAX画像・PDF・メール本文）
        <ChevronRight className="ml-auto h-4 w-4 text-ink-faint" aria-hidden />
      </Link>

      {nothingToShow ? (
        <EmptyState
          title="対応が必要な受信はありません"
          description={
            filter === 'approved'
              ? '今日承認した注文がここに表示されます。'
              : '読み取り中・読み取り失敗・取引先不明の受信があるとここに表示されます。'
          }
        />
      ) : (
        <div className="space-y-3">
          {visibleReceipts.map((r) => (
            <InboxReceiptCard key={`receipt-${r.id}`} receipt={r} />
          ))}
          {showApproved && approvedOrders.map((o) => <ApprovedOrderCard key={`approved-${o.id}`} order={o} />)}
        </div>
      )}
    </div>
  )
}
