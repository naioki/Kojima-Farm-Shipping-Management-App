import Link from 'next/link'
import { Image as ImageIcon, FileText } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { ColorDot } from '@/components/ui/ColorDot'
import { ConfidenceBar } from '@/components/admin/ConfidenceBar'
import { InboxReceiptActions } from '@/components/admin/InboxReceiptActions'
import { ChannelBadge, ReceiptStatusBadge } from '@/components/admin/InboxBadges'
import { formatJpDateTime } from '@/lib/dates'
import type { InboxReceipt } from '@/lib/orders/inbox'

/** 受信レコード（order_receipts）のカード。読み取り・再解析・却下・原本表示の導線を持つ。 */
export function InboxReceiptCard({ receipt: r }: { receipt: InboxReceipt }) {
  return (
    <Card className="space-y-2.5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <ChannelBadge channel={r.channel} />
            <ReceiptStatusBadge status={r.status} />
            {r.isRevision && (
              <span className="rounded bg-warning-bg px-2 py-0.5 text-xs font-medium text-warning">再送（差分）</span>
            )}
          </div>
          <div className="flex items-center gap-2 text-sm">
            {r.customerName ? (
              <span className="flex items-center gap-1.5 font-medium text-ink">
                <ColorDot color={r.customerColor} name={r.customerName} />
                {r.customerName}
              </span>
            ) : (
              <span className="text-ink-faint">取引先 未紐付け</span>
            )}
            <span className="num text-ink-soft">{r.senderDateKey ?? '—'}</span>
          </div>
          <ConfidenceBar value={r.ocrConfidence} />
          {r.status === 'ai_failed' && r.errorMessage && (
            <p className="rounded bg-alert-bg/60 px-2 py-1 text-xs text-alert">{r.errorMessage}</p>
          )}
        </div>
        <time className="num shrink-0 text-xs text-ink-faint">{formatJpDateTime(r.receivedAt)}</time>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-line/60 pt-2.5">
        {r.hasR2Key && (
          <a
            href={`/api/receipts/${r.id}/original`}
            target="_blank"
            rel="noopener"
            className="inline-flex items-center gap-1.5 rounded border border-line-strong bg-bg-card px-2.5 py-1 text-xs font-medium text-ink hover:bg-bg-soft"
          >
            <ImageIcon className="h-3.5 w-3.5" aria-hidden />
            原本を見る
          </a>
        )}
        {r.orderId && (
          <Link
            href={`/admin/orders/${r.orderId}`}
            className="inline-flex items-center gap-1.5 rounded border border-line-strong bg-bg-card px-2.5 py-1 text-xs font-medium text-trust-700 hover:bg-trust-50"
          >
            <FileText className="h-3.5 w-3.5" aria-hidden />
            受注を見る
          </Link>
        )}
        <InboxReceiptActions receiptId={r.id} status={r.status} hasR2Key={r.hasR2Key} />
      </div>
    </Card>
  )
}
