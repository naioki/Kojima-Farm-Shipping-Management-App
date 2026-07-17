import Link from 'next/link'
import { ScanLine, ChevronRight } from 'lucide-react'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { Card } from '@/components/ui/Card'
import { ColorDot } from '@/components/ui/ColorDot'
import { IngestButton } from '@/components/admin/IngestButton'
import { InboxFilterChips } from '@/components/admin/InboxFilterChips'
import { InboxReceiptCard } from '@/components/admin/InboxReceiptCard'
import { ChannelBadge, OrderStatusBadge } from '@/components/admin/InboxBadges'
import { EditableOrderCard } from '@/components/admin/EditableOrderCard'
import { requireAdmin } from '@/lib/auth/require-admin'
import { getInboxData, normalizeFilter } from '@/lib/orders/inbox'
import { pendingReasons } from '@/lib/orders/pending'
import { formatJpDateShort } from '@/lib/dates'

export const dynamic = 'force-dynamic'

/**
 * 受注ボックス（受信 → 解析 → 承認を1画面で完結・Issue#3）。
 * フィルタチップ（?filter=）で「すべて／解析待ち／要確認／承認待ち／今日承認済み」を切り替える。
 *  - 受信（order_receipts）は InboxReceiptCard（読み取り・再解析・却下）。
 *  - 承認待ち注文は既存 EditableOrderCard をそのまま埋め込み、その場で編集・承認できる。
 *  - 承認ロジック（lib/orders/approve.ts / /api/orders/[id]/approve）は一切変更しない。
 */
export default async function InboxPage({
  searchParams,
}: {
  searchParams: { filter?: string; status?: string }
}) {
  const guard = await requireAdmin('受注ボックスは管理者のみです。')
  if (guard) return guard

  const filter = normalizeFilter(searchParams.filter, searchParams.status)

  let data
  try {
    data = await getInboxData()
  } catch (e) {
    return <ErrorState message={e instanceof Error ? e.message : '受注ボックスの読み込みに失敗しました'} />
  }
  const { receipts, pendingOrders, approvedOrders, counts } = data

  const showParsing = filter === 'all' || filter === 'parsing'
  const showReview = filter === 'all' || filter === 'review'
  const showPending = filter === 'all' || filter === 'pending'
  const showApproved = filter === 'approved'

  const parsingReceipts = receipts.filter((r) => r.status === 'pending_ai')
  const reviewReceipts = receipts.filter((r) => r.status === 'ai_failed' || r.status === 'unmatched')

  const visibleReceipts = [
    ...(showParsing ? parsingReceipts : []),
    ...(showReview ? reviewReceipts : []),
  ]

  const nothingToShow =
    visibleReceipts.length === 0 &&
    (!showPending || pendingOrders.length === 0) &&
    (!showApproved || approvedOrders.length === 0)

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">受注ボックス</h1>
          <p className="mt-1 text-sm text-ink-soft">
            届いた受信の取り込みから承認までを1画面で。「読み取る」で注文化、「承認する」で収穫タスクを作成します。
          </p>
        </div>
        <IngestButton />
      </div>

      <InboxFilterChips active={filter} counts={counts} />

      {/* 手動でファイルを読み取る（読み取りフォーム本体は /admin/ocr に一本化。ここは導線のみ） */}
      <Link
        href="/admin/ocr"
        className="flex items-center gap-2 rounded-lg border border-line bg-bg-card px-4 py-3 text-sm font-medium text-ink hover:bg-bg-soft"
      >
        <ScanLine className="h-4 w-4 text-earth-700" aria-hidden />
        手動でファイルを読み取る（FAX画像・PDF・メール本文）
        <ChevronRight className="ml-auto h-4 w-4 text-ink-faint" aria-hidden />
      </Link>

      {nothingToShow ? (
        <EmptyState
          title="表示するものはありません"
          description={
            filter === 'approved'
              ? '今日承認した注文がここに表示されます。'
              : '新しい受信や承認待ちの注文があるとここに表示されます。'
          }
        />
      ) : (
        <div className="space-y-3">
          {/* 承認待ち注文（その場で編集・承認） */}
          {showPending &&
            pendingOrders.map((o) => (
              <div key={`order-${o.id}`}>
                <div className="mb-1 flex flex-wrap items-center gap-2 px-1">
                  <ChannelBadge channel={o.source} />
                  <OrderStatusBadge kind="pending" />
                </div>
                <EditableOrderCard
                  orderId={o.id}
                  customerName={o.customerName}
                  customerColor={o.customerColor}
                  deliveryDate={o.deliveryDate}
                  needsDeliveryDate={o.needsDeliveryDate}
                  needsDestination={o.needsDestination}
                  destinationOptions={o.destinationOptions}
                  reasons={pendingReasons(o)}
                  items={o.items}
                  receipt={o.receipt}
                  approveLabel="承認する"
                  size="md"
                />
              </div>
            ))}

          {/* 受信レコード（解析待ち・要確認） */}
          {visibleReceipts.map((r) => (
            <InboxReceiptCard key={`receipt-${r.id}`} receipt={r} />
          ))}

          {/* 今日承認済み（読み取り専用の実績） */}
          {showApproved &&
            approvedOrders.map((o) => (
              <Card key={`approved-${o.id}`} className="flex items-center justify-between gap-4">
                <div className="min-w-0 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <ChannelBadge channel={o.source} />
                    <OrderStatusBadge kind="approved" />
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="flex items-center gap-1.5 font-medium text-ink">
                      <ColorDot color={o.customerColor} name={o.customerName} />
                      {o.customerName}
                    </span>
                    <span className="text-ink-soft">
                      のうひん {o.deliveryDate ? formatJpDateShort(o.deliveryDate) : 'みてい'}
                    </span>
                    <span className="num text-ink-faint tabular-nums">{o.itemCount}品目</span>
                  </div>
                </div>
                <Link
                  href={`/admin/orders/${o.id}`}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded border border-line-strong bg-bg-card px-2.5 py-1 text-xs font-medium text-trust-700 hover:bg-trust-50"
                >
                  受注を見る
                  <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                </Link>
              </Card>
            ))}
        </div>
      )}
    </div>
  )
}
