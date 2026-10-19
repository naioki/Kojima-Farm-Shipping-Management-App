'use client'

import { useState } from 'react'
import Link from 'next/link'
import { FileText, ChevronDown, ChevronUp } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { ColorDot } from '@/components/ui/ColorDot'
import { ChannelBadge, OrderStatusBadge } from '@/components/admin/InboxBadges'
import { formatJpDateShort } from '@/lib/dates'
import type { ApprovedOrderSummary } from '@/lib/orders/inbox'

export function ApprovedOrderCard({ order: o }: { order: ApprovedOrderSummary }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <Card className="space-y-2.5">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <ChannelBadge channel={o.source} />
            <OrderStatusBadge kind="approved" />
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="flex items-center gap-1.5 font-bold text-ink">
              <ColorDot color={o.customerColor} name={o.customerName} />
              {o.customerName}
            </span>
            <span className="rounded bg-trust-50 px-2 py-0.5 text-xs font-bold text-trust-700">
              納品: {o.deliveryDate ? formatJpDateShort(o.deliveryDate) : '未定'}
            </span>
            <span className="num text-ink-muted text-xs tabular-nums font-bold">
              {o.itemCount}品目
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {o.items.length > 0 && (
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              className="inline-flex items-center gap-1 rounded-lg border border-line bg-bg-card px-2.5 py-1.5 text-xs font-bold text-ink hover:bg-bg-soft"
            >
              {expanded ? (
                <>
                  <ChevronUp className="h-3 w-3" />
                  <span>閉じる ▲</span>
                </>
              ) : (
                <>
                  <ChevronDown className="h-3 w-3" />
                  <span>内訳 ▼</span>
                </>
              )}
            </button>
          )}
          <Link
            href={`/admin/orders/${o.id}`}
            className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-line-strong bg-bg-card px-2.5 py-1.5 text-xs font-bold text-trust-700 hover:bg-trust-50"
          >
            <FileText className="h-3.5 w-3.5" aria-hidden />
            受注詳細
          </Link>
        </div>
      </div>

      {expanded && o.items.length > 0 && (
        <div className="animate-fade-in rounded-lg border border-line bg-bg-soft p-3 text-xs">
          <table className="w-full text-left">
            <thead className="text-ink-soft border-b border-line pb-1">
              <tr>
                <th className="py-1">品目</th>
                <th className="py-1">規格</th>
                <th className="py-1 text-right">数量</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {o.items.map((it) => (
                <tr key={it.id}>
                  <td className="py-1 font-bold text-ink">{it.productName}</td>
                  <td className="py-1 text-ink-soft">{it.spec ?? '—'}</td>
                  <td className="py-1 text-right font-bold text-ink">
                    {it.quantity} {it.unit}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}
